'use client'

import { Lightbulb } from 'lucide-react'
import type { Idea } from '@/types/workspace'

export function IdeaSelect({
  ideas,
  value,
  onChange,
  disabled = false,
}: {
  ideas: Idea[]
  value: string
  onChange: (ideaId: string) => void
  disabled?: boolean
}) {
  const activeIdeas = ideas.filter(idea => idea.status !== 'archived')

  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-muted">
        Reference Idea{' '}
        <span className="font-normal text-muted/80">(optional)</span>
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-sage focus:ring-4 focus:ring-sage/15 disabled:opacity-50"
        >
          <option value="">No reference idea</option>
          {activeIdeas.map(idea => (
            <option key={idea.id} value={idea.id}>
              [{idea.type.toUpperCase()}] {idea.title} (
              {idea.status.replace('_', ' ')})
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
