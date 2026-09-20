import Link from 'next/link'
import { ArrowRight, CircleSlash } from 'lucide-react'
import {
  TASK_UNAVAILABLE_LABEL,
  TaskReferenceView,
  taskHref,
} from '@/lib/dailyUpdates'
import type { DailyUpdateTaskKind } from '@/types/workspace'

// Where a task sits, as words: "Goal: Launch Product → Build onboarding →
// Finish onboarding copy". A flat task is just its title; a Goal task carries its
// Goal; a Goal subtask carries the Goal and its parent task. The parts are the
// task's own (resolved on the server), never text the member typed.
export function TaskContext({
  title,
  goalName,
  parentTitle,
  kind,
}: {
  title: string
  goalName: string | null
  parentTitle: string | null
  kind: DailyUpdateTaskKind
}) {
  const inGoal = kind !== 'task' && goalName
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
      {inGoal && (
        <>
          <span className="text-muted">Goal: {goalName}</span>
          <ArrowRight size={11} aria-hidden className="shrink-0 text-muted" />
        </>
      )}
      {kind === 'goal_subtask' && parentTitle && (
        <>
          <span className="text-muted">{parentTitle}</span>
          <ArrowRight size={11} aria-hidden className="shrink-0 text-muted" />
        </>
      )}
      <span className="font-semibold text-ink">{title}</span>
    </span>
  )
}

// A task an item refers to, as a link into the existing task view (the overview
// brings that task into view, and opens its Goal) -- there is no second task
// detail. When the task has been deleted the item keeps its words and this says
// so, quietly, instead of a broken link.
export function TaskReference({
  reference,
  workspaceSlug,
}: {
  reference: TaskReferenceView
  workspaceSlug: string
}) {
  if (reference.state === 'unavailable') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-line px-2 py-0.5 text-[11px] italic text-muted">
        <CircleSlash size={11} aria-hidden /> {TASK_UNAVAILABLE_LABEL}
      </span>
    )
  }
  return (
    <Link
      href={taskHref(workspaceSlug, reference.taskId)}
      title="Open this task"
      className="inline-flex max-w-full items-center rounded-md border border-line bg-white/70 px-2 py-0.5 text-[11px] transition hover:border-[var(--ws-accent,#375b4b)] hover:bg-white"
    >
      <TaskContext
        title={reference.title}
        goalName={reference.goalName}
        parentTitle={reference.parentTitle}
        kind={reference.kind}
      />
    </Link>
  )
}
