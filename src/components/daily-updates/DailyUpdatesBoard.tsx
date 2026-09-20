import { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react'
import { DailyUpdateCard } from '@/components/daily-updates/DailyUpdateCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Skeleton } from '@/components/ui/Skeleton'
import { MemberDay, formatDay, summarizeDay } from '@/lib/dailyUpdates'
import type { WorkspaceMember } from '@/types/workspace'

// The page's header: the day (with a way to move between days), and who has
// reported. The count is a plain "5 of 7 members reported" -- deliberately no
// percentage, score or ranking: Not Reported only means no update was submitted
// for this date.
function BoardHeader({
  day,
  isToday,
  isYesterday,
  summary,
  onPrevious,
  onNext,
  onToday,
}: {
  day: string
  isToday: boolean
  isYesterday?: boolean
  summary: ReturnType<typeof summarizeDay> | null
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
          <ClipboardList size={18} /> Daily Updates
        </h2>
        <p className="mt-1 text-sm font-semibold text-ink">
          {formatDay(day)}
          {isYesterday && (
            <span className="ml-2 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700 border border-blue-200">
              Yesterday
            </span>
          )}
        </p>
        <div className="mt-1 min-h-5 text-xs text-muted" aria-live="polite">
          {summary ? (
            <>
              <span className="font-semibold text-ink">
                {summary.reported} of {summary.total}{' '}
                {summary.total === 1 ? 'member' : 'members'} reported
              </span>
              {summary.notReported > 0 && (
                <span className="ml-2 rounded-full border border-line bg-white/60 px-2 py-0.5 font-semibold">
                  {summary.notReported} Not Reported
                </span>
              )}
            </>
          ) : (
            <Skeleton className="h-3 w-40" />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {!isToday && (
          <button
            onClick={onToday}
            className="rounded-lg border border-line bg-white/60 px-3 py-1.5 text-[11px] font-semibold text-[var(--ws-accent,#375b4b)] transition hover:border-[var(--ws-accent,#375b4b)]"
          >
            Today
          </button>
        )}
        <button
          aria-label="Previous day"
          onClick={onPrevious}
          className="rounded-lg border border-line bg-white/60 p-1.5 text-muted transition hover:border-[var(--ws-accent,#375b4b)] hover:text-ink"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          aria-label="Next day"
          onClick={onNext}
          disabled={isToday}
          className="rounded-lg border border-line bg-white/60 p-1.5 text-muted transition hover:border-[var(--ws-accent,#375b4b)] hover:text-ink disabled:opacity-40 disabled:hover:border-line disabled:hover:text-muted"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      </div>
      <Skeleton className="mt-5 h-3 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>
  )
}

// A day of Daily Updates: the header and one card for EVERY member, whether or
// not they have reported. Presentational -- the data, and what happens on your
// own card, come from the page.
export function DailyUpdatesBoard({
  ready,
  error,
  day,
  isToday,
  isYesterday,
  entries,
  members,
  workspaceSlug,
  currentUserId,
  renderOwnCard,
  onPrevious,
  onNext,
  onToday,
}: {
  ready: boolean
  error: string | null
  day: string
  isToday: boolean
  isYesterday?: boolean
  entries: readonly MemberDay[]
  members: readonly WorkspaceMember[]
  workspaceSlug: string
  currentUserId: string
  // Your own card, which owns the form; null to render it like anyone's.
  renderOwnCard: (entry: MemberDay) => ReactNode | null
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
}) {
  const summary = ready ? summarizeDay(entries) : null
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <BoardHeader
        day={day}
        isToday={isToday}
        isYesterday={isYesterday}
        summary={summary}
        onPrevious={onPrevious}
        onNext={onNext}
        onToday={onToday}
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {!ready ? (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No members yet">
          Daily Updates list everyone in the workspace. Invite someone to get
          started.
        </EmptyState>
      ) : (
        <>
          {summary && summary.reported === 0 && (
            <p className="text-xs text-muted">
              {isToday
                ? 'Nobody has submitted an update yet today.'
                : isYesterday
                  ? 'Nobody submitted an update for yesterday.'
                  : 'Nobody submitted an update for this date.'}
            </p>
          )}
          <div className="space-y-4">
            {entries.map(entry => {
              const isCurrentUser = entry.member.userId === currentUserId
              const own = isCurrentUser ? renderOwnCard(entry) : null
              return (
                own ?? (
                  <DailyUpdateCard
                    key={entry.member.userId}
                    entry={entry}
                    members={members}
                    workspaceSlug={workspaceSlug}
                    isCurrentUser={isCurrentUser}
                  />
                )
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
