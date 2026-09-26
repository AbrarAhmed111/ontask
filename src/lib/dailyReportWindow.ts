// Pure, timezone-aware window math for the automatic Daily Report feature.
// This is a display/UI-only helper (e.g. "Next report: Today at 12:00 PM") --
// the actual report windows persisted to workspace_daily_summaries are always
// computed server-side, by the equivalent logic in
// supabase/migrations/0018_automatic_daily_reports.sql's
// list_workspaces_due_for_daily_report(). Kept in sync deliberately: both
// derive "the most recent local `reportTime` <= now" the same way, then
// report_start = report_end - 24h exactly (not "yesterday's local
// `reportTime`", which can differ from a true 24h subtraction across a DST
// boundary). `reportTime` itself is a per-workspace setting (workspaces.report_time,
// default 12:00) rather than a hardcoded noon -- see EditWorkspaceModal.tsx.
//
// No timezone-database library is used -- Intl.DateTimeFormat (built into
// every JS runtime with ICU data, which Node/browsers both ship) is enough
// to ask "what's the wall-clock date/time in this IANA zone right now", and
// the standard guess-then-correct trick below converts a wall-clock time
// back to an absolute instant without needing that database ourselves.

export type TimeOfDay = { hour: number; minute: number }

/** Parses a Postgres `time` column value ("12:00:00" or "12:00") into hour/minute. */
export function parseTimeOfDay(value: string): TimeOfDay {
  const [h, m] = value.split(':')
  return { hour: Number(h) || 0, minute: Number(m) || 0 }
}

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (type: string) =>
    Number(parts.find(p => p.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // formatToParts with hourCycle 'h23' can render midnight as "24" in some
    // ICU versions -- normalize back into 0-23.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

function shiftLocalDate(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

// Converts a local wall-clock date+time in `timeZone` to the absolute instant
// (UTC) it represents. Standard technique: interpret the wall-clock fields as
// if they were UTC to get a first guess, measure how far that guess's
// wall-clock reading in `timeZone` is from the target, and correct by that
// offset. One pass is sufficient outside the DST-transition instant itself.
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second)
  const guess = new Date(asUtcMs)
  const seenInZone = partsInZone(guess, timeZone)
  const seenAsUtcMs = Date.UTC(
    seenInZone.year,
    seenInZone.month - 1,
    seenInZone.day,
    seenInZone.hour,
    seenInZone.minute,
    seenInZone.second,
  )
  const offsetMs = seenAsUtcMs - asUtcMs
  return new Date(asUtcMs - offsetMs)
}

const DAY_MS = 24 * 60 * 60 * 1000

function isAtOrPastTarget(local: ZonedParts, target: TimeOfDay): boolean {
  return (
    local.hour > target.hour ||
    (local.hour === target.hour && local.minute >= target.minute)
  )
}

/**
 * The workspace's current rolling-24h reporting window: report_end is the
 * most recent local occurrence of `reportTime` in `timeZone` that is at or
 * before `now`; report_start is exactly 24 hours before that instant.
 */
export function mostRecentReportTime(
  timeZone: string,
  reportTime: TimeOfDay,
  now: Date = new Date(),
): { reportStart: Date; reportEnd: Date } {
  const local = partsInZone(now, timeZone)
  const candidate = isAtOrPastTarget(local, reportTime)
    ? { year: local.year, month: local.month, day: local.day }
    : shiftLocalDate(local.year, local.month, local.day, -1)
  const reportEnd = zonedTimeToInstant(
    candidate.year,
    candidate.month,
    candidate.day,
    reportTime.hour,
    reportTime.minute,
    0,
    timeZone,
  )
  return { reportStart: new Date(reportEnd.getTime() - DAY_MS), reportEnd }
}

/**
 * The next upcoming local occurrence of `reportTime` in `timeZone`, strictly
 * after `now`. Always recomputed from the calendar date (not derived by
 * adding 24h to the previous occurrence) so it stays correct across a DST
 * transition.
 */
export function nextReportTime(
  timeZone: string,
  reportTime: TimeOfDay,
  now: Date = new Date(),
): Date {
  const local = partsInZone(now, timeZone)
  const candidate = isAtOrPastTarget(local, reportTime)
    ? shiftLocalDate(local.year, local.month, local.day, 1)
    : { year: local.year, month: local.month, day: local.day }
  return zonedTimeToInstant(
    candidate.year,
    candidate.month,
    candidate.day,
    reportTime.hour,
    reportTime.minute,
    0,
    timeZone,
  )
}

/** True if `date` falls on the same local calendar day as `now`, in `timeZone`. */
export function isLocalToday(
  date: Date,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  const a = partsInZone(date, timeZone)
  const b = partsInZone(now, timeZone)
  return a.year === b.year && a.month === b.month && a.day === b.day
}

/** "Sep 17, 12:00 PM" -- for displaying a report's frozen boundaries in its own report_timezone. */
export function formatBoundary(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/** "12:00:00" -> "12:00 PM" -- renders a workspace's configured report_time (a bare
 * wall-clock time, no timezone attached) without going through any particular zone. */
export function formatTimeOfDay(value: string): string {
  const { hour, minute } = parseTimeOfDay(value)
  const reference = new Date(Date.UTC(2000, 0, 1, hour, minute))
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(reference)
}

/** Rounds a `TimeOfDay` value to the nearest 15-minute mark ("HH:MM"),
 * wrapping 23:53-23:59 up to the next day's 00:00 rather than an invalid
 * "24:00" -- used to snap a pre-existing report_time onto the quarter-hour
 * grid the report time selector offers, in case it was saved before that
 * restriction existed. */
export function roundToQuarterHour(value: string): string {
  const { hour, minute } = parseTimeOfDay(value)
  const totalMinutes = (Math.round((hour * 60 + minute) / 15) * 15) % (24 * 60)
  const roundedHour = Math.floor(totalMinutes / 60)
  const roundedMinute = totalMinutes % 60
  return `${String(roundedHour).padStart(2, '0')}:${String(roundedMinute).padStart(2, '0')}`
}
