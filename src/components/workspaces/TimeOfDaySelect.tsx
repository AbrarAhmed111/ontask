'use client'

import { formatTimeOfDay } from '@/lib/dailyReportWindow'

// Fixed increments only (15 minutes by default: 00:00, 00:15 ... 23:45; events
// use 5) -- a dropdown
// instead of a native `<input type="time">` both guarantees this (the
// native picker's `step` attribute doesn't reliably block manual keyboard
// entry across browsers) and lets it pick up the workspace's accent color,
// which a native time picker's own popover UI can't be styled with.
function optionsEvery(stepMinutes: number) {
  return Array.from({ length: (24 * 60) / stepMinutes }, (_, i) => {
    const hour = Math.floor((i * stepMinutes) / 60)
    const minute = (i * stepMinutes) % 60
    const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    return { value, label: formatTimeOfDay(`${value}:00`) }
  })
}

const OPTIONS_BY_STEP = new Map<number, ReturnType<typeof optionsEvery>>()
function options(stepMinutes: number) {
  let list = OPTIONS_BY_STEP.get(stepMinutes)
  if (!list) {
    list = optionsEvery(stepMinutes)
    OPTIONS_BY_STEP.set(stepMinutes, list)
  }
  return list
}

export function TimeOfDaySelect({
  value,
  onChange,
  step = 15,
  label,
}: {
  value: string
  onChange: (value: string) => void
  // Minutes between options; must divide an hour.
  step?: number
  // Accessible name, when the select isn't inside its own <label>.
  label?: string
}) {
  return (
    <select
      required
      aria-label={label}
      value={value}
      onChange={event => onChange(event.target.value)}
      className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-[var(--ws-accent,#375b4b)] focus:ring-4 focus:ring-[var(--ws-accent-soft,#e9f0ec)]"
    >
      {options(step).map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
