'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import {
  Archive,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  RotateCcw,
  Target,
  Trash2,
} from 'lucide-react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { WorkspaceTaskList } from '@/components/workspaces/WorkspaceTaskList'
import { WorkspaceTaskForm } from '@/components/workspaces/WorkspaceTaskForm'
import { CompletionModal } from '@/components/tasks/CompletionModal'
import { ClearCompletedButton } from '@/components/tasks/ClearCompletedButton'
import { DeleteParentModal } from '@/components/tasks/DeleteParentModal'
import { GoalDetailHeader } from '@/components/goals/GoalDetailHeader'
import { GoalForm } from '@/components/goals/GoalForm'
import { DependencyPicker } from '@/components/goals/DependencyPicker'
import { TaskBlockerActionsContext } from '@/components/blockers/TaskBlockerActionsContext'
import { useAnyTaskFocus } from '@/components/workspaces/FocusedTaskContext'
import { useGoalFocus } from '@/components/workspaces/FocusedGoalContext'
import { useCompletionAlert } from '@/hooks/useCompletionAlert'
import { useGoalDetail } from '@/hooks/useGoalDetail'
import { GoalFormValues } from '@/hooks/useWorkspaceGoals'
import type { AuthUser } from '@/hooks/useAuth'
import { Goal, Idea, WorkspaceMember, WorkspaceTask } from '@/types/workspace'
import { TaskFormValues } from '@/types'

const STATUS_STYLES: Record<Goal['status'], string> = {
  active: 'bg-[var(--ws-accent-soft,#e9f0ec)] text-[var(--ws-accent,#375b4b)]',
  completed: 'bg-sage/15 text-forest',
  archived: 'bg-slate-100 text-muted',
}
const STATUS_LABEL: Record<Goal['status'], string> = {
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
}

const emptyTaskForm: TaskFormValues = {
  name: '',
  hours: '0',
  minutes: '0',
  goal: '',
  progress: '0',
  trackGoal: false,
}

// A single Goal, rendered as a card that expands in place to its full detail
// (stats, currently-working, task/subtask tree, dependencies) — the same
// "one card, expand in place, no navigation" pattern already used for the
// Daily Report (WorkspaceSummarySection) and for a task's own subtasks
// (WorkspaceParentTaskCard). There is deliberately no separate Goals route.
export function GoalCard({
  goal,
  workspaceId,
  isPersonal,
  soundEnabled,
  user,
  members,
  updateGoal,
  setGoalStatus,
  deleteGoal,
  onWorkingTasksChange,
  onBlockedTasksChange,
  ideas,
}: {
  goal: Goal
  workspaceId: string
  // A personal workspace has no assignment step, so its sole member is the
  // implicit assignee of every task's timer.
  isPersonal: boolean
  // The user's completion-sound preference (gates the "finished" alarm).
  soundEnabled: boolean
  user: AuthUser | null
  members: WorkspaceMember[]
  updateGoal: (
    id: string,
    update: Partial<
      Pick<Goal, 'name' | 'description' | 'targetDate' | 'status' | 'ideaId'>
    >,
  ) => void
  setGoalStatus: (id: string, status: Goal['status']) => void
  deleteGoal?: (id: string) => void
  onWorkingTasksChange: (goalId: string, tasks: WorkspaceTask[]) => void
  onBlockedTasksChange?: (goalId: string, tasks: WorkspaceTask[]) => void
  ideas?: Idea[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [pendingDeleteGoal, setPendingDeleteGoal] = useState(false)
  const completionAlert = useCompletionAlert<WorkspaceTask>(soundEnabled)
  const {
    tasks,
    ready: tasksReady,
    error: tasksError,
    startTask,
    pauseTask,
    emergencyStopTask,
    finishTask,
    reopenTask,
    clearCompletedTasks,
    addTask,
    updateTask,
    deleteTask,
    moveTask,
    reassignTask,
    blockerActions,
    getLiveSeconds,
    dependencies,
    addDependency,
    removeDependency,
    blockingTasksFor,
  } = useGoalDetail(
    goal.id,
    workspaceId,
    user,
    members,
    completionAlert.notify,
    isPersonal,
    goal.ideaId ?? null,
  )

  const [taskModal, setTaskModal] = useState<'add' | 'edit' | null>(null)
  const [taskForm, setTaskForm] = useState<TaskFormValues>(emptyTaskForm)
  const [taskAssignees, setTaskAssignees] = useState<string[]>([])
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [pendingParentId, setPendingParentId] = useState<string | null>(null)
  const [pendingDeleteParent, setPendingDeleteParent] = useState<{
    task: WorkspaceTask
    childCount: number
  } | null>(null)
  const [dependencyTask, setDependencyTask] = useState<WorkspaceTask | null>(
    null,
  )
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalForm, setGoalForm] = useState<GoalFormValues>({
    name: goal.name,
    description: goal.description ?? '',
    targetDate: goal.targetDate ?? '',
  })

  useEffect(() => {
    if (expanded && tasksError) showErrorToast(tasksError)
  }, [expanded, tasksError])

  const isDone = (task: WorkspaceTask) =>
    task.status === 'completed' || task.status === 'skipped'
  useEffect(() => {
    onWorkingTasksChange(
      goal.id,
      tasks.filter(task => task.status === 'working'),
    )
  }, [goal.id, onWorkingTasksChange, tasks])
  useEffect(() => {
    onBlockedTasksChange?.(
      goal.id,
      tasks.filter(task => task.status === 'blocked'),
    )
  }, [goal.id, onBlockedTasksChange, tasks])

  // A notification can point at a task inside this goal; the goal opens itself
  // so the task's card exists to be scrolled to. Once per request — closing the
  // goal afterwards must stick, however often its tasks update.
  const taskFocus = useAnyTaskFocus()
  const handledFocus = useRef<typeof taskFocus>(null)
  useEffect(() => {
    if (!taskFocus || handledFocus.current === taskFocus) return
    if (!tasks.some(task => task.id === taskFocus.id)) return
    handledFocus.current = taskFocus
    setExpanded(true)
  }, [taskFocus, tasks])

  // Arriving from a Slack message's "Open Goal" button: this goal opens and
  // scrolls itself into view. Same once-per-request rule as the task focus
  // above — closing it again afterwards has to stick.
  const goalFocus = useGoalFocus(goal.id)
  const handledGoalFocus = useRef<typeof goalFocus>(null)
  useEffect(() => {
    if (!goalFocus || handledGoalFocus.current === goalFocus) return
    handledGoalFocus.current = goalFocus
    setExpanded(true)
    document
      .getElementById(`goal-${goal.id}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [goalFocus, goal.id])
  const totalTasks = tasks.length
  const completedTasks = tasks.filter(isDone).length
  const visibleTasks = tasks.filter(task => task.completedClearedAt == null)
  const visibleCompletedTasks = visibleTasks.filter(isDone)
  const focusedSeconds = Math.round(
    tasks.reduce((total, task) => total + getLiveSeconds(task), 0),
  )
  const progress =
    totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100)
  // Blocked either way: waiting on an unfinished dependency, or carrying a
  // blocker someone raised.
  const blockedTaskCount = tasks.filter(
    task =>
      !isDone(task) &&
      (task.status === 'blocked' || blockingTasksFor(task.id).length > 0),
  ).length
  const hasWorkingTask = tasks.some(task => task.status === 'working')

  const closeTaskModal = () => {
    setTaskModal(null)
    setEditingTaskId(null)
    setPendingParentId(null)
  }
  const openAddTask = () => {
    setTaskForm({ ...emptyTaskForm })
    setTaskAssignees([])
    setPendingParentId(null)
    setTaskModal('add')
  }
  const openAddSubtask = (parentId: string) => {
    setTaskForm({ ...emptyTaskForm })
    setTaskAssignees([])
    setPendingParentId(parentId)
    setTaskModal('add')
  }
  const openEditTask = (task: WorkspaceTask) => {
    setEditingTaskId(task.id)
    const hasPlanned =
      task.plannedMinutes !== null && task.plannedMinutes !== undefined
    const planned = task.plannedMinutes || 0
    setTaskForm({
      name: task.name,
      description: task.description || '',
      hours: hasPlanned ? String(Math.floor(planned / 60)) : '',
      minutes: hasPlanned ? String(planned % 60) : '',
      hasPlannedTime: hasPlanned,
      goal: task.progressLabel || '',
      progress: String(task.progressPercentage || 0),
      trackGoal: Boolean(task.progressLabel),
      ideaId: task.ideaId ?? '',
    })
    const collaboratorIds = (task.collaborators ?? [])
      .filter(collaborator => collaborator.removedAt === null)
      .map(collaborator => collaborator.userId)
    setTaskAssignees(
      collaboratorIds.length > 0
        ? collaboratorIds
        : task.assignedTo
          ? [task.assignedTo]
          : [],
    )
    setTaskModal('edit')
  }

  const handleAddTask = (event: FormEvent) => {
    if (addTask(event, taskForm, pendingParentId, taskAssignees)) {
      closeTaskModal()
      showSuccessToast(pendingParentId ? 'Subtask added.' : 'Task added.')
    }
  }
  const handleEditTask = (event: FormEvent) => {
    event.preventDefault()
    if (!editingTaskId || !taskForm.name.trim()) return
    const plannedMinutes =
      taskForm.hasPlannedTime === false
        ? null
        : taskForm.hours || taskForm.minutes
          ? Number(taskForm.hours || 0) * 60 + Number(taskForm.minutes || 0)
          : null
    updateTask(editingTaskId, {
      name: taskForm.name.trim(),
      description: taskForm.description?.trim() || null,
      plannedMinutes,
      progressLabel: taskForm.trackGoal
        ? taskForm.goal.trim() || undefined
        : undefined,
      progressPercentage: taskForm.trackGoal
        ? Math.min(100, Math.max(0, Number(taskForm.progress) || 0))
        : undefined,
      ideaId: taskForm.ideaId || null,
    })
    if (
      taskAssignees.join('|') !==
      (() => {
        const task = tasks.find(t => t.id === editingTaskId)
        const collaboratorIds = (task?.collaborators ?? [])
          .filter(collaborator => collaborator.removedAt === null)
          .map(collaborator => collaborator.userId)
        return (
          collaboratorIds.length > 0
            ? collaboratorIds
            : task?.assignedTo
              ? [task.assignedTo]
              : []
        ).join('|')
      })()
    ) {
      reassignTask(editingTaskId, taskAssignees)
    }
    closeTaskModal()
    showSuccessToast('Task updated.')
  }
  const handleFinishTask = (task: WorkspaceTask) => {
    finishTask(task)
    showSuccessToast(`${task.name} finished.`)
  }
  const handleReopenTask = (task: WorkspaceTask) => {
    reopenTask(task)
    showSuccessToast(`${task.name} reopened.`)
  }
  const handleDeleteTask = (id: string) => {
    deleteTask(id)
    showSuccessToast('Task removed.')
  }
  const handleDeleteParent = (task: WorkspaceTask) => {
    const childCount = tasks.filter(t => t.parentTaskId === task.id).length
    setPendingDeleteParent({ task, childCount })
  }
  const handleMoveTo = (taskId: string, parentId: string | null) => {
    moveTask(taskId, parentId)
    showSuccessToast(
      parentId ? 'Subtask moved under its new task.' : 'Task made standalone.',
    )
  }
  const confirmDeleteParentAndChildren = () => {
    if (!pendingDeleteParent) return
    tasks
      .filter(task => task.parentTaskId === pendingDeleteParent.task.id)
      .forEach(child => deleteTask(child.id))
    deleteTask(pendingDeleteParent.task.id)
    showSuccessToast(
      `${pendingDeleteParent.task.name} and its subtasks were removed.`,
    )
    setPendingDeleteParent(null)
  }
  const confirmOrphanChildren = () => {
    if (!pendingDeleteParent) return
    tasks
      .filter(task => task.parentTaskId === pendingDeleteParent.task.id)
      .forEach(child => moveTask(child.id, null))
    deleteTask(pendingDeleteParent.task.id)
    showSuccessToast(
      `${pendingDeleteParent.task.name} removed — its subtasks are now standalone tasks in this goal.`,
    )
    setPendingDeleteParent(null)
  }

  const openEditGoal = () => {
    setGoalForm({
      name: goal.name,
      description: goal.description ?? '',
      targetDate: goal.targetDate ?? '',
      ideaId: goal.ideaId ?? '',
    })
    setEditingGoal(true)
  }
  const handleEditGoal = (event: FormEvent) => {
    event.preventDefault()
    if (!goalForm.name.trim()) return
    updateGoal(goal.id, {
      name: goalForm.name.trim(),
      description: goalForm.description.trim() || null,
      targetDate: goalForm.targetDate || null,
      ideaId: goalForm.ideaId || null,
    })
    setEditingGoal(false)
    showSuccessToast('Goal updated.')
  }

  const isOwner =
    isPersonal || members.some(m => m.userId === user?.id && m.role === 'owner')
  const canDeleteGoal =
    isOwner || (user?.id ? goal.createdBy === user.id : false)

  const confirmDeleteGoal = () => {
    deleteGoal?.(goal.id)
    setPendingDeleteGoal(false)
    showSuccessToast('Goal deleted.')
  }

  const StatusIcon =
    goal.status === 'completed'
      ? CircleCheck
      : goal.status === 'archived'
        ? Archive
        : Target

  return (
    <div
      id={`goal-${goal.id}`}
      className="rounded-2xl border border-line bg-panel shadow-sm"
    >
      <div className="flex w-full items-start gap-3 px-5 py-4">
        <button
          type="button"
          onClick={() => setExpanded(open => !open)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          {expanded ? (
            <ChevronDown size={16} className="mt-0.5 shrink-0 text-muted" />
          ) : (
            <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="min-w-0 truncate text-sm font-bold tracking-tight text-ink">
                {goal.name}
              </h3>
              {(goal.status !== 'active' || hasWorkingTask) && (
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase ${STATUS_STYLES[goal.status]}`}
                >
                  <StatusIcon size={10} /> {STATUS_LABEL[goal.status]}
                </span>
              )}
            </div>
            {!expanded && goal.description && (
              <p className="mt-1 line-clamp-1 text-xs text-muted">
                {goal.description}
              </p>
            )}
            {!expanded && goal.targetDate && (
              <p className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-muted">
                <CalendarDays size={11} />
                Target{' '}
                {new Date(goal.targetDate).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            )}
          </div>
        </button>

        {goal.status === 'archived' && canDeleteGoal && !expanded && (
          <button
            type="button"
            aria-label={`Delete ${goal.name}`}
            onClick={() => setPendingDeleteGoal(true)}
            className="shrink-0 rounded-lg p-2 text-muted transition hover:bg-coral/10 hover:text-coral"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-6 border-t border-line/70 px-5 py-5">
          <GoalDetailHeader
            goal={goal}
            progress={progress}
            focusedSeconds={focusedSeconds}
            totalTasks={totalTasks}
            completedTasks={completedTasks}
            blockedTasks={blockedTaskCount}
            onEdit={openEditGoal}
            onMarkComplete={() => {
              setGoalStatus(goal.id, 'completed')
              showSuccessToast('Goal marked complete.')
            }}
            onArchive={() => {
              setGoalStatus(goal.id, 'archived')
              showSuccessToast('Goal archived.')
            }}
            onReactivate={() => {
              setGoalStatus(goal.id, 'active')
              showSuccessToast('Goal reactivated.')
            }}
            onDelete={
              canDeleteGoal && goal.status === 'archived'
                ? () => setPendingDeleteGoal(true)
                : undefined
            }
          />

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-xs font-bold tracking-tight text-ink">
                Tasks
              </h4>
              <Button onClick={openAddTask}>
                <CirclePlus size={14} /> Add task
              </Button>
            </div>
            {!tasksReady ? (
              <div className="space-y-3">
                <Skeleton className="h-20 rounded-2xl" />
                <Skeleton className="h-20 rounded-2xl" />
              </div>
            ) : visibleTasks.length === 0 ? (
              <EmptyState size="sm">
                {tasks.length === 0
                  ? 'No tasks in this goal yet - add one to start breaking down the work.'
                  : 'No visible tasks in this goal.'}
              </EmptyState>
            ) : (
              <TaskBlockerActionsContext.Provider value={blockerActions}>
                <div className="mb-3 flex justify-end">
                  <ClearCompletedButton
                    count={visibleCompletedTasks.length}
                    onClear={() => clearCompletedTasks(goal.id)}
                  />
                </div>
                <WorkspaceTaskList
                  tasks={visibleTasks}
                  members={members}
                  user={user}
                  getWorkedSeconds={getLiveSeconds}
                  onStart={startTask}
                  onPause={pauseTask}
                  onEmergencyStop={emergencyStopTask}
                  onFinish={handleFinishTask}
                  onReopen={handleReopenTask}
                  onEdit={openEditTask}
                  onDelete={handleDeleteTask}
                  onReassign={reassignTask}
                  onReorder={() => {}}
                  onAddSubtask={openAddSubtask}
                  onDeleteParent={handleDeleteParent}
                  onMoveTo={handleMoveTo}
                  getBlockedBy={task =>
                    blockingTasksFor(task.id).map(t => t.name)
                  }
                  onManageDependencies={task => setDependencyTask(task)}
                />
              </TaskBlockerActionsContext.Provider>
            )}
          </div>
        </div>
      )}

      {taskModal === 'add' && (
        <Modal
          eyebrow={pendingParentId ? 'New subtask' : 'New task'}
          title={pendingParentId ? 'Add a subtask' : 'Add a task'}
          onClose={closeTaskModal}
        >
          <WorkspaceTaskForm
            values={taskForm}
            setValues={setTaskForm}
            isPersonal={isPersonal}
            members={members}
            assignedTo={taskAssignees}
            setAssignedTo={setTaskAssignees}
            submitLabel={pendingParentId ? 'Add subtask' : 'Add task'}
            onSubmit={handleAddTask}
            onCancel={closeTaskModal}
            ideas={ideas}
            showReferenceIdea={false}
          />
        </Modal>
      )}
      {taskModal === 'edit' && (
        <Modal
          eyebrow="Edit task"
          title="Refine this task"
          onClose={closeTaskModal}
        >
          <WorkspaceTaskForm
            values={taskForm}
            setValues={setTaskForm}
            isPersonal={isPersonal}
            members={members}
            assignedTo={taskAssignees}
            setAssignedTo={setTaskAssignees}
            submitLabel="Save changes"
            onSubmit={handleEditTask}
            onCancel={closeTaskModal}
            ideas={ideas}
            showReferenceIdea={false}
          />
        </Modal>
      )}
      {editingGoal && (
        <Modal
          eyebrow="Edit goal"
          title="Refine this goal"
          onClose={() => setEditingGoal(false)}
        >
          <GoalForm
            values={goalForm}
            setValues={setGoalForm}
            submitLabel="Save changes"
            onSubmit={handleEditGoal}
            onCancel={() => setEditingGoal(false)}
            ideas={ideas}
          />
        </Modal>
      )}
      {completionAlert.task && (
        <CompletionModal
          taskName={completionAlert.task.name}
          onStop={completionAlert.dismiss}
        />
      )}
      {pendingDeleteParent && (
        <DeleteParentModal
          taskName={pendingDeleteParent.task.name}
          childCount={pendingDeleteParent.childCount}
          onDeleteAll={confirmDeleteParentAndChildren}
          onOrphan={confirmOrphanChildren}
          onClose={() => setPendingDeleteParent(null)}
        />
      )}
      {dependencyTask && (
        <DependencyPicker
          task={dependencyTask}
          allTasks={tasks}
          dependencies={dependencies}
          onAdd={blockingTaskId =>
            addDependency(blockingTaskId, dependencyTask.id)
          }
          onRemove={removeDependency}
          onClose={() => setDependencyTask(null)}
        />
      )}
      {pendingDeleteGoal && (
        <ConfirmModal
          title="Delete this archived goal?"
          message={`"${goal.name}" and all of its tasks will be permanently deleted. This can't be undone.`}
          confirmLabel="Delete goal"
          onConfirm={confirmDeleteGoal}
          onClose={() => setPendingDeleteGoal(false)}
        />
      )}
    </div>
  )
}
