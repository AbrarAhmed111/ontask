// The timezones OnTask offers in its pickers (workspace create/edit, events),
// plus whatever the browser reports if it isn't one of them.
export const COMMON_TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
]

export function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// The common list with `extra` zones (the current value, the browser's) put
// first when they aren't already in it.
export function timezoneOptions(...extra: (string | null | undefined)[]) {
  const missing = extra.filter(
    (zone, index): zone is string =>
      Boolean(zone) &&
      !COMMON_TIMEZONES.includes(zone as string) &&
      extra.indexOf(zone) === index,
  )
  return [...missing, ...COMMON_TIMEZONES]
}
