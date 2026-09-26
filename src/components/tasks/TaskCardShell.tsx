import { DragEvent, ReactNode } from 'react'
import { Check, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { formatPlanned, formatTime } from '@/lib/time'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { ProgressLabel } from '@/components/tasks/ProgressLabel'

// Small pill button for a task card's secondary actions.
export const TASK_CHIP_CLASS =
  'inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1.5 text-[10px] font-semibold text-muted transition hover:border-[var(--ws-accent,#375b4b)] hover:text-[var(--ws-accent,#375b4b)]'

export type TaskDragProps = {
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}

// How the card reads at a glance, independent of the two data models' own
// status vocabularies (guest: active/pending/..., workspace: working/queued/...).
export type TaskCardTone = 'running' | 'idle' | 'done'

const PILL_TONE: Record<TaskCardTone, string> = {
  running: 'bg-[var(--ws-accent-soft,#e9f0ec)] text-[var(--ws-accent,#375b4b)]',
  done: 'bg-coral/10 text-coral',
  idle: 'bg-slate-100 text-muted',
}

const BADGE_TONE: Record<TaskCardTone, string> = {
  running:
    'border-[var(--ws-accent,#375b4b)] bg-[var(--ws-accent,#375b4b)] text-white',
  done: 'border-coral bg-coral text-white',
  idle: 'border-sage text-[var(--ws-accent,#375b4b)]',
}

// The frame every task card shares: index badge, title, status pill, edit,
// time-vs-plan progress, optional progress label, and the action footer. Guest
// (local) tasks and workspace tasks are different data with different
// actions, so each supplies its own `leading` / `actions` / `children`; what
// the card looks like is defined only here.
//
// The accent is read from `--ws-accent`, which only a workspace sets — outside
// one it falls back to the app's forest green, so the guest page renders the
// same card without knowing anything about workspaces.
export function TaskCardShell({
  id,
  title,
  description,
  index,
  tone,
  blocked = false,
  statusLabel,
  badge,
  focusLabel,
  workedSeconds,
  plannedMinutes,
  progressLabel,
  progressPercentage,
  drag,
  className = '',
  onEdit,
  onDelete,
  leading,
  actions,
  children,
}: {
  // Lets something outside the card (a notification's deep link) find it.
  id?: string
  title: string
  description?: string | null
  // Present only for root-level cards in a list — drives the numbered badge
  // and drag-to-reorder. Subtask rows omit it and get a plain dot.
  index?: number
  tone: TaskCardTone
  // A blocked task keeps its tone for the badge/border but reads as blocked
  // in its status pill.
  blocked?: boolean
  statusLabel: string
  // Beside the status pill: what kind of task this is (e.g. a code task).
  badge?: ReactNode
  focusLabel: string
  workedSeconds: number
  plannedMinutes?: number | null
  progressLabel?: string
  progressPercentage?: number
  drag?: TaskDragProps
  className?: string
  onEdit: () => void
  onDelete: () => void
  // Footer, left group.
  leading?: ReactNode
  // Footer, right group (before the delete button).
  actions?: ReactNode
  // Extra body content beneath the progress label.
  children?: ReactNode
}) {
  const done = tone === 'done'
  const running = tone === 'running'
  const draggable = index !== undefined && Boolean(drag)
  const taskProgress =
    plannedMinutes && plannedMinutes > 0
      ? Math.min(100, (workedSeconds / (plannedMinutes * 60)) * 100)
      : null

  return (
    <article
      id={id}
      draggable={draggable}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      className={`group rounded-2xl border bg-panel shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-md ${running ? 'border-sage shadow-sage/10' : 'border-line'} ${done ? 'bg-slate-50/70' : ''} ${className}`}
    >
      <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
        {draggable && (
          <button
            type="button"
            aria-label={`Reorder ${title}`}
            className="cursor-grab touch-none rounded-lg p-1 text-muted transition hover:bg-slate-100 hover:text-ink active:cursor-grabbing"
            title="Drag to reorder"
          >
            <GripVertical size={16} />
          </button>
        )}
        <div
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border font-mono text-[10px] ${BADGE_TONE[tone]}`}
        >
          {done ? (
            <Check size={15} />
          ) : index !== undefined ? (
            String(index + 1).padStart(2, '0')
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          )}
        </div>
        <h3 className="min-w-0 truncate text-sm font-bold tracking-tight text-ink">
          {title}
        </h3>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[9px] uppercase ${blocked ? 'bg-coral/10 text-coral' : PILL_TONE[tone]}`}
        >
          {statusLabel}
        </span>
        {badge}
        <button
          aria-label={`Edit ${title}`}
          onClick={onEdit}
          className="ml-auto shrink-0 rounded-lg p-2 text-muted transition hover:bg-slate-100 hover:text-ink"
        >
          <Pencil size={15} />
        </button>
      </div>

      <div className="space-y-4 px-4 pb-5 sm:px-5 sm:pl-[68px]">
        {description && (
          <p className="text-xs text-muted/90 whitespace-pre-wrap leading-relaxed">
            {description}
          </p>
        )}

        <div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted">
                {focusLabel}
              </span>
              <strong className="mt-1.5 block text-2xl font-bold tracking-tight text-ink">
                {formatTime(workedSeconds)}{' '}
                {plannedMinutes != null && plannedMinutes > 0 && (
                  <small className="text-xs font-medium text-muted">
                    / {formatPlanned(plannedMinutes)}
                  </small>
                )}
              </strong>
            </div>
            {taskProgress != null && (
              <span className="shrink-0 rounded-full bg-[var(--ws-accent-soft,#e9f0ec)] px-2.5 py-1 font-mono text-[11px] font-bold text-[var(--ws-accent,#375b4b)]">
                {Math.round(taskProgress)}%
              </span>
            )}
          </div>
          {taskProgress != null && (
            <ProgressBar
              value={taskProgress}
              tone="coral"
              className="mt-3 h-1.5"
            />
          )}
        </div>

        {progressLabel && (
          <ProgressLabel
            name={progressLabel}
            progress={progressPercentage || 0}
          />
        )}

        {children}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 px-4 py-3 sm:px-5 sm:pl-[68px]">
        <div className="flex flex-wrap items-center gap-2">{leading}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {actions}
          <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />
          <button
            aria-label={`Delete ${title}`}
            onClick={onDelete}
            className="shrink-0 rounded-lg p-2 text-muted transition hover:bg-coral/10 hover:text-coral"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  )
}
