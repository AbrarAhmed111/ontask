'use client'

import { FormEvent, useMemo, useState } from 'react'
import { Clock, Save } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Modal } from '@/components/ui/Modal'
import type {
  MemberAvailabilityPatch,
  WorkspaceMember,
} from '@/types/workspace'

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

type FormState = {
  workingHoursStart: string
  workingHoursEnd: string
  workingTimezone: string
  workingDays: number[]
  standupAvailabilityStart: string
  standupAvailabilityEnd: string
  standupAvailabilityDays: number[]
  minimumWorkingHours: string
}

const timeInputValue = (value: string | null) => value?.slice(0, 5) ?? ''

const toTimeValue = (value: string) => (value ? `${value}:00` : null)

function sortedDays(days: number[]) {
  const order = new Map(WEEKDAYS.map((day, index) => [day.value, index]))
  return [...new Set(days)].sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99),
  )
}

function toggleDay(days: number[], day: number) {
  return days.includes(day)
    ? days.filter(value => value !== day)
    : sortedDays([...days, day])
}

function validateTimeRange(start: string, end: string, label: string) {
  if (!start && !end) return null
  if (!start || !end) return `${label} needs both a start and end time.`
  if (start >= end) return `${label} end time must be after the start time.`
  return null
}

function isValidTimezone(value: string) {
  if (!value) return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function MemberAvailabilityModal({
  member,
  onSave,
  onClose,
}: {
  member: WorkspaceMember
  onSave: (
    memberId: string,
    patch: MemberAvailabilityPatch,
  ) => Promise<{ success: boolean; error?: string }>
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>(() => ({
    workingHoursStart: timeInputValue(member.workingHoursStart ?? null),
    workingHoursEnd: timeInputValue(member.workingHoursEnd ?? null),
    workingTimezone: member.workingTimezone ?? '',
    workingDays: member.workingDays ?? [],
    standupAvailabilityStart: timeInputValue(
      member.standupAvailabilityStart ?? null,
    ),
    standupAvailabilityEnd: timeInputValue(
      member.standupAvailabilityEnd ?? null,
    ),
    standupAvailabilityDays: member.standupAvailabilityDays ?? [],
    minimumWorkingHours:
      member.minimumWorkingMinutes == null
        ? ''
        : String(member.minimumWorkingMinutes / 60),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const memberName = member.fullName || member.email || 'Member'

  const timezoneHint = useMemo(() => {
    const zone = form.workingTimezone.trim()
    if (!zone || !isValidTimezone(zone)) return null
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date())
    return parts.find(part => part.type === 'timeZoneName')?.value ?? null
  }, [form.workingTimezone])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(current => ({ ...current, [key]: value }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const rangeError =
      validateTimeRange(
        form.workingHoursStart,
        form.workingHoursEnd,
        'Working hours',
      ) ??
      validateTimeRange(
        form.standupAvailabilityStart,
        form.standupAvailabilityEnd,
        'Standup availability',
      )
    if (rangeError) {
      setError(rangeError)
      return
    }
    const timezone = form.workingTimezone.trim()
    if (!isValidTimezone(timezone)) {
      setError('Use a valid IANA timezone, for example Asia/Karachi.')
      return
    }
    const minimum =
      form.minimumWorkingHours.trim() === ''
        ? null
        : Number(form.minimumWorkingHours)
    if (
      minimum !== null &&
      (!Number.isFinite(minimum) || minimum < 0 || minimum > 24)
    ) {
      setError('Minimum working hours must be between 0 and 24.')
      return
    }

    setSaving(true)
    const result = await onSave(member.id, {
      workingHoursStart: toTimeValue(form.workingHoursStart),
      workingHoursEnd: toTimeValue(form.workingHoursEnd),
      workingTimezone: timezone || null,
      workingDays: sortedDays(form.workingDays),
      standupAvailabilityStart: toTimeValue(form.standupAvailabilityStart),
      standupAvailabilityEnd: toTimeValue(form.standupAvailabilityEnd),
      standupAvailabilityDays: sortedDays(form.standupAvailabilityDays),
      minimumWorkingMinutes: minimum === null ? null : Math.round(minimum * 60),
    })
    setSaving(false)
    if (result.success) {
      onClose()
      return
    }
    setError(result.error || 'Availability could not be saved.')
  }

  return (
    <Modal
      title="Member availability"
      eyebrow={memberName}
      onClose={onClose}
      size="md"
    >
      <form onSubmit={submit} className="space-y-5">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <fieldset className="space-y-3">
          <legend className="flex items-center gap-2 text-xs font-bold text-ink">
            <Clock size={14} /> Working Hours
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <TimeField
              label="Start"
              value={form.workingHoursStart}
              onChange={value => update('workingHoursStart', value)}
            />
            <TimeField
              label="End"
              value={form.workingHoursEnd}
              onChange={value => update('workingHoursEnd', value)}
            />
          </div>
          <DayPicker
            days={form.workingDays}
            onToggle={day =>
              update('workingDays', toggleDay(form.workingDays, day))
            }
          />
          <label className="block">
            <span className="text-[11px] font-semibold text-muted">
              Timezone
            </span>
            <input
              value={form.workingTimezone}
              onChange={event => update('workingTimezone', event.target.value)}
              placeholder="Asia/Karachi"
              className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-[var(--ws-accent,#375b4b)]"
            />
            {timezoneHint && (
              <span className="mt-1 block text-[10px] text-muted">
                {timezoneHint}
              </span>
            )}
          </label>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs font-bold text-ink">
            Standup Availability
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <TimeField
              label="Start"
              value={form.standupAvailabilityStart}
              onChange={value => update('standupAvailabilityStart', value)}
            />
            <TimeField
              label="End"
              value={form.standupAvailabilityEnd}
              onChange={value => update('standupAvailabilityEnd', value)}
            />
          </div>
          <DayPicker
            days={form.standupAvailabilityDays}
            onToggle={day =>
              update(
                'standupAvailabilityDays',
                toggleDay(form.standupAvailabilityDays, day),
              )
            }
          />
        </fieldset>

        <label className="block">
          <span className="text-xs font-bold text-ink">
            Minimum Working Hours
          </span>
          <input
            type="number"
            min="0"
            max="24"
            step="0.25"
            value={form.minimumWorkingHours}
            onChange={event =>
              update('minimumWorkingHours', event.target.value)
            }
            placeholder="8"
            className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-[var(--ws-accent,#375b4b)]"
          />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            <Save size={14} /> {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-muted">{label}</span>
      <input
        type="time"
        value={value}
        onChange={event => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-[var(--ws-accent,#375b4b)]"
      />
    </label>
  )
}

function DayPicker({
  days,
  onToggle,
}: {
  days: number[]
  onToggle: (day: number) => void
}) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {WEEKDAYS.map(day => {
        const selected = days.includes(day.value)
        return (
          <button
            key={day.value}
            type="button"
            onClick={() => onToggle(day.value)}
            className={`h-8 rounded-lg border text-[10px] font-semibold transition ${
              selected
                ? 'border-[var(--ws-accent,#375b4b)] bg-[var(--ws-accent-soft,#e9f0ec)] text-[var(--ws-accent,#375b4b)]'
                : 'border-line bg-paper text-muted hover:text-ink'
            }`}
          >
            {day.label}
          </button>
        )
      })}
    </div>
  )
}
