'use client'

import { FormEvent } from 'react'
import { TaskFormValues } from '@/types'
import { Idea, WorkspaceMember } from '@/types/workspace'
import { Button } from '@/components/ui/Button'
import { IdeaSelect } from '@/components/ideas/IdeaSelect'

// The one form for creating or editing a task — the guest's local tasks and
// every kind of workspace task have the same fields. The only structural
// difference is handing a task to someone else, so that's the one optional
// slot; the wording differs a little between a guest's "today" and a
// workspace's plan, so that's two strings.
export function TaskForm({
  values,
  setValues,
  submitLabel,
  onSubmit,
  onCancel,
  assignment,
  ideas,
  targetLabel = "Today's target",
  namePlaceholder = 'e.g. Project Development',
}: {
  values: TaskFormValues
  setValues: (values: TaskFormValues) => void
  submitLabel: string
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
  // Present only where a task can be given to someone else (a shared
  // workspace). Omit it for the guest dashboard and a personal workspace.
  assignment?: {
    members: WorkspaceMember[]
    assignedTo: string
    onChange: (userId: string) => void
  }
  ideas?: Idea[]
  targetLabel?: string
  namePlaceholder?: string
}) {
  const update = (key: keyof TaskFormValues, value: string | boolean) =>
    setValues({ ...values, [key]: value })
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-xs font-semibold text-muted">
        Task name
        <input
          required
          value={values.name}
          onChange={event => update('name', event.target.value)}
          placeholder={namePlaceholder}
          className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-sage focus:ring-4 focus:ring-sage/15"
        />
      </label>
      <label className="block text-xs font-semibold text-muted">
        Description{' '}
        <span className="font-normal text-muted/80">(optional)</span>
        <textarea
          rows={2}
          value={values.description || ''}
          onChange={event => update('description', event.target.value)}
          placeholder="Add details or notes..."
          className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-sage focus:ring-4 focus:ring-sage/15 resize-y"
        />
      </label>
      {assignment && (
        <label className="block text-xs font-semibold text-muted">
          Assign to
          <select
            value={assignment.assignedTo}
            onChange={event => assignment.onChange(event.target.value)}
            className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-sage focus:ring-4 focus:ring-sage/15"
          >
            <option value="">Unassigned</option>
            {assignment.members.map(member => (
              <option key={member.userId} value={member.userId}>
                {member.fullName || member.email}
              </option>
            ))}
          </select>
        </label>
      )}
      {ideas && (
        <IdeaSelect
          ideas={ideas}
          value={values.ideaId || ''}
          onChange={ideaId => update('ideaId', ideaId)}
        />
      )}
      <label className="block text-xs font-semibold text-muted">
        {targetLabel}{' '}
        <span className="font-normal text-muted/80">(optional)</span>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            min="0"
            value={values.hours}
            onChange={event => update('hours', event.target.value)}
            placeholder="0"
            className="w-20 rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-sage focus:ring-4 focus:ring-sage/15"
          />
          <span className="text-[11px] font-normal">hours</span>
          <input
            type="number"
            min="0"
            max="59"
            value={values.minutes}
            onChange={event => update('minutes', event.target.value)}
            placeholder="0"
            className="w-20 rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-sage focus:ring-4 focus:ring-sage/15"
          />
          <span className="text-[11px] font-normal">minutes</span>
        </div>
      </label>
      <label className="flex items-center gap-2 text-xs font-semibold text-ink">
        <input
          type="checkbox"
          checked={values.trackGoal}
          onChange={event => update('trackGoal', event.target.checked)}
          className="h-4 w-4 accent-forest"
        />{' '}
        Track overall goal
      </label>
      {values.trackGoal && (
        <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
          <label className="block text-xs font-semibold text-muted">
            Goal name
            <input
              value={values.goal}
              onChange={event => update('goal', event.target.value)}
              placeholder="Optional goal"
              className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-sage focus:ring-4 focus:ring-sage/15"
            />
          </label>
          <label className="block text-xs font-semibold text-muted">
            Progress
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="100"
                value={values.progress}
                onChange={event => update('progress', event.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-sage focus:ring-4 focus:ring-sage/15"
              />
              <span className="text-forest">%</span>
            </div>
          </label>
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  )
}
