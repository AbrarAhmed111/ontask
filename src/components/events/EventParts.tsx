import { Bell, ChevronRight, Lock, Repeat, Users } from 'lucide-react'
import {
  audienceLabel,
  formatEventClock,
  isPastEvent,
  liveOccurrence,
  nextOccurrence,
  remindersLabel,
  scheduleLabel,
  timezoneAbbreviation,
} from '@/lib/events'
import { detectTimezone } from '@/lib/timezones'
import type { WorkspaceEvent, WorkspaceMember } from '@/types/workspace'

// The reader's zone differs from the event's at this instant: show the event's
// zone next to its times, so "9:00 AM" is never ambiguous.
export function zoneNote(iso: string, timeZone: string): string | null {
  const own = detectTimezone()
  if (own === timeZone) return null
  const theirs = timezoneAbbreviation(iso, timeZone)
  return theirs === timezoneAbbreviation(iso, own) ? null : theirs
}

export function ScopeBadge({ event }: { event: WorkspaceEvent }) {
  const personal = event.scope === 'personal'
  const Icon = personal ? Lock : Users
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-muted">
      <Icon size={10} /> {personal ? 'Personal' : 'Workspace'}
    </span>
  )
}

export function StatusBadge({
  event,
  now,
}: {
  event: WorkspaceEvent
  now: number
}) {
  if (event.status === 'cancelled')
    return (
      <span className="rounded-full bg-coral/10 px-2 py-0.5 text-[10px] font-bold text-coral">
        Cancelled
      </span>
    )
  if (liveOccurrence(event, now))
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-coral px-2 py-0.5 text-[10px] font-bold text-white">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        Live now
      </span>
    )
  return null
}

// One event in the Events list: when (on the event's own clock), what, and
// who it is for, at a glance.
export function EventListItem({
  event,
  now,
  members,
  showWorkspace,
  onOpen,
}: {
  event: WorkspaceEvent
  now: number
  members: WorkspaceMember[]
  // On the Personal Workspace's page, a personal event from a shared
  // workspace names where it lives.
  showWorkspace: boolean
  onOpen: () => void
}) {
  const at = liveOccurrence(event, now) ?? nextOccurrence(event, now)
  const past = isPastEvent(event, now)
  const note = at ? zoneNote(at, event.timezone) : null
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`group flex w-full items-center gap-4 px-4 py-3.5 text-left transition hover:bg-slate-50 ${past ? 'opacity-70' : ''}`}
      >
        <div className="w-20 shrink-0">
          <p className="text-sm font-bold tabular-nums text-ink">
            {at ? formatEventClock(at, event.timezone) : '—'}
          </p>
          {note && (
            <p className="text-[10px] font-semibold text-muted">{note}</p>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p
              className={`truncate text-sm font-semibold text-ink ${event.status === 'cancelled' ? 'line-through' : ''}`}
            >
              {event.title}
            </p>
            <StatusBadge event={event} now={now} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1">
              {event.recurrence !== 'none' && <Repeat size={11} />}
              {scheduleLabel(event, now)}
            </span>
            <ScopeBadge event={event} />
            <span className="inline-flex items-center gap-1">
              <Users size={11} />
              {audienceLabel(event, members)}
            </span>
            {event.reminderOffsets.length > 0 &&
              event.status === 'scheduled' && (
                <span className="inline-flex items-center gap-1">
                  <Bell size={11} />
                  {remindersLabel(event.reminderOffsets)}
                </span>
              )}
            {showWorkspace && event.workspaceType === 'shared' && (
              <span className="font-semibold">in {event.workspaceName}</span>
            )}
          </p>
        </div>
        <ChevronRight
          size={16}
          className="shrink-0 text-muted transition group-hover:translate-x-0.5"
        />
      </button>
    </li>
  )
}
