import { ReactNode } from 'react'
import Link from 'next/link'
import { ClipboardList, Star } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  OverviewBadge,
  ScopeBadge,
  StatusBadge,
  zoneNote,
} from '@/components/events/EventParts'
import {
  audienceLabel,
  durationLabel,
  formatEventClock,
  formatOccurrence,
  liveOccurrence,
  nextOccurrence,
  remindersLabel,
  scheduleLabel,
} from '@/lib/events'
import { detectTimezone } from '@/lib/timezones'
import type { WorkspaceEvent, WorkspaceMember } from '@/types/workspace'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-xs font-semibold text-ink">
        {children}
      </dd>
    </div>
  )
}

export type EventOverviewControl = {
  // This event is the one the Overview's card shows by the owner's choice.
  featured: boolean
  // It has something live or ahead, so it can be put there.
  available: boolean
  // The owner turned the Overview card off in Settings.
  cardOff: boolean
  saving: boolean
  onChange: (featured: boolean) => void
}

// The owner's choice of which event the Overview shows.
function OverviewControl({ control }: { control: EventOverviewControl }) {
  const { featured, available, cardOff, saving, onChange } = control
  if (!featured && !available) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white/70 px-4 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
          <Star size={13} className="text-[var(--ws-accent,#375b4b)]" />
          {featured ? 'Shown on the Overview' : 'Overview'}
        </p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted">
          {cardOff
            ? 'The Overview’s event card is turned off in Settings.'
            : featured
              ? 'Every member sees this event on the Overview until it ends; then the next event shows again.'
              : 'The Overview shows each member their next event. Show this one to everyone instead.'}
        </p>
      </div>
      <Button
        type="button"
        variant={featured ? 'ghost' : 'secondary'}
        disabled={saving}
        onClick={() => onChange(!featured)}
        className="shrink-0"
      >
        {featured ? 'Remove from Overview' : 'Show on Overview'}
      </Button>
    </div>
  )
}

// Everything about one event, answering at a glance: what, when, who, and
// when I'll be reminded. Edit/Cancel/Delete only for whoever may manage it;
// the Overview choice only for the workspace owner (`overview` null otherwise).
export function EventDetail({
  event,
  now,
  members,
  creatorName,
  canManage,
  dailyUpdatesHref,
  overview = null,
  featured = false,
  onEdit,
  onCancelEvent,
  onDelete,
}: {
  event: WorkspaceEvent
  now: number
  members: WorkspaceMember[]
  creatorName: string | null
  canManage: boolean
  // Offered when the event asks people to have their Daily Update ready.
  dailyUpdatesHref: string | null
  overview?: EventOverviewControl | null
  // Shown on the Overview by the owner's choice (the badge, for everyone).
  featured?: boolean
  onEdit: () => void
  onCancelEvent: () => void
  onDelete: () => void
}) {
  const live = liveOccurrence(event, now)
  const next = nextOccurrence(event, now)
  const own = detectTimezone()
  const showOwnTime = next && zoneNote(next, event.timezone)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <ScopeBadge event={event} />
        <StatusBadge event={event} now={now} />
        {featured && <OverviewBadge />}
      </div>

      <dl className="divide-y divide-line/70">
        <Row label="When">{scheduleLabel(event, now)}</Row>
        {live && (
          <Row label="Started">
            {formatOccurrence(live, event.timezone, now)}
          </Row>
        )}
        {next && event.recurrence !== 'none' && (
          <Row label="Next">{formatOccurrence(next, event.timezone, now)}</Row>
        )}
        <Row label="Timezone">
          {event.timezone}
          {showOwnTime && next && (
            <span className="block text-[11px] font-medium text-muted">
              {formatEventClock(next, own)} your time
            </span>
          )}
        </Row>
        {event.durationMinutes && (
          <Row label="Length">
            {durationLabel(String(event.durationMinutes))}
          </Row>
        )}
        <Row label={event.workspaceType === 'personal' ? 'Where' : 'Workspace'}>
          {event.workspaceType === 'personal'
            ? 'Personal Workspace'
            : event.workspaceName}
        </Row>
        <Row label="Audience">{audienceLabel(event, members)}</Row>
        <Row label="Reminder">
          {event.status === 'cancelled'
            ? 'None — cancelled'
            : remindersLabel(event.reminderOffsets)}
        </Row>
        {creatorName && <Row label="Created by">{creatorName}</Row>}
      </dl>

      {event.description && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Description
          </p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-ink">
            {event.description}
          </p>
        </div>
      )}

      {dailyUpdatesHref && event.dailyUpdatePrompt && (
        <Link
          href={dailyUpdatesHref}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ws-accent,#375b4b)] hover:underline"
        >
          <ClipboardList size={13} /> Write Daily Update
        </Link>
      )}

      {overview && <OverviewControl control={overview} />}

      {canManage && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="danger" onClick={onDelete}>
            Delete
          </Button>
          {event.status === 'scheduled' && (
            <>
              {(next || live) && (
                <Button type="button" variant="ghost" onClick={onCancelEvent}>
                  Cancel event
                </Button>
              )}
              <Button type="button" onClick={onEdit}>
                Edit
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
