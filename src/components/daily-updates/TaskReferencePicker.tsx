'use client'

import { KeyboardEvent, useState } from 'react'
import { Search } from 'lucide-react'
import { DropdownPanel } from '@/components/ui/DropdownPanel'
import { TaskContext } from '@/components/daily-updates/TaskReference'
import { useTaskCandidates } from '@/hooks/useDailyUpdates'
import { REASON_LABELS, TaskCandidate } from '@/lib/dailyUpdates'
import type { DailyUpdateItemType } from '@/types/workspace'

const STATUS_LABELS: Record<TaskCandidate['status'], string> = {
  queued: 'Queued',
  working: 'Working',
  paused: 'Paused',
  blocked: 'Blocked',
  completed: 'Completed',
  skipped: 'Skipped',
}

// A short, ranked list of tasks to attach to an item -- chosen for the section
// (what you finished, what is blocked, what you'll pick up) and for you (yours,
// or ones you have been working on) -- not the workspace's whole task list. Typing
// searches the workspace, so a task that isn't "yours" can still be found. The
// server does the choosing and the searching; nothing here filters by itself.
export function TaskReferencePicker({
  workspaceId,
  itemType,
  onSelect,
  onClose,
}: {
  workspaceId: string
  itemType: DailyUpdateItemType
  onSelect: (candidate: TaskCandidate) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const { candidates, loading, error } = useTaskCandidates(
    workspaceId,
    itemType,
    query,
    true,
  )
  const searching = query.trim() !== ''

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      // Closes the picker only -- not anything the form sits in.
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  return (
    <DropdownPanel
      onClose={onClose}
      align="left"
      className="w-[min(24rem,calc(100vw-2rem))] p-2"
    >
      <div className="relative">
        <Search
          size={13}
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          autoFocus
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="w-full rounded-lg border border-line bg-white/70 py-2 pl-8 pr-3 text-xs text-ink outline-none transition placeholder:text-muted/60 focus:border-sage focus:ring-4 focus:ring-sage/15"
        />
      </div>
      <p className="px-1 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
        {searching ? 'Results' : 'Suggested for you'}
      </p>
      <div className="max-h-64 overflow-y-auto">
        {error ? (
          <p role="alert" className="px-2 py-3 text-xs text-coral">
            {error}
          </p>
        ) : loading ? (
          <p className="px-2 py-3 text-xs text-muted">Loading tasks…</p>
        ) : candidates.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted">
            {searching
              ? 'No tasks match that search.'
              : 'Nothing suggested yet — type to search this workspace.'}
          </p>
        ) : (
          <ul role="listbox" aria-label="Tasks">
            {candidates.map(candidate => (
              <li key={candidate.taskId} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => onSelect(candidate)}
                  className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-slate-100"
                >
                  <TaskContext
                    title={candidate.title}
                    goalName={candidate.goalName}
                    parentTitle={candidate.parentTitle}
                    kind={candidate.kind}
                  />
                  <span className="text-[10px] text-muted">
                    {STATUS_LABELS[candidate.status]} ·{' '}
                    {REASON_LABELS[candidate.reason]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DropdownPanel>
  )
}
