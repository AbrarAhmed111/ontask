'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { WorkspaceTasksSection } from '@/components/workspaces/WorkspaceTasksSection'
import { useOptionalWorkspaceBlockers } from '@/components/workspaces/WorkspaceBlockersContext'
import { TaskBlockerActionsContext } from '@/components/blockers/TaskBlockerActionsContext'
import type { BlockedNowItem } from '@/components/blockers/BlockedNowPanel'
import { WorkspaceGoalsSection } from '@/components/workspaces/WorkspaceGoalsSection'
import { WorkspaceResourcesSection } from '@/components/workspaces/WorkspaceResourcesSection'
import { WorkspaceActivitySection } from '@/components/workspaces/WorkspaceActivitySection'
import { WorkspaceSummarySection } from '@/components/workspaces/WorkspaceSummarySection'
import { WorkspaceTaskForm } from '@/components/workspaces/WorkspaceTaskForm'
import { CompletionModal } from '@/components/tasks/CompletionModal'
import { GoalForm } from '@/components/goals/GoalForm'
import { ResourcesModal } from '@/components/resources/ResourcesModal'
import { Modal } from '@/components/ui/Modal'
import { TourLayer } from '@/components/tour/TourLayer'
import { useWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import { useCompletionAlert } from '@/hooks/useCompletionAlert'
import { useSettings } from '@/hooks/useSettings'
import { useWorkspaceTour } from '@/hooks/useWorkspaceTour'
import { useWorkspaceTasks } from '@/hooks/useWorkspaceTasks'
import { useWorkspaceGoals, GoalFormValues } from '@/hooks/useWorkspaceGoals'
import { useWorkspaceIdeas } from '@/hooks/useWorkspaceIdeas'
import { useWorkspaceResources } from '@/hooks/useWorkspaceResources'
import { useWorkspaceActivity } from '@/hooks/useWorkspaceActivity'
import { useWorkspaceSummary } from '@/hooks/useWorkspaceSummary'
import { formatTimeOfDay } from '@/lib/dailyReportWindow'
import { describeUploadOutcome } from '@/lib/resourceUploads'
import { WorkspaceTask } from '@/types/workspace'
import { TaskFormValues } from '@/types'

type GoalWorkingTask = {
  task: WorkspaceTask
  goalName: string
}

const emptyTaskForm: TaskFormValues = {
  name: '',
  hours: '0',
  minutes: '0',
  goal: '',
  progress: '0',
  trackGoal: false,
}

const emptyGoalForm: GoalFormValues = {
  name: '',
  description: '',
  targetDate: '',
}

export function WorkspaceOverviewClient() {
  const { workspaceId, user, workspace, members, isOwner, isPersonal, ready } =
    useWorkspaceDetail()
  // The completion-sound preference is per person and device (localStorage),
  // not per workspace, so the same setting governs a guest's tasks, a
  // personal workspace and every shared one. Read once here and handed down.
  const { settings } = useSettings()
  const completionAlert = useCompletionAlert<WorkspaceTask>(
    settings.soundEnabled,
  )
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
    reassignTask,
    reorderTasks,
    blockerActions,
    getLiveSeconds,
  } = useWorkspaceTasks(
    workspaceId,
    user,
    members,
    completionAlert.notify,
    isPersonal,
  )

  // Off hides the whole Daily Report section -- no empty card, no "no reports
  // yet" placeholder -- and stops it fetching anything. Nothing is deleted:
  // switching it back on shows the reports that were already stored.
  const dailyReportsEnabled = workspace?.dailyReportsEnabled ?? false
  const {
    goals,
    ready: goalsReady,
    error: goalsError,
    createGoal,
    updateGoal,
    setGoalStatus,
    deleteGoal,
  } = useWorkspaceGoals(workspaceId, user)
  const { ideas } = useWorkspaceIdeas(workspaceId, user)
  const linkableIdeas = ideas.filter(idea => idea.status !== 'archived')
  const {
    resources,
    ready: resourcesReady,
    error: resourcesError,
    uploads: resourceUploads,
    uploadMany: uploadResources,
    dismissUploads: dismissResourceUploads,
    remove: removeResource,
    getSignedUrl,
  } = useWorkspaceResources(workspaceId, user)
  const {
    events: activityEvents,
    ready: activityReady,
    error: activityError,
  } = useWorkspaceActivity(workspaceId, user)
  const {
    summary,
    ready: summaryReady,
    error: summaryError,
    generating: summaryGenerating,
    regenerate: regenerateSummary,
    nextReportLabel,
  } = useWorkspaceSummary(
    workspaceId,
    user,
    workspace?.timezone ?? '',
    workspace?.reportTime ?? '12:00:00',
    dailyReportsEnabled,
  )

  // The tour's steps point at things these sections render, so it waits until
  // every one of them has its data (each shows a placeholder until then).
  useWorkspaceTour({
    contentReady:
      ready && tasksReady && goalsReady && resourcesReady && activityReady,
  })

  const [taskModal, setTaskModal] = useState<'add' | 'edit' | null>(null)
  const [taskForm, setTaskForm] = useState<TaskFormValues>(emptyTaskForm)
  const [taskAssignees, setTaskAssignees] = useState<string[]>([])
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [goalModalOpen, setGoalModalOpen] = useState(false)
  const [resourcesModalOpen, setResourcesModalOpen] = useState(false)
  const [goalForm, setGoalForm] = useState<GoalFormValues>(emptyGoalForm)
  const [goalWorkingTasks, setGoalWorkingTasks] = useState<
    Record<string, GoalWorkingTask[]>
  >({})
  const [goalBlockedTasks, setGoalBlockedTasks] = useState<
    Record<string, GoalWorkingTask[]>
  >({})
  const blockers = useOptionalWorkspaceBlockers()

  useEffect(() => {
    if (tasksError) showErrorToast(tasksError)
  }, [tasksError])
  useEffect(() => {
    if (goalsError) showErrorToast(goalsError)
  }, [goalsError])
  useEffect(() => {
    if (resourcesError) showErrorToast(resourcesError)
  }, [resourcesError])

  const workingNow = tasks.filter(task => task.status === 'working')
  const isDone = (task: WorkspaceTask) =>
    task.status === 'completed' || task.status === 'skipped'
  // Ordinary tasks are permanently flat now (hierarchy only exists inside
  // Goals — see supabase/migrations/0021_workspace_goals.sql), so the queue
  // and completed lists are a plain status split with no parent grouping.
  const visibleTasks = tasks.filter(task => task.completedClearedAt == null)
  const queueTasks = visibleTasks.filter(task => !isDone(task))
  const completedTasks = visibleTasks.filter(isDone)
  const workingGoalTasks = Object.values(goalWorkingTasks).flat()
  const handleWorkingTasksChange = useCallback(
    (goalId: string, workingTasks: WorkspaceTask[]) => {
      setGoalWorkingTasks(current => ({
        ...current,
        [goalId]: workingTasks.map(task => ({
          task,
          goalName: goals.find(goal => goal.id === goalId)?.name ?? 'Goal',
        })),
      }))
    },
    [goals],
  )
  const handleBlockedTasksChange = useCallback(
    (goalId: string, blockedTasks: WorkspaceTask[]) => {
      setGoalBlockedTasks(current => ({
        ...current,
        [goalId]: blockedTasks.map(task => ({
          task,
          goalName: goals.find(goal => goal.id === goalId)?.name ?? 'Goal',
        })),
      }))
    },
    [goals],
  )
  // Every blocked task, flat and Goal alike, with its active blocker. A blocked
  // task whose blocker hasn't arrived yet (or was just resolved) is left out.
  const blockedItems: BlockedNowItem[] = [
    ...tasks
      .filter(task => task.status === 'blocked')
      .map(task => ({ task, goalName: undefined as string | undefined })),
    ...Object.values(goalBlockedTasks).flat(),
  ].flatMap(({ task, goalName }) => {
    const blocker = blockers?.blockerForTask(task.id)
    return blocker ? [{ task, goalName, blocker }] : []
  })

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const stats = {
    members: members.length,
    working: workingNow.length + workingGoalTasks.length,
    queued: tasks.filter(task => task.status === 'queued').length,
    completedToday: tasks.filter(
      task =>
        task.status === 'completed' &&
        task.completedAt !== null &&
        task.completedAt >= startOfToday.getTime(),
    ).length,
  }

  const handleRegenerateSummary = async () => {
    const result = await regenerateSummary()
    if (result.success) {
      showSuccessToast('Daily Report regenerated.')
    } else {
      showErrorToast(result.error || 'Failed to regenerate the report.')
    }
  }

  const closeTaskModal = () => {
    setTaskModal(null)
    setEditingTaskId(null)
  }
  const openAddTask = () => {
    setTaskForm({ ...emptyTaskForm })
    setTaskAssignees([])
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
    if (addTask(event, taskForm, null, taskAssignees)) {
      closeTaskModal()
      showSuccessToast('Task added.')
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

  const openAddGoal = () => {
    setGoalForm({ ...emptyGoalForm })
    setGoalModalOpen(true)
  }
  const handleAddGoal = (event: FormEvent) => {
    if (createGoal(event, goalForm)) {
      setGoalModalOpen(false)
      showSuccessToast('Goal created.')
    }
  }

  const handleUploadResources = async (files: File[]) => {
    const outcome = describeUploadOutcome(await uploadResources(files))
    if (!outcome) return
    if (outcome.tone === 'success') showSuccessToast(outcome.message)
    else showErrorToast(outcome.message)
  }
  const handleDeleteResource = async (id: string) => {
    // Report what the server actually did, not what we hoped for.
    const result = await removeResource(id)
    if (result.ok) showSuccessToast('Resource removed.')
    else showErrorToast(result.message)
  }

  return (
    <div className="space-y-8">
      <TaskBlockerActionsContext.Provider value={blockerActions}>
        <WorkspaceTasksSection
          ready={ready && tasksReady}
          error={tasksError}
          isPersonal={isPersonal}
          stats={stats}
          workingNow={workingNow}
          workingGoalTasks={workingGoalTasks}
          blockedItems={blockedItems}
          tasks={tasks}
          members={members}
          user={user}
          queueTasks={queueTasks}
          completedTasks={completedTasks}
          getLiveSeconds={getLiveSeconds}
          onAddTask={openAddTask}
          onStart={startTask}
          onPause={pauseTask}
          onEmergencyStop={emergencyStopTask}
          onFinish={handleFinishTask}
          onReopen={handleReopenTask}
          onEdit={openEditTask}
          onDelete={handleDeleteTask}
          onClearCompleted={() => clearCompletedTasks(null)}
          onReassign={reassignTask}
          onReorder={reorderTasks}
        />
      </TaskBlockerActionsContext.Provider>

      <WorkspaceGoalsSection
        ready={ready && goalsReady}
        error={goalsError}
        goals={goals}
        workspaceId={workspaceId}
        isPersonal={isPersonal}
        soundEnabled={settings.soundEnabled}
        user={user}
        members={members}
        updateGoal={updateGoal}
        setGoalStatus={setGoalStatus}
        deleteGoal={deleteGoal}
        onWorkingTasksChange={handleWorkingTasksChange}
        onBlockedTasksChange={handleBlockedTasksChange}
        onAddGoal={openAddGoal}
        ideas={linkableIdeas}
      />

      <WorkspaceResourcesSection
        ready={ready && resourcesReady}
        error={resourcesError}
        isPersonal={isPersonal}
        resources={resources}
        onOpen={() => setResourcesModalOpen(true)}
        onAddResource={() => setResourcesModalOpen(true)}
      />

      <WorkspaceSummarySection
        enabled={dailyReportsEnabled}
        ready={ready && summaryReady}
        error={summaryError}
        summary={summary}
        members={members}
        isPersonal={isPersonal}
        nextReportLabel={nextReportLabel}
        reportTimeLabel={formatTimeOfDay(workspace?.reportTime ?? '12:00:00')}
        generating={summaryGenerating}
        onRegenerate={handleRegenerateSummary}
      />

      <WorkspaceActivitySection
        ready={ready && activityReady}
        error={activityError}
        events={activityEvents}
        members={members}
      />

      {taskModal === 'add' && (
        <Modal
          eyebrow="New task"
          title="Add a task"
          onClose={closeTaskModal}
          fill
        >
          <WorkspaceTaskForm
            values={taskForm}
            setValues={setTaskForm}
            isPersonal={isPersonal}
            members={members}
            assignedTo={taskAssignees}
            setAssignedTo={setTaskAssignees}
            submitLabel="Add task"
            onSubmit={handleAddTask}
            onCancel={closeTaskModal}
            ideas={linkableIdeas}
          />
        </Modal>
      )}
      {taskModal === 'edit' && (
        <Modal
          eyebrow="Edit task"
          title="Refine this task"
          onClose={closeTaskModal}
          fill
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
            ideas={linkableIdeas}
          />
        </Modal>
      )}
      {goalModalOpen && (
        <Modal
          eyebrow="New goal"
          title="Create a goal"
          onClose={() => setGoalModalOpen(false)}
        >
          <GoalForm
            values={goalForm}
            setValues={setGoalForm}
            submitLabel="Create goal"
            onSubmit={handleAddGoal}
            onCancel={() => setGoalModalOpen(false)}
            ideas={linkableIdeas}
          />
        </Modal>
      )}
      {completionAlert.task && (
        <CompletionModal
          taskName={completionAlert.task.name}
          onStop={completionAlert.dismiss}
        />
      )}
      {resourcesModalOpen && (
        <ResourcesModal
          resources={resources}
          members={members}
          userId={user?.id}
          isOwner={isOwner}
          loading={!(ready && resourcesReady)}
          uploads={resourceUploads}
          onUpload={handleUploadResources}
          onDismissUploads={dismissResourceUploads}
          onDelete={handleDeleteResource}
          getSignedUrl={getSignedUrl}
          onClose={() => setResourcesModalOpen(false)}
        />
      )}
      <TourLayer />
    </div>
  )
}
