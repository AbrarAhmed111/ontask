'use client'

import { ReactNode, useState } from 'react'
import { ChevronDown, ChevronRight, CirclePlus, Trash2 } from 'lucide-react'
import type { TaskDragProps } from '@/components/tasks/TaskCardShell'

// The frame for a task that groups subtasks. Parents are containers, not
// runnable — no Start button anywhere on this card. Progress is always shown
// as counts (never a bare percentage) so skipped work stays visible rather
// than silently folding into "completed".
//
// Both data models name their finished states `completed` and `skipped`, which
// is all the counts need, so this is generic over the task type. Each caller
// supplies its own header `extras` (assignees, dependencies, notes, ...) and
// renders its own subtask rows as `children`.
export function ParentTaskShell<T extends { status: string }>({
  title,
  subtasks,
  getWorkedSeconds,
  extras,
  panel,
  onAddSubtask,
  onDelete,
  drag,
  children,
}: {
  title: string
  subtasks: T[]
  getWorkedSeconds: (task: T) => number
  // Header controls between the summary and "Add subtask".
  extras?: ReactNode
  // Content shown under the header, above the subtasks (e.g. an open notes
  // panel).
  panel?: ReactNode
  onAddSubtask: () => void
  onDelete: () => void
  drag?: TaskDragProps
  // The subtask rows, shown while expanded.
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const completed = subtasks.filter(task => task.status === 'completed').length
  const skipped = subtasks.filter(task => task.status === 'skipped').length
  const remaining = subtasks.length - completed - skipped
  const focusedSeconds = subtasks.reduce(
    (total, task) => total + getWorkedSeconds(task),
    0,
  )

  return (
    <div
      draggable={Boolean(drag)}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      className="rounded-2xl border border-line bg-panel shadow-sm"
    >
      <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
        <button
          type="button"
          onClick={() => setExpanded(open => !open)}
          aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
          className="rounded-lg p-1 text-muted transition hover:bg-slate-100 hover:text-ink"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold tracking-tight text-ink">
            {title}
          </h3>
          <p className="mt-1 text-[10px] text-muted">
            {completed} completed
            {skipped > 0 ? ` · ${skipped} skipped` : ''} · {remaining} remaining
            · {Math.round(focusedSeconds / 60)}m focused
          </p>
        </div>
        {extras}
        <button
          onClick={onAddSubtask}
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-semibold text-[var(--ws-accent,#375b4b)] transition hover:text-coral"
        >
          <CirclePlus size={13} /> Add subtask
        </button>
        <button
          aria-label={`Delete ${title}`}
          onClick={onDelete}
          className="rounded-lg p-2 text-muted transition hover:bg-coral/10 hover:text-coral"
        >
          <Trash2 size={15} />
        </button>
      </div>
      {panel && (
        <div className="border-t border-line/70 px-4 py-4 sm:px-5">{panel}</div>
      )}
      {expanded && (
        <div className="space-y-2 border-t border-line/70 px-4 py-4 sm:px-5">
          {children}
        </div>
      )}
    </div>
  )
}
