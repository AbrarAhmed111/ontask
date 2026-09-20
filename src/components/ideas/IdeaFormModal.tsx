'use client'

import { FormEvent, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IdeaCreditsPicker } from '@/components/ideas/IdeaCreditsPicker'
import type { Idea, IdeaType, WorkspaceMember } from '@/types/workspace'
import type { IdeaFormInput } from '@/hooks/useWorkspaceIdeas'

const IDEA_TYPES: { type: IdeaType; label: string }[] = [
  { type: 'idea', label: 'Idea' },
  { type: 'important', label: 'Important' },
  { type: 'improvement', label: 'Improvement' },
  { type: 'experiment', label: 'Experiment' },
  { type: 'opportunity', label: 'Opportunity' },
  { type: 'problem', label: 'Problem' },
  { type: 'research', label: 'Research' },
  { type: 'reminder', label: 'Reminder' },
  { type: 'question', label: 'Question' },
]

export function IdeaFormModal({
  initial,
  members,
  onSubmit,
  onClose,
}: {
  initial?: Idea
  members: WorkspaceMember[]
  onSubmit: (input: IdeaFormInput) => Promise<boolean>
  onClose: () => void
}) {
  const [title, setTitle] = useState(initial?.title || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [type, setType] = useState<IdeaType>(initial?.type || 'idea')
  const [creditedUserIds, setCreditedUserIds] = useState<string[]>(
    initial?.creditedUserIds || [],
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)

    const success = await onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      creditedUserIds,
    })

    setSubmitting(false)
    if (success) {
      onClose()
    } else {
      setError('Failed to save idea. Please try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-paper p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <h2 className="text-lg font-bold text-ink">
            {initial ? 'Edit Idea' : 'Capture Idea'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:bg-white hover:text-ink transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-600 font-medium">
              {error}
            </div>
          )}

          {/* Title */}
          <label className="block text-xs font-semibold text-muted">
            Title <span className="text-rose-500">*</span>
            <input
              required
              autoFocus
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Add Calendar Booking to Cold DM System"
              className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-sage focus:ring-4 focus:ring-sage/15"
            />
          </label>

          {/* Description */}
          <label className="block text-xs font-semibold text-muted">
            Description{' '}
            <span className="font-normal text-muted/80">(optional)</span>
            <textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Add details, rationale, or references..."
              className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-sage focus:ring-4 focus:ring-sage/15 resize-y"
            />
          </label>

          {/* Type Selector */}
          <label className="block text-xs font-semibold text-muted">
            Type
            <select
              value={type}
              onChange={e => setType(e.target.value as IdeaType)}
              className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-sage focus:ring-4 focus:ring-sage/15"
            >
              {IDEA_TYPES.map(t => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {/* Credits To Multi-Member Selector */}
          <IdeaCreditsPicker
            members={members}
            creditedUserIds={creditedUserIds}
            onChange={setCreditedUserIds}
          />

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting
                ? 'Saving...'
                : initial
                  ? 'Save Changes'
                  : 'Create Idea'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
