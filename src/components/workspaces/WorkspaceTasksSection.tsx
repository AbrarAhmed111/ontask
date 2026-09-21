import { CircleCheck, CirclePlus, Clock3, ListTodo, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Skeleton } from '@/components/ui/Skeleton'
import { WorkspaceTaskList } from '@/components/workspaces/WorkspaceTaskList'
import { ClearCompletedButton } from '@/components/tasks/ClearCompletedButton'
import {
  BlockedNowItem,
  BlockedNowPanel,
} from '@/components/blockers/BlockedNowPanel'
import { TourAnchor, tourAnchor } from '@/lib/tourAnchors'
import { WorkspaceMember, WorkspaceTask } from '@/types/workspace'
import type { AuthUser } from '@/hooks/useAuth'

function StatCard({
  icon: Icon,
  label,
  value,
  valueClassName = 'text-ink',
  tour,
}: {
  icon: typeof Clock3
  label: string
  value: number
  valueClassName?: string
  tour?: TourAnchor
}) {
  return (
    <div
      {...(tour && tourAnchor(tour))}
      className="rounded-xl border border-line bg-panel px-4 py-3"
    >
      <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted">
        <Icon size={12} /> {label}
      </p>
      <p className={`mt-1.5 text-lg font-bold ${valueClassName}`}>{value}</p>
    </div>
  )
}

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <Skeleton className="h-2.5 w-16" />
      <Skeleton className="mt-2 h-5 w-8" />
    </div>
  )
}

function TaskRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-4 sm:px-5">
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="mt-2 h-2.5 w-1/4" />
      </div>
      <Skeleton className="h-7 w-16 shrink-0 rounded-lg" />
    </div>
  )
}

export function WorkspaceTasksSection({
  ready,
  error,
  isPersonal = false,
  stats,
  workingNow,
  workingGoalTasks,
  blockedItems = [],
  tasks,
  members,
  user,
  queueTasks,
  completedTasks,
  getLiveSeconds,
  onAddTask,
  onStart,
  onPause,
  onEmergencyStop,
  onFinish,
  onReopen,
  onEdit,
  onDelete,
  onClearCompleted,
  onReassign,
  onReorder,
  onAddSubtask,
  onDeleteParent,
  onMoveTo,
}: {
  ready: boolean
  error?: string | null
  // A personal workspace has no other members: no Members stat, and work in
  // progress is always yours.
  isPersonal?: boolean
  stats: {
    members: number
    working: number
    queued: number
    completedToday: number
  }
  workingNow: WorkspaceTask[]
  workingGoalTasks: { task: WorkspaceTask; goalName: string }[]
  // Tasks with an active blocker (flat and Goal alike) and the blocker itself.
  blockedItems?: BlockedNowItem[]
  tasks: WorkspaceTask[]
  members: WorkspaceMember[]
  user: AuthUser | null
  queueTasks: WorkspaceTask[]
  completedTasks: WorkspaceTask[]
  getLiveSeconds: (task: WorkspaceTask) => number
  onAddTask: () => void
  onStart: (id: string) => void
  onPause: (task: WorkspaceTask) => void
  onEmergencyStop?: (task: WorkspaceTask) => void
  onFinish: (task: WorkspaceTask) => void
  onReopen?: (task: WorkspaceTask) => void
  onEdit: (task: WorkspaceTask) => void
  onDelete: (id: string) => void
  onClearCompleted?: () => void
  onReassign: (id: string, userId: string | string[] | null) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onAddSubtask?: (parentId: string) => void
  onDeleteParent?: (task: WorkspaceTask) => void
  onMoveTo?: (taskId: string, parentId: string | null) => void
}) {
  const parentOf = (task: WorkspaceTask) =>
    task.parentTaskId ? tasks.find(t => t.id === task.parentTaskId) : undefined
  const workerName = (assignedTo: string | null) => {
    if (isPersonal) return 'You'
    const assignee = members.find(m => m.userId === assignedTo)
    return assignee?.fullName || assignee?.email || 'Someone'
  }
  const goalWorkingRows = workingGoalTasks.map(({ task, goalName }) => {
    return (
      <div
        key={task.id}
        className="flex items-center justify-between rounded-xl border border-sage/40 bg-sage/5 px-4 py-2.5"
      >
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-ink">
            Currently working on {task.name}
          </p>
          <p className="truncate text-[10px] text-muted">Goal: {goalName}</p>
        </div>
        <p className="shrink-0 text-[11px] text-muted">
          {workerName(task.assignedTo)}
        </p>
      </div>
    )
  })

  return (
    <div>
      <div
        className={`mb-6 grid gap-3 ${isPersonal ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}
      >
        {!ready ? (
          <>
            {!isPersonal && <StatCardSkeleton />}
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            {!isPersonal && (
              <StatCard icon={Users} label="Members" value={stats.members} />
            )}
            {/* The always-rendered "who's working" anchor: the panel below only
                exists while someone is mid-task, so a tour can't rely on it. */}
            <StatCard
              icon={Clock3}
              label="Working"
              value={stats.working}
              valueClassName="text-[var(--ws-accent,#375b4b)]"
              tour="working-now"
            />
            <StatCard icon={ListTodo} label="Queued" value={stats.queued} />
            <StatCard
              icon={CircleCheck}
              label="Completed today"
              value={stats.completedToday}
            />
          </>
        )}
      </div>

      {ready && error && <ErrorBanner className="mb-6">{error}</ErrorBanner>}

      {ready && (workingNow.length > 0 || workingGoalTasks.length > 0) && (
        <div className="mb-6 rounded-2xl border border-sage/40 bg-sage/5 p-5 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[var(--ws-accent,#375b4b)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--ws-accent,#375b4b)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ws-accent,#375b4b)]" />
            </span>
            Working now
          </h2>
          <div className="space-y-2">
            {workingNow.map(task => {
              const parent = parentOf(task)
              return (
                <div
                  key={task.id}
                  className="flex items-center justify-between rounded-xl border border-line bg-panel px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-ink">
                      {task.name}
                    </p>
                    {parent && (
                      <p className="truncate text-[10px] text-muted">
                        under &ldquo;{parent.name}&rdquo;
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 text-[11px] text-muted">
                    {workerName(task.assignedTo)}
                  </p>
                </div>
              )
            })}
            {goalWorkingRows}
          </div>
        </div>
      )}

      {ready && (
        <BlockedNowPanel
          items={blockedItems}
          members={members}
          isPersonal={isPersonal}
        />
      )}

      <div {...tourAnchor('today-tasks')}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight text-ink">
            Queue{' '}
            {ready && (
              <span className="font-mono text-xs font-normal text-muted">
                {queueTasks.filter(task => !task.parentTaskId).length}
              </span>
            )}
          </h2>
          <Button onClick={onAddTask}>
            <CirclePlus size={15} /> Add task
          </Button>
        </div>
        {!ready ? (
          <div className="space-y-3">
            <TaskRowSkeleton />
            <TaskRowSkeleton />
            <TaskRowSkeleton />
          </div>
        ) : queueTasks.length === 0 ? (
          <EmptyState>
            {tasks.length === 0
              ? isPersonal
                ? 'No tasks yet — add one to start planning your day.'
                : 'No tasks yet — add one to start planning together.'
              : 'No queued tasks right now.'}
          </EmptyState>
        ) : (
          <div className="space-y-2 rounded-2xl border border-line bg-panel p-3">
            <WorkspaceTaskList
              tasks={queueTasks}
              members={members}
              user={user}
              getWorkedSeconds={getLiveSeconds}
              onStart={onStart}
              onPause={onPause}
              onEmergencyStop={onEmergencyStop}
              onFinish={onFinish}
              onReopen={onReopen}
              onEdit={onEdit}
              onDelete={onDelete}
              onReassign={onReassign}
              onReorder={onReorder}
              onAddSubtask={onAddSubtask}
              onDeleteParent={onDeleteParent}
              onMoveTo={onMoveTo}
            />
          </div>
        )}
      </div>

      {ready && completedTasks.length > 0 && (
        <div className="mt-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold tracking-tight text-ink">
              Completed{' '}
              <span className="font-mono text-xs font-normal text-muted">
                {completedTasks.filter(task => !task.parentTaskId).length}
              </span>
            </h2>
            {onClearCompleted && (
              <ClearCompletedButton
                count={completedTasks.length}
                onClear={onClearCompleted}
              />
            )}
          </div>
          <WorkspaceTaskList
            tasks={completedTasks}
            members={members}
            user={user}
            getWorkedSeconds={getLiveSeconds}
            onStart={onStart}
            onPause={onPause}
            onEmergencyStop={onEmergencyStop}
            onFinish={onFinish}
            onReopen={onReopen}
            onEdit={onEdit}
            onDelete={onDelete}
            onReassign={onReassign}
            onReorder={() => {}}
            onAddSubtask={onAddSubtask}
            onDeleteParent={onDeleteParent}
            onMoveTo={onMoveTo}
          />
        </div>
      )}
    </div>
  )
}
