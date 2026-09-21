import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTimer } from '@/hooks/useTimer'
import { useWorkspaceTaskActions } from '@/hooks/useWorkspaceTaskActions'
import { useWorkspaceSnapshot } from '@/hooks/useWorkspaceSnapshot'
import { useFetchStatus } from '@/hooks/useFetchStatus'
import { useTaskAutoCompletion } from '@/hooks/useTaskAutoCompletion'
import { SNAPSHOTS } from '@/lib/cache/workspaceSnapshots'
import {
  WorkspaceTaskRow,
  TaskCollaboratorRow,
  attachTaskCollaborators,
  getWorkspaceLiveSeconds,
  rowToTaskCollaborator,
  rowToTask,
} from '@/lib/tasks/workspaceMappers'
import type { AuthUser } from '@/hooks/useAuth'
import { WorkspaceMember, WorkspaceTask } from '@/types/workspace'

export { getWorkspaceLiveSeconds }

// Ordinary (non-Goal) workspace tasks — permanently flat: hierarchy and
// dependencies only exist inside Goals (useGoalDetail.ts). Realtime via
// Supabase, following the same pattern as useWorkspaceActivity.ts etc.
//
// The list is also cached on this device (namespaced by user AND workspace) and
// shown from there on a repeat visit while the real list is fetched. What the
// cache may and may not do is the point of useWorkspaceSnapshot: it fills the
// screen sooner, but only a list the server has confirmed this session is
// handed to anything that acts on it -- auto-completing a task included (see
// useTaskAutoCompletion). A cached "working" task that ran out of time while the
// app was closed is shown, and is completed only if Supabase says it still is.
const NO_TASKS: WorkspaceTask[] = []
// The flat list holds goal-less tasks only; goal tasks are useGoalDetail's.
const isFlatTask = (task: WorkspaceTask) => task.goalId === null

export function useWorkspaceTasks(
  workspaceId: string,
  user: AuthUser | null,
  members: WorkspaceMember[],
  onComplete?: (task: WorkspaceTask) => void,
  isPersonal = false,
) {
  const userId = user?.id
  const snapshot = useWorkspaceSnapshot<WorkspaceTask[]>({
    userId,
    workspaceId,
    descriptor: SNAPSHOTS.tasks,
    initial: NO_TASKS,
  })
  const { data: tasks, setData: setTasks, confirm } = snapshot
  const [actionError, setError] = useState<string | null>(null)
  const now = useTimer()
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  const fetchKey = userId && workspaceId ? `${userId}|${workspaceId}` : null
  const status = useFetchStatus(snapshot, fetchKey, {
    load: "Couldn't load workspace tasks.",
    refresh: "Couldn't refresh tasks — you may be seeing an out-of-date list.",
  })
  const { failed: markFailed, succeeded: markSucceeded } = status
  const { ready } = status
  // A failed refresh, or a failed action (add, start, ...).
  const error = status.error ?? actionError

  useEffect(() => {
    if (!userId || !workspaceId || !fetchKey) return
    let cancelled = false
    const supabase = createClient()

    const fetchTasks = () => {
      Promise.all([
        supabase
          .from('workspace_tasks')
          .select('*')
          .eq('workspace_id', workspaceId)
          // Ordinary workspace tasks only — goal-scoped tasks/subtasks are
          // fetched separately by useGoalDetail, since hierarchy only exists
          // inside Goals now.
          .is('goal_id', null)
          .order('position', { ascending: true }),
        supabase
          .from('task_collaborators')
          .select('*')
          .eq('workspace_id', workspaceId)
          .is('removed_at', null),
      ]).then(([tasksResult, collaboratorsResult]) => {
        if (cancelled) return
        if (tasksResult.error || collaboratorsResult.error) {
          // Whatever is already shown (cached) stays: a failed refresh must
          // not blank the list, and must not pretend it is current.
          markFailed()
          return
        }
        confirm(
          attachTaskCollaborators(
            ((tasksResult.data ?? []) as WorkspaceTaskRow[]).map(rowToTask),
            ((collaboratorsResult.data ?? []) as TaskCollaboratorRow[]).map(
              rowToTaskCollaborator,
            ),
          ),
        )
        markSucceeded()
      })
    }

    fetchTasks()

    // Timer state is never trusted from memory alone across a reconnect —
    // a dropped websocket (laptop sleep, network blip) can silently miss
    // postgres_changes events, so coming back online or back into the tab
    // always re-derives the full task list from the database.
    const handleReconnect = () => fetchTasks()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleReconnect()
    }
    window.addEventListener('online', handleReconnect)
    document.addEventListener('visibilitychange', handleVisibility)

    const channel = supabase
      .channel(`workspace-tasks-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_tasks',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        payload => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string }).id
            if (deletedId)
              setTasks(current => current.filter(t => t.id !== deletedId))
            return
          }
          const incomingRow = payload.new as WorkspaceTaskRow
          // A goal-scoped task belongs to useGoalDetail's realtime feed, not
          // this flat one — the filter above can't express "goal_id is
          // null" server-side, so it's enforced here instead.
          if (incomingRow.goal_id) {
            setTasks(current => current.filter(t => t.id !== incomingRow.id))
            return
          }
          const incoming = rowToTask(incomingRow)
          setTasks(current => {
            const exists = current.some(t => t.id === incoming.id)
            return exists
              ? current.map(t => (t.id === incoming.id ? incoming : t))
              : [...current, incoming]
          })
        },
      )
      .subscribe()
    const collaboratorChannel = supabase
      .channel(`workspace-task-collaborators-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_collaborators',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          if (!cancelled) fetchTasks()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      window.removeEventListener('online', handleReconnect)
      document.removeEventListener('visibilitychange', handleVisibility)
      supabase.removeChannel(channel)
      supabase.removeChannel(collaboratorChannel)
    }
  }, [
    userId,
    workspaceId,
    fetchKey,
    confirm,
    setTasks,
    markFailed,
    markSucceeded,
  ])

  const {
    addTask: addTaskAction,
    updateTask,
    startTask,
    pauseTask,
    emergencyStopTask,
    finishTask,
    reopenTask,
    clearCompletedTasks,
    deleteTask,
    reassignTask,
    blockerActions,
  } = useWorkspaceTaskActions({
    workspaceId,
    userId,
    members,
    tasks,
    setTasks,
    setError,
    onComplete: task => onCompleteRef.current?.(task),
    now,
    isPersonal,
  })

  // Flat tasks never have a parent or a goal — the two params other callers
  // of the shared action accept (goal task creation) are fixed at null here.
  const addTask = (
    event: Parameters<typeof addTaskAction>[0],
    form: Parameters<typeof addTaskAction>[1],
    _parentTaskId: string | null = null,
    assignedTo: string | null = null,
  ) => addTaskAction(event, form, null, assignedTo, null)

  const reorderTasks = (fromIndex: number, toIndex: number) => {
    if (!userId) return
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= tasks.length ||
      toIndex >= tasks.length
    )
      return

    const reordered = [...tasks]
    const [movedTask] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, movedTask)
    setTasks(reordered)

    // Simple, workspace-scoped renormalization on every reorder — task
    // lists here are small team lists, so this is cheap.
    const supabase = createClient()
    void Promise.all(
      reordered.map((task, index) =>
        supabase
          .from('workspace_tasks')
          .update({ position: (index + 1) * 1000 })
          .eq('id', task.id),
      ),
    ).then(results => {
      if (results.some(r => r.error)) setError("Couldn't save the new order.")
    })
  }

  // Completing a task whose planned time ran out. Fed only server-confirmed
  // data (`snapshot.authoritative` is null while the list is cache-only), and
  // de-duplicated per timer run -- see hooks/useTaskAutoCompletion.ts.
  useTaskAutoCompletion({
    tasks: snapshot.authoritative,
    userId,
    isPersonal,
    now,
    setTasks,
    setError,
    onComplete,
    belongsInList: isFlatTask,
  })

  const activeTask = tasks.find(task => task.status === 'working')

  return {
    tasks,
    ready,
    error,
    activeTask,
    addTask,
    updateTask,
    startTask,
    pauseTask,
    emergencyStopTask,
    finishTask,
    reopenTask,
    clearCompletedTasks,
    deleteTask,
    reassignTask,
    reorderTasks,
    blockerActions,
    getLiveSeconds: (task: WorkspaceTask) => getWorkspaceLiveSeconds(task, now),
  }
}
