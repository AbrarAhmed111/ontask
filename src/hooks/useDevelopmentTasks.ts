'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspaceSnapshot } from '@/hooks/useWorkspaceSnapshot'
import { useFetchStatus } from '@/hooks/useFetchStatus'
import {
  SNAPSHOTS,
  type DevelopmentSnapshot,
} from '@/lib/cache/workspaceSnapshots'
import { useTimer } from '@/hooks/useTimer'
import { useWorkspaceTaskActions } from '@/hooks/useWorkspaceTaskActions'
import type { AuthUser } from '@/hooks/useAuth'
import {
  TaskCollaboratorRow,
  WorkspaceTaskRow,
  attachTaskCollaborators,
  rowToTask,
  rowToTaskCollaborator,
} from '@/lib/tasks/workspaceMappers'
import {
  TaskDevelopmentRow,
  rowToTaskDevelopment,
} from '@/lib/development/tracking'
import { onResync } from '@/lib/realtime/onResync'
import type {
  DevelopmentWorkType,
  TaskDevelopment,
  TaskPriority,
  WorkspaceMember,
  WorkspaceTask,
} from '@/types/workspace'

export type DevelopmentTaskInput = {
  title: string
  description: string
  workType: DevelopmentWorkType
  goalId: string | null
  assigneeId: string | null
  priority: TaskPriority | null
  branchName: string
}

type Result = { success: true } | { success: false; error: string }

// What the server said, made readable (its messages are written for people).
function failure(error: { message?: string } | null, fallback: string): Result {
  const message = error?.message?.trim()
  return {
    success: false,
    error: message
      ? message.charAt(0).toUpperCase() + message.slice(1)
      : fallback,
  }
}

const EMPTY: DevelopmentSnapshot = { tasks: [], developments: [] }

// How long a task's GitHub check counts as fresh on this device. The server
// throttles to once a minute per task anyway; skipping the request here means
// reopening a task doesn't even ask.
export const RECONCILE_FRESH_MS = 60_000
const reconciledAt = new Map<string, number>()

// The workspace's Development Tasks: each ordinary task with its development
// record. The tasks themselves are changed through the same actions every task
// list uses (useWorkspaceTaskActions), so reassigning or editing one here is
// exactly the same operation as on its task card; only creating one, and the
// branch name, go through the Development RPCs.
//
// Live: GitHub updates arrive as task_development changes (written by the
// server), task changes as workspace_tasks/task_collaborators changes. Any of
// them re-reads the list -- it is small, and the source of truth stays the
// database rather than a merge of partial realtime rows.
export function useDevelopmentTasks(
  workspaceId: string,
  user: AuthUser | null,
  members: WorkspaceMember[],
  enabled: boolean,
) {
  const userId = user?.id
  const active = Boolean(userId && workspaceId && enabled)
  // Cached per user + workspace (hooks/useWorkspaceSnapshot.ts): the last list
  // shows straight away -- with each task's branch and pull request -- and the
  // read below confirms or replaces it.
  const snapshot = useWorkspaceSnapshot<DevelopmentSnapshot>({
    userId: active ? userId : null,
    workspaceId,
    descriptor: SNAPSHOTS.development,
    initial: EMPTY,
  })
  const { confirm, setData } = snapshot
  const { tasks, developments: developmentList } = snapshot.data
  const developments = useMemo(
    () => new Map(developmentList.map(item => [item.taskId, item])),
    [developmentList],
  )
  const fetchStatus = useFetchStatus(
    snapshot,
    active ? `${userId}|${workspaceId}` : null,
    { load: "Couldn't load development tasks.", refresh: '' },
  )
  const { succeeded, failed } = fetchStatus
  const [error, setError] = useState<string | null>(null)
  const now = useTimer()
  const taskIdsRef = useRef<Set<string>>(new Set())
  taskIdsRef.current = new Set(developmentList.map(item => item.taskId))
  const refetchRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const supabase = createClient()
    // Another workspace's list is never shown here: the snapshot is keyed by
    // user and workspace.
    setError(null)

    const fetchAll = async () => {
      const { data: devRows, error: devError } = await supabase
        .from('task_development')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (devError) {
        failed()
        return
      }
      const rows = (devRows ?? []) as TaskDevelopmentRow[]
      const ids = rows.map(row => row.task_id)
      let taskList: WorkspaceTask[] = []
      if (ids.length > 0) {
        const [tasksResult, collaboratorsResult] = await Promise.all([
          supabase.from('workspace_tasks').select('*').in('id', ids),
          supabase
            .from('task_collaborators')
            .select('*')
            .in('task_id', ids)
            .is('removed_at', null),
        ])
        if (cancelled) return
        if (tasksResult.error || collaboratorsResult.error) {
          failed()
          return
        }
        taskList = attachTaskCollaborators(
          ((tasksResult.data ?? []) as WorkspaceTaskRow[]).map(rowToTask),
          ((collaboratorsResult.data ?? []) as TaskCollaboratorRow[]).map(
            rowToTaskCollaborator,
          ),
        )
      }
      taskIdsRef.current = new Set(ids)
      confirm({ tasks: taskList, developments: rows.map(rowToTaskDevelopment) })
      succeeded()
      setError(null)
    }

    // Several changes usually arrive together (a merge touches the task, its
    // collaborators and its development row): read once after they settle.
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void fetchAll(), 250)
    }
    refetchRef.current = schedule

    // Only changes to tasks this list holds matter here. `key` is the column
    // naming the task: its own id, or a collaborator row's task_id.
    const ifTracked =
      (key: 'id' | 'task_id') =>
      (payload: {
        new?: Record<string, unknown>
        old?: Record<string, unknown>
      }) => {
        const id = (payload.new?.[key] ?? payload.old?.[key]) as
          string | undefined
        if (!id || taskIdsRef.current.has(id)) schedule()
      }

    void fetchAll()
    const filter = `workspace_id=eq.${workspaceId}`
    const channel = supabase
      .channel(`development-${workspaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_development', filter },
        schedule,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workspace_tasks', filter },
        ifTracked('id'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_collaborators', filter },
        ifTracked('task_id'),
      )
      .subscribe()
    const stopResync = onResync(schedule)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      stopResync()
      supabase.removeChannel(channel)
    }
  }, [active, workspaceId, confirm, succeeded, failed])

  const setTasksUpdater = useCallback(
    (updater: (current: WorkspaceTask[]) => WorkspaceTask[]) =>
      setData(current => ({ ...current, tasks: updater(current.tasks) })),
    [setData],
  )

  const actions = useWorkspaceTaskActions({
    workspaceId,
    userId,
    members,
    tasks,
    setTasks: setTasksUpdater,
    setError,
    now,
  })

  const createDevelopmentTask = async (
    input: DevelopmentTaskInput,
  ): Promise<Result & { taskId?: string; branchName?: string }> => {
    const supabase = createClient()
    const { data, error: rpcError } = await supabase.rpc(
      'create_development_task',
      {
        p_id: crypto.randomUUID(),
        p_workspace_id: workspaceId,
        p_title: input.title,
        p_description: input.description,
        p_goal_id: input.goalId,
        p_assignee_id: input.assigneeId,
        p_priority: input.priority,
        p_work_type: input.workType,
        p_branch_name: input.branchName,
      },
    )
    if (rpcError) return failure(rpcError, "Couldn't create the task.")
    refetchRef.current()
    return {
      success: true,
      taskId: (data as TaskDevelopmentRow | null)?.task_id,
      // The final name: numbered by the server if another task had it.
      branchName: (data as TaskDevelopmentRow | null)?.branch_name,
    }
  }

  const updateBranchName = async (
    taskId: string,
    branchName: string,
  ): Promise<Result> => {
    const { data, error: rpcError } = await createClient().rpc(
      'update_development_branch_name',
      { p_task_id: taskId, p_branch_name: branchName },
    )
    if (rpcError) return failure(rpcError, "Couldn't change the branch name.")
    const row = data as TaskDevelopmentRow | null
    if (row) {
      const updated = rowToTaskDevelopment(row)
      setData(current => ({
        ...current,
        developments: current.developments.map(item =>
          item.taskId === taskId ? updated : item,
        ),
      }))
    }
    return { success: true }
  }

  // Ask the server to check GitHub for this task (throttled there). Failure is
  // quiet: webhooks remain the primary path, this is only the safety net.
  const reconcile = useCallback(async (taskId: string) => {
    const last = reconciledAt.get(taskId)
    if (last !== undefined && Date.now() - last < RECONCILE_FRESH_MS) {
      return 'fresh'
    }
    reconciledAt.set(taskId, Date.now())
    try {
      const response = await fetch('/api/integrations/github/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      const body = (await response.json().catch(() => null)) as {
        status?: string
      } | null
      if (body?.status === 'ok') refetchRef.current()
      return body?.status ?? (response.ok ? 'ok' : 'unavailable')
    } catch {
      return 'unavailable'
    }
  }, [])

  const items = useMemo(
    () =>
      tasks
        .map(task => {
          const development = developments.get(task.id)
          return development ? { task, development } : null
        })
        .filter(
          (
            item,
          ): item is { task: WorkspaceTask; development: TaskDevelopment } =>
            item !== null,
        ),
    [tasks, developments],
  )

  return {
    items,
    ready: fetchStatus.ready || !active,
    error: active ? error || fetchStatus.error || null : null,
    clearError: () => setError(null),
    createDevelopmentTask,
    updateBranchName,
    reconcile,
    reassignTask: actions.reassignTask,
    updateTask: actions.updateTask,
    deleteTask: actions.deleteTask,
  }
}
