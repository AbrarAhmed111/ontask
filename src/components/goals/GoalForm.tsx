'use client'

import { FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { GoalFormValues } from '@/hooks/useWorkspaceGoals'
import { IdeaSelect } from '@/components/ideas/IdeaSelect'
import type { Idea } from '@/types/workspace'

export function GoalForm({
  values,
  setValues,
  submitLabel,
  onSubmit,
  onCancel,
  ideas,
}: {
  values: GoalFormValues
  setValues: (values: GoalFormValues) => void
  submitLabel: string
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
  ideas?: Idea[]
}) {
  const update = (key: keyof GoalFormValues, value: string) =>
    setValues({ ...values, [key]: value })
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-xs font-semibold text-muted">
        Goal name
        <input
          required
          autoFocus
          value={values.name}
          onChange={event => update('name', event.target.value)}
          placeholder="e.g. School Management System MVP"
          className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-sage focus:ring-4 focus:ring-sage/15"
        />
      </label>
      <label className="block text-xs font-semibold text-muted">
        Description
        <textarea
          value={values.description}
          onChange={event => update('description', event.target.value)}
          placeholder="What outcome is this goal trying to achieve? (optional)"
          rows={3}
          className="mt-2 w-full resize-none rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-sage focus:ring-4 focus:ring-sage/15"
        />
      </label>
      <label className="block text-xs font-semibold text-muted">
        Target date (optional)
        <input
          type="date"
          value={values.targetDate}
          onChange={event => update('targetDate', event.target.value)}
          className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-sage focus:ring-4 focus:ring-sage/15"
        />
      </label>
      {ideas && (
        <IdeaSelect
          ideas={ideas}
          value={values.ideaId || ''}
          onChange={ideaId => update('ideaId', ideaId)}
        />
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
