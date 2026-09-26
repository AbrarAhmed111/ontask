'use client'

import { FormEvent, useState } from 'react'
import { Bell, Lock, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { SelectMenu } from '@/components/ui/SelectMenu'
import { TimeOfDaySelect } from '@/components/workspaces/TimeOfDaySelect'
import { IdeaCreditsPicker } from '@/components/ideas/IdeaCreditsPicker'
import {
  DURATION_OPTIONS,
  EventFormValues,
  REMINDER_OFFSETS,
  durationLabel,
  eventFormProblem,
  recurrenceOptions,
  reminderLabel,
} from '@/lib/events'
import type { EventActionResult } from '@/hooks/useWorkspaceEvents'
import type { EventRecurrence, WorkspaceMember } from '@/types/workspace'

const FIELD_CLASS =
  'mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-[var(--ws-accent,#375b4b)] focus:ring-4 focus:ring-[var(--ws-accent-soft,#e9f0ec)]'

function ScopeOption({
  selected,
  icon: Icon,
  title,
  description,
  onSelect,
}: {
  selected: boolean
  icon: typeof Lock
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex flex-1 items-start gap-2.5 rounded-xl border p-3 text-left transition ${
        selected
          ? 'border-[var(--ws-accent,#375b4b)] bg-[var(--ws-accent-soft,#e9f0ec)]/60'
          : 'border-line hover:border-sage'
      }`}
    >
      <Icon
        size={15}
        className="mt-0.5 shrink-0 text-[var(--ws-accent,#375b4b)]"
      />
      <span>
        <span className="block text-xs font-bold text-ink">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted">
          {description}
        </span>
      </span>
    </button>
  )
}

// Create or edit an event. Only what a reminder needs: what, when (and how
// often), who, and when to remind. `allowWorkspaceScope` offers the
// Personal/Workspace choice (creating only -- an event's kind never changes).
export function EventForm({
  initial,
  mode,
  allowWorkspaceScope,
  showDailyUpdatePrompt,
  members,
  timezones,
  timingLocked,
  onSubmit,
  onCancel,
}: {
  initial: EventFormValues
  mode: 'create' | 'edit'
  allowWorkspaceScope: boolean
  // The Daily Update link exists only in a shared workspace.
  showDailyUpdatePrompt: boolean
  members: WorkspaceMember[]
  timezones: string[]
  // Editing an event whose time is unchanged skips the "in the future" check
  // (a past one-off can still be retitled) -- see timingChanged().
  timingLocked?: (values: EventFormValues) => boolean
  onSubmit: (values: EventFormValues) => Promise<EventActionResult>
  onCancel: () => void
}) {
  const [values, setValues] = useState<EventFormValues>(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const workspace = values.scope === 'workspace'

  const update = <K extends keyof EventFormValues>(
    key: K,
    value: EventFormValues[K],
  ) => setValues(current => ({ ...current, [key]: value }))

  const toggleReminder = (offset: number) =>
    setValues(current => ({
      ...current,
      reminderOffsets: current.reminderOffsets.includes(offset)
        ? current.reminderOffsets.filter(o => o !== offset)
        : [...current.reminderOffsets, offset],
    }))

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = eventFormProblem(
      values,
      Date.now(),
      timingLocked ? !timingLocked(values) : true,
    )
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    const result = await onSubmit(values)
    setSaving(false)
    if (!result.ok) setError(result.error)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {mode === 'create' && allowWorkspaceScope && (
        <div>
          <p className="text-xs font-semibold text-muted">Event type</p>
          <div
            role="radiogroup"
            aria-label="Event type"
            className="mt-2 flex flex-col gap-2 sm:flex-row"
          >
            <ScopeOption
              selected={!workspace}
              icon={Lock}
              title="Personal"
              description="Only you see it and get its reminders."
              onSelect={() => update('scope', 'personal')}
            />
            <ScopeOption
              selected={workspace}
              icon={Users}
              title="Workspace"
              description="Everyone here sees it; you choose who is reminded."
              onSelect={() => update('scope', 'workspace')}
            />
          </div>
        </div>
      )}

      <label className="block text-xs font-semibold text-muted">
        Title
        <input
          required
          autoFocus
          maxLength={120}
          value={values.title}
          onChange={event => update('title', event.target.value)}
          placeholder={workspace ? 'e.g. Daily Standup' : 'e.g. Interview'}
          className={FIELD_CLASS}
        />
      </label>

      <label className="block text-xs font-semibold text-muted">
        Description
        <textarea
          value={values.description}
          maxLength={2000}
          onChange={event => update('description', event.target.value)}
          placeholder="Anything people should know (optional)"
          rows={2}
          className={`${FIELD_CLASS} resize-none`}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-muted">
          Date
          <input
            type="date"
            required
            value={values.startsOn}
            onChange={event => update('startsOn', event.target.value)}
            className={FIELD_CLASS}
          />
        </label>
        <label className="block text-xs font-semibold text-muted">
          Time
          <TimeOfDaySelect
            step={5}
            value={values.startTime}
            onChange={value => update('startTime', value)}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="text-xs font-semibold text-muted">
          Repeat
          <SelectMenu<EventRecurrence>
            label="Repeat"
            value={values.recurrence}
            options={recurrenceOptions(values.startsOn)}
            onChange={value => update('recurrence', value)}
            className="mt-2"
          />
        </div>
        <div className="text-xs font-semibold text-muted">
          Timezone
          <SelectMenu<string>
            label="Timezone"
            value={values.timezone}
            options={timezones.map(zone => ({ value: zone, label: zone }))}
            onChange={value => update('timezone', value)}
            className="mt-2"
          />
        </div>
      </div>

      <div className="text-xs font-semibold text-muted">
        Length
        <SelectMenu<string>
          label="Length"
          value={values.durationMinutes}
          options={DURATION_OPTIONS.map(value => ({
            value,
            label: durationLabel(value),
          }))}
          onChange={value => update('durationMinutes', value)}
          className="mt-2"
        />
      </div>

      <fieldset>
        <legend className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <Bell size={12} /> Notify
        </legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {REMINDER_OFFSETS.map(offset => {
            const on = values.reminderOffsets.includes(offset)
            return (
              <button
                key={offset}
                type="button"
                aria-pressed={on}
                onClick={() => toggleReminder(offset)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                  on
                    ? 'border-[var(--ws-accent,#375b4b)] bg-[var(--ws-accent,#375b4b)] text-white'
                    : 'border-line text-muted hover:border-sage hover:text-ink'
                }`}
              >
                {reminderLabel(offset)}
              </button>
            )
          })}
        </div>
        {values.reminderOffsets.length === 0 && (
          <p className="mt-1.5 text-[11px] text-muted">
            No reminder — nobody will be notified before it starts.
          </p>
        )}
      </fieldset>

      {workspace && (
        <fieldset>
          <legend className="text-xs font-semibold text-muted">Audience</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-xs font-semibold text-ink">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="event-audience"
                checked={values.audience === 'everyone'}
                onChange={() => update('audience', 'everyone')}
                className="accent-[var(--ws-accent,#375b4b)]"
              />
              Everyone in workspace
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="event-audience"
                checked={values.audience === 'selected'}
                onChange={() => update('audience', 'selected')}
                className="accent-[var(--ws-accent,#375b4b)]"
              />
              Selected members
            </label>
          </div>
          {values.audience === 'selected' && (
            <div className="mt-2">
              <IdeaCreditsPicker
                members={members}
                creditedUserIds={values.audienceUserIds}
                onChange={ids => update('audienceUserIds', ids)}
                label="Who should be reminded?"
                listId="event-audience-picker"
              />
              <p className="mt-1.5 text-[11px] text-muted">
                Only these members are reminded. Everyone in the workspace can
                still see the event.
              </p>
            </div>
          )}
          {showDailyUpdatePrompt && (
            <label className="mt-3 flex items-start gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={values.dailyUpdatePrompt}
                onChange={event =>
                  update('dailyUpdatePrompt', event.target.checked)
                }
                className="mt-0.5 h-4 w-4 accent-[var(--ws-accent,#375b4b)]"
              />
              <span>
                <span className="font-semibold">
                  Remind people to have their Daily Update ready
                </span>
                <span className="block text-[11px] text-muted">
                  The reminder links straight to Daily Updates — handy for a
                  standup.
                </span>
              </span>
            </label>
          )}
        </fieldset>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving
            ? 'Saving…'
            : mode === 'create'
              ? 'Create Event'
              : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
