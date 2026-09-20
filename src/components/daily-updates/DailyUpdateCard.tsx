import { ReactNode } from 'react'
import { ArrowRight, Check, Pencil } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { TaskReference } from '@/components/daily-updates/TaskReference'
import {
  DAILY_UPDATE_SECTIONS,
  MemberDay,
  itemsOfType,
  mentionSegments,
  referenceOf,
  submissionLabels,
} from '@/lib/dailyUpdates'
import { mentionLabel } from '@/lib/mentions'
import type {
  DailyUpdate,
  DailyUpdateItem,
  DailyUpdateItemType,
  WorkspaceMember,
} from '@/types/workspace'

// The marker in front of an item: a tick for what is done, a dot for a blocker,
// an arrow for what's next.
function ItemMarker({ type }: { type: DailyUpdateItemType }) {
  if (type === 'done') {
    return (
      <Check
        size={14}
        aria-hidden
        className="mt-1 shrink-0 text-[var(--ws-accent,#375b4b)]"
      />
    )
  }
  if (type === 'blocker') {
    return (
      <span
        aria-hidden
        className="mx-[5px] mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-coral"
      />
    )
  }
  return (
    <ArrowRight size={14} aria-hidden className="mt-1 shrink-0 text-muted" />
  )
}

// One item: its words with tagged members highlighted, the task it points at (a
// link into the existing task view), and who was asked. A tagged person who is no
// longer in the workspace shows as "Former member" instead of vanishing or
// breaking the line.
function ItemLine({
  item,
  members,
  workspaceSlug,
}: {
  item: DailyUpdateItem
  members: readonly WorkspaceMember[]
  workspaceSlug: string
}) {
  const mentionedMembers = item.mentionedUserIds.flatMap(userId => {
    const member = members.find(m => m.userId === userId)
    return member ? [member] : []
  })
  const formerCount = item.mentionedUserIds.length - mentionedMembers.length
  const reference = referenceOf(item)
  return (
    <li className="flex items-start gap-2">
      <ItemMarker type={item.type} />
      <div className="min-w-0 flex-1 text-sm leading-6 text-ink">
        <span className="break-words">
          {mentionSegments(item.content, mentionedMembers).map((segment, i) =>
            segment.mention ? (
              <mark
                key={i}
                className="rounded bg-sage/20 font-bold text-[var(--ws-accent,#375b4b)]"
              >
                {segment.text}
              </mark>
            ) : (
              <span key={i}>{segment.text}</span>
            ),
          )}
        </span>
        {(reference || formerCount > 0) && (
          <span className="ml-1.5 inline-flex flex-wrap items-center gap-1.5 align-middle">
            {reference && (
              <TaskReference
                reference={reference}
                workspaceSlug={workspaceSlug}
              />
            )}
            {formerCount > 0 && (
              <span className="rounded-md border border-dashed border-line px-2 py-0.5 text-[11px] italic text-muted">
                {formerCount === 1
                  ? 'Asked a former member'
                  : `Asked ${formerCount} former members`}
              </span>
            )}
          </span>
        )}
      </div>
    </li>
  )
}

function Sections({
  update,
  members,
  workspaceSlug,
}: {
  update: DailyUpdate
  members: readonly WorkspaceMember[]
  workspaceSlug: string
}) {
  return (
    <div className="space-y-4">
      {DAILY_UPDATE_SECTIONS.map(section => {
        const items = itemsOfType(update, section.type)
        return (
          <section key={section.type} aria-label={section.title}>
            <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
              {section.title}
            </h4>
            {items.length === 0 ? (
              <p className="mt-1.5 text-sm text-muted">{section.empty}</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {items.map(item => (
                  <ItemLine
                    key={item.id}
                    item={item}
                    members={members}
                    workspaceSlug={workspaceSlug}
                  />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

// One member's card for the day. It is rendered for EVERY member: with an update
// it shows Done / Blocker / Next; without one it says Not Reported -- and only
// that. Not reporting is not "no work", "no blockers" or "inactive"; the card
// never implies otherwise.
export function DailyUpdateCard({
  entry,
  members,
  workspaceSlug,
  isCurrentUser,
  onEdit,
  children,
}: {
  entry: MemberDay
  members: readonly WorkspaceMember[]
  workspaceSlug: string
  isCurrentUser: boolean
  // Offered on your own submitted update, for today only.
  onEdit?: () => void
  // What replaces the card's body (the form, while you write your own update).
  children?: ReactNode
}) {
  const { member, update } = entry
  const name = mentionLabel(member)
  return (
    <article
      aria-label={`${name}'s Daily Update`}
      className="rounded-2xl border border-line bg-panel shadow-sm"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-4">
        <Avatar person={member} className="h-9 w-9 shrink-0 text-xs" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold tracking-tight text-ink">
            {name}
            {isCurrentUser && (
              <span className="ml-1.5 text-[11px] font-semibold text-muted">
                (you)
              </span>
            )}
          </h3>
          {update ? (
            <p className="text-[11px] text-muted">
              {submissionLabels(update).join(' · ')}
            </p>
          ) : (
            <p className="text-[11px] font-semibold text-muted">Not Reported</p>
          )}
        </div>
        {update && onEdit && !children && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-muted transition hover:bg-slate-100 hover:text-ink"
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </header>
      <div className="px-5 py-4">
        {children ? (
          children
        ) : update ? (
          <Sections
            update={update}
            members={members}
            workspaceSlug={workspaceSlug}
          />
        ) : (
          <div>
            <p className="text-sm font-semibold text-muted">Not Reported</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              {isCurrentUser
                ? "You haven't submitted an update for this date yet."
                : 'This member has not submitted an update for this date.'}
            </p>
          </div>
        )}
      </div>
    </article>
  )
}
