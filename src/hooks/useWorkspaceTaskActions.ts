import { FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { notifyTaskCompletion } from '@/lib/notifications'
import { markIdeaPlannedFromExecution } from '@/lib/ideas/status'
import { WorkspaceMember, WorkspaceTask } from '@/types/workspace'
import { TaskFormValues } from '@/types'
import { getWorkspaceLiveSeconds } from '@/lib/tasks/workspaceMappers'
import {
  canControlTimer,
  canEmergencyStop,
  canReopenTask,
} from '@/lib/tasks/timerPermissions'
import { shouldReopenOnExtend } from '@/lib/tasks/reopen'
import { useTaskBlockerActions } from '@/hooks/useTaskBlockerActions'

function memberDisplayName(member?: WorkspaceMember) {
  return member?.fullName || member?.email || 'Someone'
}

function collaboratorIdsForTask(task: WorkspaceTask | undefined) {
  if (!task) return []
  const collaboratorIds = (task.collaborators ?? [])
    .filter(collaborator => collaborator.removedAt === null)
    .map(collaborator => collaborator.userId)
  if (collaboratorIds.length > 0) return collaboratorIds
  return task.assignedTo ? [task.assignedTo] : []
}

// The timer RPCs reject a caller who isn't allowed with 42501 and a message
// meant to be read ("only the member this task is assigned to..."); anything
// else stays the generic fallback.
function timerErrorMessage(
  error: { code?: string; message?: string },
  fallback: string,
) {
  return error.code === '42501' && error.message ? error.message : fallback
}

// Shared task-mutation logic for both the flat workspace task list
// (useWorkspaceTasks.ts) and a single Goal's task/subtask list
// (useGoalDetail.ts) — the two views differ only in which tasks they hold
// and whether new tasks are created with a goalId, so the actual RPC calls,
// optimistic updates, and event logging live here once.
export function useWorkspaceTaskActions({
  workspaceId,
  userId,
  members,
  tasks,
  setTasks,
  setError,
  onComplete,
  now,
  isPersonal = false,
}: {
  workspaceId: string
  userId: string | undefined
  members: WorkspaceMember[]
  tasks: WorkspaceTask[]
  setTasks: (updater: (current: WorkspaceTask[]) => WorkspaceTask[]) => void
  setError: (error: string | null) => void
  onComplete?: (task: WorkspaceTask) => void
  now: number
  isPersonal?: boolean
}) {
  const timerActor = {
    userId,
    isPersonal,
    isOwner: members.some(m => m.userId === userId && m.role === 'owner'),
  }

  // Timer changes are applied optimistically, so a request the server turns
  // down (a stale tab that still thought it held the timer) has to put the
  // tasks it touched back the way they were.
  const restoreTasks = (snapshot: WorkspaceTask[]) =>
    setTasks(current =>
      current.map(task => snapshot.find(s => s.id === task.id) ?? task),
    )

  // Block / edit / resolve. Kept in their own hook (and returned as one object)
  // so this file doesn't grow a third concern; it lives here only because it
  // needs the same tasks, setTasks and rollback as the timer actions above.
  const blockerActions = useTaskBlockerActions({
    workspaceId,
    userId,
    members,
    tasks,
    setTasks,
    setError,
    now,
    isPersonal,
    restoreTasks,
  })

  const logEvent = (
    taskId: string,
    eventType: string,
    metadata: Record<string, unknown>,
    goalId?: string | null,
  ) => {
    if (!userId) return
    const supabase = createClient()
    void supabase.from('task_events').insert({
      task_id: taskId,
      workspace_id: workspaceId,
      goal_id: goalId ?? null,
      actor_id: userId,
      event_type: eventType,
      metadata,
    })
  }

  const addTask = (
    event: FormEvent,
    form: TaskFormValues,
    parentTaskId: string | null = null,
    assignedTo: string | string[] | null = null,
    goalId: string | null = null,
    ideaId: string | null = null,
  ) => {
    event.preventDefault()
    if (!userId || !form.name.trim()) return false

    const plannedMinutes =
      form.hasPlannedTime === false
        ? null
        : form.hours || form.minutes
          ? Number(form.hours || 0) * 60 + Number(form.minutes || 0)
          : null
    const description = form.description?.trim() || null

    const id = crypto.randomUUID()
    const name = form.name.trim()
    const progressLabel = form.trackGoal
      ? form.goal.trim() || undefined
      : undefined
    const progressPercentage = form.trackGoal
      ? Math.min(100, Math.max(0, Number(form.progress) || 0))
      : undefined
    const effectiveIdeaId = form.ideaId || ideaId || null
    const assigneeIds = Array.isArray(assignedTo)
      ? assignedTo
      : assignedTo
        ? [assignedTo]
        : []
    const primaryAssignee = assigneeIds[0] ?? null

    setTasks(current => [
      ...current,
      {
        id,
        workspaceId,
        parentTaskId,
        goalId,
        ideaId: effectiveIdeaId,
        createdBy: userId,
        assignedTo: primaryAssignee,
        name,
        description,
        plannedMinutes,
        workedSeconds: 0,
        status: 'queued',
        startedAt: null,
        completedAt: null,
        collaborators: assigneeIds.map(assigneeId => ({
          id: `${id}:${assigneeId}`,
          taskId: id,
          workspaceId,
          userId: assigneeId,
          participationStatus: 'queued',
          startedAt: null,
          completedAt: null,
          removedAt: null,
        })),
        progressLabel,
        progressPercentage,
      },
    ])

    const supabase = createClient()
    void supabase
      .rpc('create_workspace_task_with_collaborators', {
        p_id: id,
        p_workspace_id: workspaceId,
        p_parent_task_id: parentTaskId,
        p_goal_id: goalId,
        p_idea_id: effectiveIdeaId,
        p_title: name,
        p_description: description,
        p_planned_seconds: plannedMinutes !== null ? plannedMinutes * 60 : null,
        p_progress_label: progressLabel ?? null,
        p_progress_percentage: progressPercentage ?? null,
        p_user_ids: assigneeIds,
      })
      .then(({ error: insertError }) => {
        if (insertError) {
          setError("Couldn't add the task.")
          setTasks(current => current.filter(task => task.id !== id))
          return
        }
        void markIdeaPlannedFromExecution(
          supabase,
          effectiveIdeaId,
          workspaceId,
        )
      })

    return true
  }

  const updateTask = (id: string, update: Partial<WorkspaceTask>) => {
    if (!userId) return
    const before = tasks.find(task => task.id === id)
    // More time on a completed task means it has work left, so it goes back to
    // paused (resumable). The database makes the same change in the same write
    // — status isn't client-writable, see reopen_workspace_task_on_extend in
    // 0037 — so this only mirrors it for an instant UI update. It's also why
    // `row` below never carries a status.
    const reopens = before
      ? shouldReopenOnExtend(before, update.plannedMinutes)
      : false
    setTasks(current =>
      current.map(task =>
        task.id === id
          ? {
              ...task,
              ...update,
              ...(reopens
                ? {
                    status: 'paused' as const,
                    startedAt: null,
                    completedAt: null,
                  }
                : {}),
            }
          : task,
      ),
    )
    const row: Record<string, unknown> = {}
    if (update.name !== undefined) row.title = update.name
    if (update.description !== undefined)
      row.description = update.description ?? null
    if (update.plannedMinutes !== undefined)
      row.planned_seconds =
        update.plannedMinutes !== null ? update.plannedMinutes * 60 : null
    if (update.progressLabel !== undefined)
      row.progress_label = update.progressLabel ?? null
    if (update.progressPercentage !== undefined)
      row.progress_percentage = update.progressPercentage ?? null
    if (update.ideaId !== undefined) row.idea_id = update.ideaId ?? null
    if (Object.keys(row).length === 0) return
    const supabase = createClient()
    void supabase
      .from('workspace_tasks')
      .update(row)
      .eq('id', id)
      .then(({ error: updateError }) => {
        if (updateError) {
          // Don't leave a task showing as reopened when the save that would
          // have reopened it failed.
          if (reopens && before) restoreTasks([before])
          setError("Couldn't save your changes.")
          return
        }
        if (update.ideaId !== undefined) {
          void markIdeaPlannedFromExecution(
            supabase,
            update.ideaId,
            workspaceId,
          )
        }
        const parentTitle = before?.parentTaskId
          ? tasks.find(t => t.id === before.parentTaskId)?.name
          : undefined
        // Progress is logged separately from a plain edit — the aggregator
        // reconstructs progress_start/progress_end for the AI summary from
        // this event's from/to, never from the task's current value, so a
        // later edit can't rewrite what progress looked like that day.
        if (
          update.progressPercentage !== undefined &&
          update.progressPercentage !== before?.progressPercentage
        ) {
          logEvent(
            id,
            'progress_changed',
            {
              title: update.name ?? before?.name,
              parent_title: parentTitle,
              from: before?.progressPercentage ?? null,
              to: update.progressPercentage ?? null,
            },
            before?.goalId,
          )
        }
        if (update.name !== undefined || update.plannedMinutes !== undefined) {
          logEvent(
            id,
            'edited',
            {
              title: update.name ?? before?.name,
              parent_title: parentTitle,
            },
            before?.goalId,
          )
        }
      })
  }

  const startTask = (id: string) => {
    if (!userId) return
    const target = tasks.find(task => task.id === id)
    // A blocked task is started again only after its blocker is resolved (the
    // server refuses it too); don't flash it as working in the meantime.
    if (
      !target ||
      target.status === 'blocked' ||
      !canControlTimer(target, timerActor)
    )
      return
    const isParent = tasks.some(task => task.parentTaskId === id)
    if (isParent) return
    // Starting a task only ever ends the caller's OWN running timer in this
    // workspace — never a teammate's task that happens to be in the same list.
    const isMyRunningTimer = (task: WorkspaceTask) =>
      task.status === 'working' && canControlTimer(task, timerActor)
    const touched = tasks.filter(
      task => task.id === id || isMyRunningTimer(task),
    )
    setTasks(current =>
      current.map(task => {
        if (task.id === id)
          return { ...task, status: 'working', startedAt: Date.now() }
        if (isMyRunningTimer(task))
          return {
            ...task,
            status: 'paused',
            workedSeconds: Math.round(getWorkspaceLiveSeconds(task, now)),
            startedAt: null,
          }
        return task
      }),
    )
    const supabase = createClient()
    void supabase
      .rpc('start_workspace_task', { p_task_id: id })
      .then(({ error: rpcError }) => {
        if (!rpcError) return
        restoreTasks(touched)
        setError(timerErrorMessage(rpcError, "Couldn't start the timer."))
      })
  }

  const pauseTask = (task: WorkspaceTask) => {
    if (!userId || !canControlTimer(task, timerActor)) return
    const workedSeconds = Math.round(getWorkspaceLiveSeconds(task, now))
    setTasks(current =>
      current.map(t =>
        t.id === task.id
          ? { ...t, status: 'paused', workedSeconds, startedAt: null }
          : t,
      ),
    )
    const supabase = createClient()
    void supabase
      .rpc('pause_workspace_task', { p_task_id: task.id })
      .then(({ error: rpcError }) => {
        if (!rpcError) return
        restoreTasks([task])
        setError(timerErrorMessage(rpcError, "Couldn't pause the timer."))
      })
  }

  // The owner's override for someone else's running timer: stops it (the
  // task is paused, not completed, and keeps its assignee and every second
  // recorded so far). It never starts anything.
  const emergencyStopTask = (task: WorkspaceTask) => {
    if (!userId || !canEmergencyStop(task, timerActor)) return
    const workedSeconds = Math.round(getWorkspaceLiveSeconds(task, now))
    setTasks(current =>
      current.map(t =>
        t.id === task.id
          ? { ...t, status: 'paused', workedSeconds, startedAt: null }
          : t,
      ),
    )
    const supabase = createClient()
    void supabase
      .rpc('emergency_stop_workspace_task', { p_task_id: task.id })
      .then(({ error: rpcError }) => {
        if (!rpcError) return
        restoreTasks([task])
        setError(timerErrorMessage(rpcError, "Couldn't stop the timer."))
      })
  }

  const finishTask = (task: WorkspaceTask, early = false) => {
    if (!userId) return
    // Same as starting: a blocked task has to be unblocked before it can end.
    if (task.status === 'blocked') return
    // Finishing or skipping a task requires timer control permission.
    if (!canControlTimer(task, timerActor)) return
    const workedSeconds = Math.round(getWorkspaceLiveSeconds(task, now))
    setTasks(current =>
      current.map(t =>
        t.id === task.id
          ? {
              ...t,
              status: early ? 'skipped' : 'completed',
              workedSeconds,
              startedAt: null,
              completedAt: Date.now(),
            }
          : t,
      ),
    )
    const supabase = createClient()
    void supabase
      .rpc('complete_workspace_task', { p_task_id: task.id, p_skip: early })
      .then(({ error: rpcError }) => {
        if (!rpcError) return
        restoreTasks([task])
        setError(timerErrorMessage(rpcError, "Couldn't save task completion."))
      })
  }

  const reopenTask = (task: WorkspaceTask) => {
    if (!userId || !canReopenTask(task, timerActor)) return
    setTasks(current =>
      current.map(t =>
        t.id === task.id
          ? {
              ...t,
              status: 'queued' as const,
              startedAt: null,
              completedAt: null,
              completedClearedAt: null,
            }
          : t,
      ),
    )
    const supabase = createClient()
    void supabase
      .rpc('reopen_workspace_task', { p_task_id: task.id })
      .then(({ error: rpcError }) => {
        if (!rpcError) return
        restoreTasks([task])
        setError(timerErrorMessage(rpcError, "Couldn't reopen task."))
      })
  }

  const clearCompletedTasks = (goalId: string | null = null) => {
    if (!userId) return
    const completed = tasks.filter(
      task =>
        task.goalId === goalId &&
        task.completedClearedAt == null &&
        (task.status === 'completed' || task.status === 'skipped'),
    )
    if (completed.length === 0) return

    const clearedAt = Date.now()
    setTasks(current =>
      current.map(task =>
        completed.some(done => done.id === task.id)
          ? { ...task, completedClearedAt: clearedAt }
          : task,
      ),
    )

    const supabase = createClient()
    void supabase
      .rpc('clear_completed_workspace_tasks', {
        p_workspace_id: workspaceId,
        p_goal_id: goalId,
      })
      .then(({ error: rpcError }) => {
        if (!rpcError) return
        restoreTasks(completed)
        setError("Couldn't clear completed tasks.")
      })
  }

  const deleteTask = (id: string) => {
    if (!userId) return
    const removed = tasks.find(task => task.id === id)
    setTasks(current => current.filter(task => task.id !== id))
    const supabase = createClient()
    void supabase
      .from('workspace_tasks')
      .delete()
      .eq('id', id)
      .then(({ error: deleteError }) => {
        if (deleteError) {
          setError("Couldn't remove the task.")
          if (removed) setTasks(current => [...current, removed])
          return
        }
        if (removed) {
          const parentTitle = removed.parentTaskId
            ? tasks.find(t => t.id === removed.parentTaskId)?.name
            : undefined
          logEvent(
            id,
            'deleted',
            {
              title: removed.name,
              parent_title: parentTitle,
            },
            removed.goalId,
          )
        }
      })
  }

  // A task can only move under a root task that isn't itself a child (one
  // level of nesting), and a task with children of its own can't become
  // someone else's child. Passing null makes it a top-level goal task again.
  // The DB trigger (enforce_goal_task_hierarchy) also requires the target to
  // share the same goal — irrelevant here since both tasks always come from
  // the same goal-scoped list, but still enforced server-side as a backstop.
  const moveTask = (id: string, parentTaskId: string | null) => {
    if (!userId || id === parentTaskId) return
    const hasChildren = tasks.some(task => task.parentTaskId === id)
    if (hasChildren && parentTaskId !== null) return
    if (parentTaskId !== null) {
      const target = tasks.find(task => task.id === parentTaskId)
      if (!target || target.parentTaskId !== null) return
    }
    const task = tasks.find(t => t.id === id)
    setTasks(current =>
      current.map(t => (t.id === id ? { ...t, parentTaskId } : t)),
    )
    const supabase = createClient()
    void supabase
      .from('workspace_tasks')
      .update({ parent_task_id: parentTaskId })
      .eq('id', id)
      .then(({ error: updateError }) => {
        if (updateError) {
          setError("Couldn't move the task.")
          return
        }
        logEvent(
          id,
          'parent_changed',
          {
            title: task?.name,
            to: parentTaskId
              ? tasks.find(t => t.id === parentTaskId)?.name
              : 'Standalone',
            parent_title: parentTaskId
              ? tasks.find(t => t.id === parentTaskId)?.name
              : undefined,
          },
          task?.goalId,
        )
      })
  }

  const reassignTask = (
    id: string,
    newAssigneeId: string | string[] | null,
  ) => {
    if (!userId) return
    const task = tasks.find(t => t.id === id)
    const newAssigneeIds = Array.isArray(newAssigneeId)
      ? newAssigneeId
      : newAssigneeId
        ? [newAssigneeId]
        : []
    const primaryAssigneeId = newAssigneeIds[0] ?? null
    const previousAssigneeIds = collaboratorIdsForTask(task)
    const fromMember = members.find(m => m.userId === task?.assignedTo)
    const toMember = primaryAssigneeId
      ? members.find(m => m.userId === primaryAssigneeId)
      : undefined
    const fromName = memberDisplayName(fromMember)
    const toName =
      newAssigneeIds.length > 1
        ? `${newAssigneeIds.length} collaborators`
        : primaryAssigneeId
          ? memberDisplayName(toMember)
          : 'Unassigned'
    // Changing hands stops a running timer — the database does this in the
    // same write (time recorded so far is kept, and the new assignee can then
    // resume) — so the card mustn't keep counting under the new name while
    // waiting for the realtime update to land.
    const stopsTimer =
      task?.status === 'working' &&
      !newAssigneeIds.includes(task.assignedTo ?? '') &&
      !isPersonal
    setTasks(current =>
      current.map(t =>
        t.id === id
          ? {
              ...t,
              assignedTo: primaryAssigneeId,
              collaborators: newAssigneeIds.map(assigneeId => {
                const existing = t.collaborators?.find(
                  collaborator =>
                    collaborator.userId === assigneeId &&
                    collaborator.removedAt === null,
                )
                return (
                  existing ?? {
                    id: `${t.id}:${assigneeId}`,
                    taskId: t.id,
                    workspaceId: t.workspaceId,
                    userId: assigneeId,
                    participationStatus: 'queued' as const,
                    startedAt: null,
                    completedAt: null,
                    removedAt: null,
                  }
                )
              }),
              ...(stopsTimer
                ? {
                    status: 'paused' as const,
                    workedSeconds: Math.round(getWorkspaceLiveSeconds(t, now)),
                    startedAt: null,
                  }
                : {}),
            }
          : t,
      ),
    )
    const supabase = createClient()
    void supabase
      .rpc('set_workspace_task_collaborators', {
        p_task_id: id,
        p_user_ids: newAssigneeIds,
      })
      .then(({ error: updateError }) => {
        if (updateError) {
          if (task) restoreTasks([task])
          // Prefer the server's readable reason when it gives one.
          setError(
            updateError.message
              ? updateError.message.charAt(0).toUpperCase() +
                  updateError.message.slice(1)
              : "Couldn't reassign the task.",
          )
          return
        }
        const parentTitle = task?.parentTaskId
          ? tasks.find(t => t.id === task.parentTaskId)?.name
          : undefined
        const eventType = !primaryAssigneeId
          ? 'unassigned'
          : task?.assignedTo
            ? 'reassigned'
            : 'assigned'
        // to_user_id/from_user_id (not just display-name strings) are what
        // notify_from_task_event() needs to know who to notify.
        logEvent(
          id,
          eventType,
          {
            title: task?.name,
            from: fromName,
            to: toName,
            from_user_id: task?.assignedTo ?? null,
            to_user_id: primaryAssigneeId,
            from_user_ids: previousAssigneeIds,
            to_user_ids: newAssigneeIds,
            parent_title: parentTitle,
          },
          task?.goalId,
        )
      })
  }

  return {
    logEvent,
    addTask,
    updateTask,
    startTask,
    pauseTask,
    emergencyStopTask,
    finishTask,
    reopenTask,
    clearCompletedTasks,
    deleteTask,
    moveTask,
    reassignTask,
    blockerActions,
  }
}
