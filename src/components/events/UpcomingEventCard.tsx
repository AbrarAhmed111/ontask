'use client'

import Link from 'next/link'
import { CalendarClock, Radio } from 'lucide-react'
import { useWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import { useWorkspaceEvents } from '@/hooks/useWorkspaceEvents'
import { useNow } from '@/hooks/useNow'
import {
  OverviewEvent,
  canCreateWorkspaceEvents,
  countdownParts,
  elapsedLabel,
  eventHref,
  formatOccurrence,
  pad2,
  pickOverviewEvent,
  scheduleLabel,
} from '@/lib/events'

const LINK_CLASS =
  'inline-flex shrink-0 items-center justify-center rounded-lg bg-[var(--ws-accent,#375b4b)] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-90'

function CountdownUnit({ value, unit }: { value: number; unit: string }) {
  return (
    <div className="min-w-[46px] rounded-lg bg-[var(--ws-accent-soft,#e9f0ec)]/70 px-2 py-1.5 text-center">
      <p className="font-mono text-lg font-bold leading-none tabular-nums text-ink">
        {pad2(value)}
      </p>
      <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
        {unit}
      </p>
    </div>
  )
}

export function Countdown({ msRemaining }: { msRemaining: number }) {
  const { days, hours, minutes, seconds } = countdownParts(msRemaining)
  return (
    <div
      className="flex items-center gap-1.5"
      role="timer"
      aria-label={`Starts in ${days} days, ${hours} hours, ${minutes} minutes`}
    >
      <CountdownUnit value={days} unit="Days" />
      <CountdownUnit value={hours} unit="Hours" />
      <CountdownUnit value={minutes} unit="Min" />
      <CountdownUnit value={seconds} unit="Sec" />
    </div>
  )
}

// The card itself, given what to show -- separate from the data so every
// state (upcoming, live, none) can be rendered and tested on its own.
export function UpcomingEventView({
  featured,
  now,
  showCountdown,
  emptyMessage,
  createHref,
}: {
  featured: OverviewEvent | null
  now: number
  showCountdown: boolean
  emptyMessage: string
  // Offered on the empty state when the viewer may create workspace events.
  createHref: string | null
}) {
  if (!featured) {
    return (
      <section
        aria-label="Upcoming event"
        className="flex flex-col gap-3 rounded-2xl border border-dashed border-sage/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-2.5">
          <CalendarClock size={16} className="text-sage" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
              Upcoming event
            </p>
            <p className="text-xs text-muted">{emptyMessage}</p>
          </div>
        </div>
        {createHref && (
          <Link href={createHref} className={LINK_CLASS}>
            Create Event
          </Link>
        )}
      </section>
    )
  }

  const { event, phase, occurrenceAt } = featured
  const href = eventHref(event.workspaceSlug, event.id)
  const live = phase === 'live'
  const startsAt = Date.parse(occurrenceAt)

  return (
    <section
      aria-label={live ? 'Live event' : 'Upcoming event'}
      className="flex flex-col gap-4 rounded-2xl border border-line bg-panel px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="min-w-0">
        <p
          className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${live ? 'text-coral' : 'text-muted'}`}
        >
          {live ? (
            <>
              <Radio size={12} className="animate-pulse" /> Live now
            </>
          ) : (
            <>
              <CalendarClock size={12} /> Upcoming event
            </>
          )}
        </p>
        <p className="mt-1 truncate text-base font-bold text-ink">
          {event.title}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {live
            ? `Started ${elapsedLabel(now - startsAt)} ago`
            : event.recurrence === 'none'
              ? scheduleLabel(event, now)
              : `${scheduleLabel(event, now)} · next ${formatOccurrence(occurrenceAt, event.timezone, now)}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {!live && showCountdown && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
              Starts in
            </span>
            <Countdown msRemaining={startsAt - now} />
          </div>
        )}
        <Link href={href} className={LINK_CLASS}>
          {live ? 'Open Event' : 'View Event'}
        </Link>
      </div>
    </section>
  )
}

// The Overview's next event. A shared workspace: its next workspace event for
// this person, while the owner has Events and "show on Overview" on. The
// Personal Workspace: the user's own next personal event, only when there is
// one. The countdown ticks in the browser from the occurrence's timestamp;
// only reaching the end of the known occurrences ever refetches.
export function UpcomingEventCard() {
  const { workspace, workspaceId, user, isOwner, isPersonal } =
    useWorkspaceDetail()
  const visible = Boolean(
    workspace &&
    (isPersonal ||
      (workspace.eventsEnabled && workspace.eventsOverviewEnabled)),
  )
  const { events, ready } = useWorkspaceEvents(workspaceId, user, {
    isPersonal,
    enabled: visible,
  })
  const featuredNow = useNow(1000, visible && events.length > 0)
  const featured = visible
    ? pickOverviewEvent(events, {
        scope: isPersonal ? 'personal' : 'workspace',
        userId: user.id,
        now: featuredNow,
      })
    : null

  if (!visible || !ready || !workspace) return null
  if (!featured && isPersonal) return null

  const canCreate = canCreateWorkspaceEvents(workspace, isOwner)
  return (
    <UpcomingEventView
      featured={featured}
      now={featuredNow}
      showCountdown={isPersonal || workspace.eventsCountdownEnabled}
      emptyMessage={
        canCreate ? 'No upcoming events.' : 'No upcoming workspace events.'
      }
      createHref={canCreate ? `/workspaces/${workspace.slug}/events?new` : null}
    />
  )
}
