import { parseTimeOfDay, zonedTimeToInstant } from '@/lib/dailyReportWindow'
import { workspaceToday } from '@/lib/dailyUpdates'
import { PERSONAL_WORKSPACE_SLUG } from '@/lib/workspaces'
import type {
  EventAudience,
  EventRecurrence,
  EventScope,
  Workspace,
  WorkspaceEvent,
  WorkspaceMember,
  WorkspaceType,
} from '@/types/workspace'

// The UI side of Events. The server owns time: it works out every occurrence
// (supabase/migrations/20260926220000_workspace_events.sql) and sends each
// event with its next few, so nothing here re-implements recurrence -- the
// client only picks from what it was given, formats it, and counts down.

// Minutes before an occurrence; the only values the database accepts.
export const REMINDER_OFFSETS = [0, 5, 10, 15, 30, 60, 1440] as const
export const DEFAULT_REMINDER_OFFSET = 15

// How long an event with no duration shows as "Live now" after it starts,
// before the Overview moves on to the next one.
export const DEFAULT_LIVE_MINUTES = 15

export const RECURRENCES: EventRecurrence[] = [
  'none',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
]

// ── reading rows ────────────────────────────────────────────────────────────
export type EventRow = {
  id: string
  workspace_id: string
  workspace_name: string
  workspace_slug: string
  workspace_type: WorkspaceType
  scope: EventScope
  created_by: string | null
  title: string
  description: string | null
  starts_on: string
  start_time: string
  timezone: string
  duration_minutes: number | null
  recurrence: EventRecurrence
  reminder_offsets: number[] | null
  audience: EventAudience
  audience_user_ids: string[] | null
  daily_update_prompt: boolean
  status: 'scheduled' | 'cancelled'
  cancelled_at: string | null
  upcoming_occurrences: string[] | null
  last_occurrence_at: string | null
  created_at: string
  updated_at: string
}

export function rowToEvent(row: EventRow): WorkspaceEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    // Routing is slug-based, and a personal workspace is addressed by its alias.
    workspaceSlug:
      row.workspace_type === 'personal'
        ? PERSONAL_WORKSPACE_SLUG
        : row.workspace_slug,
    workspaceType: row.workspace_type,
    scope: row.scope,
    createdBy: row.created_by,
    title: row.title,
    description: row.description,
    startsOn: row.starts_on,
    startTime: row.start_time,
    timezone: row.timezone,
    durationMinutes: row.duration_minutes,
    recurrence: row.recurrence,
    reminderOffsets: row.reminder_offsets ?? [],
    audience: row.audience,
    audienceUserIds: row.audience_user_ids ?? [],
    dailyUpdatePrompt: row.daily_update_prompt,
    status: row.status,
    cancelledAt: row.cancelled_at,
    // Postgres sends timestamptz as "2026-09-28 04:00:00+00"; normalise so
    // Date.parse reads it the same in every engine.
    upcomingOccurrences: (row.upcoming_occurrences ?? []).map(toIso),
    lastOccurrenceAt: row.last_occurrence_at
      ? toIso(row.last_occurrence_at)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Accepts JSON's ISO form and Postgres's text form ("2026-09-28 04:00:00+00",
// whose short "+00" offset Date.parse rejects).
function toIso(value: string): string {
  const normalized = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const time = Date.parse(normalized)
  return Number.isNaN(time) ? value : new Date(time).toISOString()
}

// ── wording ─────────────────────────────────────────────────────────────────
export function reminderLabel(offset: number): string {
  if (offset === 0) return 'At event time'
  if (offset === 60) return '1 hour before'
  if (offset === 1440) return '1 day before'
  return `${offset} minutes before`
}

// Largest first: "1 hour before, 15 minutes before".
export function remindersLabel(offsets: readonly number[]): string {
  if (offsets.length === 0) return 'No reminder'
  return [...offsets]
    .sort((a, b) => b - a)
    .map(reminderLabel)
    .join(', ')
}

function ordinal(day: number): string {
  const tens = day % 100
  if (tens >= 11 && tens <= 13) return `${day}th`
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`
}

// A calendar day ("2026-09-28") read as itself, never shifted by a zone.
function calendarDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date))
}

export function recurrenceLabel(
  recurrence: EventRecurrence,
  startsOn: string,
): string {
  switch (recurrence) {
    case 'daily':
      return 'Every day'
    case 'weekdays':
      return 'Every weekday'
    case 'weekly':
      return `Every ${new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        weekday: 'long',
      }).format(calendarDate(startsOn))}`
    case 'monthly': {
      const day = Number(startsOn.slice(8, 10))
      return day === 1
        ? 'First day of every month'
        : `Every month on the ${ordinal(day)}`
    }
    default:
      return 'Does not repeat'
  }
}

// The option list shown in the form, worded for the chosen start date.
export function recurrenceOptions(startsOn: string) {
  return RECURRENCES.map(value => ({
    value,
    label: recurrenceLabel(value, startsOn || '2026-01-05'),
  }))
}

// "9:00 AM" in `timeZone`.
export function formatEventClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

// "Today", "Tomorrow", "Yesterday", else "Mon, Sep 28" (plus the year when it
// isn't this one) -- all on `timeZone`'s calendar.
export function formatEventDay(
  iso: string,
  timeZone: string,
  now: number = Date.now(),
): string {
  const day = workspaceToday(timeZone, new Date(iso))
  const today = workspaceToday(timeZone, new Date(now))
  const diff = Math.round(
    (calendarDate(day).getTime() - calendarDate(today).getTime()) / 86_400_000,
  )
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}),
  }).format(new Date(iso))
}

// "Mon, Sep 28 · 9:00 AM" style, for one occurrence.
export function formatOccurrence(
  iso: string,
  timeZone: string,
  now: number = Date.now(),
): string {
  return `${formatEventDay(iso, timeZone, now)} · ${formatEventClock(iso, timeZone)}`
}

// How an event's schedule reads at a glance: a recurring one by its rule
// ("Every weekday · 9:00 AM"), a one-off by its day ("Tomorrow · 6:00 PM").
// The time is the event's own wall clock -- the same in every week, whatever
// the DST state.
export function scheduleLabel(
  event: Pick<
    WorkspaceEvent,
    'recurrence' | 'startsOn' | 'startTime' | 'timezone'
  >,
  now: number = Date.now(),
): string {
  const { hour, minute } = parseTimeOfDay(event.startTime)
  const [year, month, day] = event.startsOn.split('-').map(Number)
  const start = zonedTimeToInstant(
    year,
    month,
    day,
    hour,
    minute,
    0,
    event.timezone,
  ).toISOString()
  if (event.recurrence === 'none')
    return formatOccurrence(start, event.timezone, now)
  return `${recurrenceLabel(event.recurrence, event.startsOn)} · ${formatEventClock(start, event.timezone)}`
}

// "Only you", "Everyone", or the chosen members' names.
export function audienceLabel(
  event: Pick<WorkspaceEvent, 'audience' | 'audienceUserIds'>,
  members: WorkspaceMember[],
): string {
  if (event.audience === 'self') return 'Only you'
  if (event.audience === 'everyone') return 'Everyone'
  const names = event.audienceUserIds.map(id => {
    const member = members.find(m => m.userId === id)
    return member?.fullName || member?.email || 'A former member'
  })
  return names.length > 0 ? names.join(', ') : 'Nobody'
}

// "UTC+5" style short name for `timeZone` at `iso`, for when a reader's own
// zone differs from the one an event is shown in.
export function timezoneAbbreviation(iso: string, timeZone: string): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  })
    .formatToParts(new Date(iso))
    .find(p => p.type === 'timeZoneName')
  return part?.value ?? timeZone
}

// ── occurrences ─────────────────────────────────────────────────────────────
function liveWindowMs(event: Pick<WorkspaceEvent, 'durationMinutes'>) {
  return (event.durationMinutes ?? DEFAULT_LIVE_MINUTES) * 60_000
}

// The first occurrence still ahead of `now`, from what the server sent.
export function nextOccurrence(
  event: Pick<WorkspaceEvent, 'status' | 'upcomingOccurrences'>,
  now: number,
): string | null {
  if (event.status !== 'scheduled') return null
  return event.upcomingOccurrences.find(o => Date.parse(o) > now) ?? null
}

// The occurrence under way at `now` (started, and within its duration -- or
// DEFAULT_LIVE_MINUTES when it has none), if any.
export function liveOccurrence(
  event: Pick<
    WorkspaceEvent,
    'status' | 'upcomingOccurrences' | 'lastOccurrenceAt' | 'durationMinutes'
  >,
  now: number,
): string | null {
  if (event.status !== 'scheduled') return null
  const window = liveWindowMs(event)
  const started = [event.lastOccurrenceAt, ...event.upcomingOccurrences]
    .filter((o): o is string => Boolean(o))
    .filter(o => Date.parse(o) <= now && now < Date.parse(o) + window)
  return started.length > 0 ? started[started.length - 1] : null
}

// Nothing more to happen: cancelled, or a one-off (or a series whose known
// occurrences have all passed) that is no longer live.
export function isPastEvent(event: WorkspaceEvent, now: number): boolean {
  return (
    event.status === 'cancelled' ||
    (!nextOccurrence(event, now) && !liveOccurrence(event, now))
  )
}

// Whether a workspace event is FOR this person (it reminds them). Everyone in
// the workspace can see every workspace event; this is what the Overview
// narrows to.
export function isEventForUser(event: WorkspaceEvent, userId: string): boolean {
  if (event.scope === 'personal') return event.createdBy === userId
  return event.audience === 'everyone' || event.audienceUserIds.includes(userId)
}

// ── permissions (the RPCs decide; these only shape the UI) ──────────────────
// can_create_workspace_events: a shared workspace with Events on, and the
// owner -- or any member while the owner lets members create them.
export function canCreateWorkspaceEvents(
  workspace: Pick<
    Workspace,
    'type' | 'eventsEnabled' | 'eventsMembersCanCreate'
  > | null,
  isOwner: boolean,
): boolean {
  if (!workspace || workspace.type !== 'shared' || !workspace.eventsEnabled)
    return false
  return isOwner || workspace.eventsMembersCanCreate
}

// can_manage_workspace_event: a personal event by its creator; a workspace
// event by the owner, or by its creator while members may create events.
export function canManageEvent(
  event: Pick<WorkspaceEvent, 'scope' | 'createdBy'>,
  {
    userId,
    isOwner,
    membersCanCreate,
  }: { userId: string; isOwner: boolean; membersCanCreate: boolean },
): boolean {
  if (event.scope === 'personal') return event.createdBy === userId
  return isOwner || (event.createdBy === userId && membersCanCreate)
}

// ── the list ────────────────────────────────────────────────────────────────
export type EventFilter = 'all' | 'upcoming' | 'personal' | 'workspace' | 'past'

export function filterEvents(
  events: WorkspaceEvent[],
  filter: EventFilter,
  now: number,
): WorkspaceEvent[] {
  switch (filter) {
    case 'upcoming':
      return events.filter(e => !isPastEvent(e, now))
    case 'past':
      return events.filter(e => isPastEvent(e, now))
    case 'personal':
      return events.filter(e => e.scope === 'personal')
    case 'workspace':
      return events.filter(e => e.scope === 'workspace')
    default:
      return events
  }
}

// When an event sorts: live and upcoming by the occurrence they are about;
// past ones by when they last happened (or were cancelled).
function sortTime(event: WorkspaceEvent, now: number): number {
  const at = liveOccurrence(event, now) ?? nextOccurrence(event, now)
  if (at) return Date.parse(at)
  return Date.parse(
    event.lastOccurrenceAt ?? event.cancelledAt ?? event.createdAt,
  )
}

export type EventDayGroup = {
  key: string
  label: string
  events: WorkspaceEvent[]
}

// Upcoming (and live) events grouped by the day of their next occurrence on
// `timeZone`'s calendar, soonest first; then one "Past" group, most recent
// first.
export function groupEventsByDay(
  events: WorkspaceEvent[],
  timeZone: string,
  now: number,
): EventDayGroup[] {
  const upcoming = events
    .filter(e => !isPastEvent(e, now))
    .sort((a, b) => sortTime(a, now) - sortTime(b, now))
  const past = events
    .filter(e => isPastEvent(e, now))
    .sort((a, b) => sortTime(b, now) - sortTime(a, now))

  const groups: EventDayGroup[] = []
  for (const event of upcoming) {
    const at = new Date(sortTime(event, now)).toISOString()
    const key = workspaceToday(timeZone, new Date(at))
    const group = groups.find(g => g.key === key)
    if (group) group.events.push(event)
    else
      groups.push({
        key,
        label: formatEventDay(at, timeZone, now),
        events: [event],
      })
  }
  if (past.length > 0) groups.push({ key: 'past', label: 'Past', events: past })
  return groups
}

// ── the Overview ────────────────────────────────────────────────────────────
// Which event the Overview features. Only 'next' today; an admin-chosen
// featured event would be another strategy here, falling back to 'next' when
// its event is over or gone.
export type OverviewEventStrategy = { kind: 'next' }

export type OverviewEvent = {
  event: WorkspaceEvent
  phase: 'live' | 'upcoming'
  // The occurrence the card is about: the one under way, or the next.
  occurrenceAt: string
}

// A shared workspace's Overview shows its next workspace event that is for
// this person; the Personal Workspace's shows their next personal event. A
// live one wins over an upcoming one (the most recently started if several).
export function pickOverviewEvent(
  events: WorkspaceEvent[],
  {
    scope,
    userId,
    now,
    strategy = { kind: 'next' },
  }: {
    scope: EventScope
    userId: string
    now: number
    strategy?: OverviewEventStrategy
  },
): OverviewEvent | null {
  void strategy
  const candidates = events.filter(
    e =>
      e.scope === scope &&
      e.status === 'scheduled' &&
      isEventForUser(e, userId),
  )
  let live: OverviewEvent | null = null
  let next: OverviewEvent | null = null
  for (const event of candidates) {
    const liveAt = liveOccurrence(event, now)
    if (liveAt && (!live || Date.parse(liveAt) > Date.parse(live.occurrenceAt)))
      live = { event, phase: 'live', occurrenceAt: liveAt }
    const nextAt = nextOccurrence(event, now)
    if (nextAt && (!next || Date.parse(nextAt) < Date.parse(next.occurrenceAt)))
      next = { event, phase: 'upcoming', occurrenceAt: nextAt }
  }
  return live ?? next
}

// ── the countdown ───────────────────────────────────────────────────────────
export type CountdownParts = {
  days: number
  hours: number
  minutes: number
  seconds: number
}

export function countdownParts(msRemaining: number): CountdownParts {
  const total = Math.max(0, Math.floor(msRemaining / 1000))
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}

export const pad2 = (value: number) => String(value).padStart(2, '0')

// "02:14" under an hour, "1:02:14" from an hour.
export function elapsedLabel(msElapsed: number): string {
  const { days, hours, minutes, seconds } = countdownParts(msElapsed)
  const totalHours = days * 24 + hours
  return totalHours > 0
    ? `${totalHours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(minutes)}:${pad2(seconds)}`
}

// ── the form ────────────────────────────────────────────────────────────────
export type EventFormValues = {
  scope: EventScope
  title: string
  description: string
  // "2026-09-28" and "09:00".
  startsOn: string
  startTime: string
  timezone: string
  // '' = no duration.
  durationMinutes: string
  recurrence: EventRecurrence
  reminderOffsets: number[]
  // Workspace events only.
  audience: 'everyone' | 'selected'
  audienceUserIds: string[]
  dailyUpdatePrompt: boolean
}

export const DURATION_OPTIONS = ['', '15', '30', '45', '60', '90', '120']

export function durationLabel(value: string): string {
  if (!value) return 'No set length'
  const minutes = Number(value)
  if (minutes < 60) return `${minutes} minutes`
  const hours = minutes / 60
  return hours === 1 ? '1 hour' : `${hours} hours`
}

// The next whole hour on the event's clock, today (or tomorrow when that has
// passed): a sensible start for a new event.
export function emptyEventForm({
  scope,
  timezone,
  now = Date.now(),
}: {
  scope: EventScope
  timezone: string
  now?: number
}): EventFormValues {
  const nextHour = new Date(Math.ceil((now + 1) / 3_600_000) * 3_600_000)
  const startsOn = workspaceToday(timezone, nextHour)
  // Some ICU versions render midnight as "24" even with h23.
  const hour =
    Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(nextHour),
    ) % 24
  return {
    scope,
    title: '',
    description: '',
    startsOn,
    startTime: `${pad2(hour)}:00`,
    timezone,
    durationMinutes: '',
    recurrence: 'none',
    reminderOffsets: [DEFAULT_REMINDER_OFFSET],
    audience: 'everyone',
    audienceUserIds: [],
    dailyUpdatePrompt: false,
  }
}

export function eventToForm(event: WorkspaceEvent): EventFormValues {
  return {
    scope: event.scope,
    title: event.title,
    description: event.description ?? '',
    startsOn: event.startsOn,
    startTime: event.startTime.slice(0, 5),
    timezone: event.timezone,
    durationMinutes: event.durationMinutes ? String(event.durationMinutes) : '',
    recurrence: event.recurrence,
    reminderOffsets: [...event.reminderOffsets],
    audience: event.audience === 'selected' ? 'selected' : 'everyone',
    audienceUserIds: [...event.audienceUserIds],
    dailyUpdatePrompt: event.dailyUpdatePrompt,
  }
}

// The instant the form's date + time names, on its own timezone.
export function formStartInstant(values: EventFormValues): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.startsOn)) return null
  if (!/^\d{2}:\d{2}$/.test(values.startTime)) return null
  const [year, month, day] = values.startsOn.split('-').map(Number)
  const { hour, minute } = parseTimeOfDay(values.startTime)
  try {
    return zonedTimeToInstant(
      year,
      month,
      day,
      hour,
      minute,
      0,
      values.timezone,
    )
  } catch {
    return null
  }
}

// What's wrong with the form, in words, or null. The server checks the same
// things; this only saves a round trip. `timingChanged` false (an edit that
// leaves the time alone) skips the "in the future" rule, as the server does.
export function eventFormProblem(
  values: EventFormValues,
  now: number = Date.now(),
  timingChanged = true,
): string | null {
  if (!values.title.trim()) return 'Give the event a title.'
  if (values.title.trim().length > 120)
    return 'Keep the title under 120 characters.'
  const start = formStartInstant(values)
  if (!start) return 'Choose a date and time.'
  if (timingChanged && values.recurrence === 'none' && start.getTime() <= now)
    return 'Choose a time in the future.'
  if (
    values.scope === 'workspace' &&
    values.audience === 'selected' &&
    values.audienceUserIds.length === 0
  )
    return 'Choose at least one member.'
  return null
}

export function timingChanged(
  values: EventFormValues,
  event: WorkspaceEvent,
): boolean {
  return (
    values.startsOn !== event.startsOn ||
    values.startTime !== event.startTime.slice(0, 5) ||
    values.timezone !== event.timezone ||
    values.recurrence !== event.recurrence
  )
}

// The arguments shared by create_workspace_event and update_workspace_event.
export function formToRpcArgs(values: EventFormValues) {
  const workspace = values.scope === 'workspace'
  return {
    p_title: values.title.trim(),
    p_description: values.description.trim() || null,
    p_starts_on: values.startsOn,
    p_start_time: values.startTime,
    p_timezone: values.timezone,
    p_duration_minutes: values.durationMinutes
      ? Number(values.durationMinutes)
      : null,
    p_recurrence: values.recurrence,
    p_reminder_offsets: [...values.reminderOffsets].sort((a, b) => b - a),
    p_audience: workspace ? values.audience : 'self',
    p_audience_user_ids:
      workspace && values.audience === 'selected' ? values.audienceUserIds : [],
    p_daily_update_prompt: workspace && values.dailyUpdatePrompt,
  }
}

// Where an event opens: its own workspace's Events page with it selected.
export function eventHref(workspaceSlug: string, eventId: string): string {
  return `/workspaces/${workspaceSlug}/events?event=${encodeURIComponent(eventId)}`
}
