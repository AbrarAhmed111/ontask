'use client'

import { useMemo } from 'react'
import { AlertTriangle, GitBranch, GitPullRequest, Target } from 'lucide-react'
import clsx from 'clsx'
import { Avatar } from '@/components/ui/Avatar'
import {
  PriorityBadge,
  StageDot,
  WorkTypeIcon,
} from '@/components/development/DevelopmentBadges'
import {
  ATTENTION_MESSAGES,
  DEVELOPMENT_STAGES,
  LifecycleStage,
  STAGE_LABELS,
  developmentAttention,
  priorityRank,
  workTypeInfo,
} from '@/lib/development/tracking'
import { tourAnchor, type TourAnchor } from '@/lib/tourAnchors'
import type {
  Goal,
  GithubConnection,
  TaskDevelopment,
  WorkspaceMember,
  WorkspaceTask,
} from '@/types/workspace'

export type DevelopmentItem = {
  task: WorkspaceTask
  development: TaskDevelopment
}

// What the Development tour points at for each column.
const STAGE_ANCHORS: Record<LifecycleStage, TourAnchor> = {
  queued: 'dev-stage-queued',
  in_development: 'dev-stage-in-development',
  in_review: 'dev-stage-in-review',
  completed: 'dev-stage-completed',
}

function TaskRow({
  item,
  goal,
  assignee,
  reason,
  onOpen,
}: {
  item: DevelopmentItem
  goal: Goal | undefined
  assignee: WorkspaceMember | undefined
  // Set for a task that Needs Attention: what went wrong, in one line.
  reason?: string
  onOpen: () => void
}) {
  const { task, development } = item
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        'w-full rounded-xl border bg-panel px-3 py-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--ws-accent,#375b4b)]',
        reason
          ? 'border-coral/45 bg-coral/5 shadow-coral/10'
          : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-start gap-1.5 text-xs font-bold leading-5 text-ink">
          <span
            className="mt-[3px]"
            title={workTypeInfo(development.workType).label}
          >
            <WorkTypeIcon type={development.workType} size={12} />
          </span>
          <span className="min-w-0">{task.name}</span>
        </p>
        {assignee && (
          <Avatar
            person={assignee}
            title={assignee.fullName || assignee.email || 'Member'}
            className="h-5 w-5 shrink-0 text-[8px]"
          />
        )}
      </div>
      {goal && (
        <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted">
          <Target
            size={10}
            className="shrink-0 text-[var(--ws-accent,#375b4b)]"
          />{' '}
          {goal.name}
        </p>
      )}
      {reason && (
        <p
          role="alert"
          className="mt-1 flex items-start gap-1 text-[10px] font-semibold leading-4 text-coral"
        >
          <AlertTriangle
            size={11}
            className="mt-0.5 shrink-0 animate-pulse"
            aria-hidden
          />
          {reason}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex min-w-0 items-center gap-1 font-mono text-[10px] text-muted">
          {development.prNumber !== null ? (
            <>
              <GitPullRequest
                size={10}
                className="shrink-0 text-[var(--ws-accent,#375b4b)]"
              />
              #
              {development.prNumber}
            </>
          ) : (
            <>
              <GitBranch
                size={10}
                className="shrink-0 text-[var(--ws-accent,#375b4b)]"
              />
              <span className="truncate">{development.branchName}</span>
            </>
          )}
        </span>
        <span className="ml-auto">
          <PriorityBadge priority={task.priority} />
        </span>
      </div>
    </button>
  )
}

function lifecycleStage(item: DevelopmentItem): LifecycleStage {
  const { task, development } = item
  if (task.status === 'completed' || task.status === 'skipped') {
    return 'completed'
  }
  switch (development.trackingStatus) {
    case 'in_review':
      return 'in_review'
    case 'branch_detected':
    case 'merged':
    case 'pr_closed':
      return 'in_development'
    default:
      return 'queued'
  }
}

// Every Development Task by stage (Queued -> In Development -> In Review ->
// Completed), one compact row each. Needs Attention is an alarm on the task
// card, not a lane: the card stays where its lifecycle says it belongs.
export function DevelopmentBoard({
  items,
  goals,
  members,
  connection = null,
  onOpen,
}: {
  items: DevelopmentItem[]
  goals: Goal[]
  members: WorkspaceMember[]
  connection?: GithubConnection | null
  onOpen: (taskId: string) => void
}) {
  const columns = useMemo(() => {
    const byStage = new Map<LifecycleStage, DevelopmentItem[]>(
      DEVELOPMENT_STAGES.map(stage => [stage, []]),
    )
    for (const item of items) {
      byStage.get(lifecycleStage(item))!.push(item)
    }
    for (const [stage, list] of byStage) {
      list.sort((a, b) =>
        stage === 'completed'
          ? (b.task.completedAt ?? 0) - (a.task.completedAt ?? 0)
          : priorityRank(b.task.priority) - priorityRank(a.task.priority) ||
            b.development.createdAt.localeCompare(a.development.createdAt),
      )
    }
    return byStage
  }, [items])

  const goalsById = useMemo(
    () => new Map(goals.map(goal => [goal.id, goal])),
    [goals],
  )

  const rowProps = (item: DevelopmentItem) => ({
    item,
    goal: item.task.goalId ? goalsById.get(item.task.goalId) : undefined,
    assignee: members.find(member => member.userId === item.task.assignedTo),
    onOpen: () => onOpen(item.task.id),
  })

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {DEVELOPMENT_STAGES.map(stage => {
          const list = columns.get(stage) ?? []
          return (
            <section
              key={stage}
              aria-label={STAGE_LABELS[stage]}
              className="rounded-2xl border border-line/70 bg-white/40 p-3"
              {...tourAnchor(STAGE_ANCHORS[stage])}
            >
              <h3 className="mb-2.5 flex items-center gap-2 px-1 text-[11px] font-bold text-ink">
                <StageDot stage={stage} />
                {STAGE_LABELS[stage]}
                <span className="ml-auto font-mono text-[10px] text-muted">
                  {list.length}
                </span>
              </h3>
              {list.length === 0 ? (
                <p className="px-1 py-3 text-center text-[10px] text-muted">
                  Nothing here
                </p>
              ) : (
                <div className="space-y-2">
                  {list.map(item => {
                    const reason = developmentAttention(
                      item.task,
                      item.development,
                      connection,
                    )
                    return (
                      <TaskRow
                        key={item.task.id}
                        {...rowProps(item)}
                        reason={reason ? ATTENTION_MESSAGES[reason] : undefined}
                      />
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
