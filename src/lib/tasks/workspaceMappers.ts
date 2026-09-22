import {
  TaskCollaborator,
  WorkspaceTask,
  WorkspaceTaskStatus,
} from '@/types/workspace'

export type WorkspaceTaskRow = {
  id: string
  workspace_id: string
  parent_task_id: string | null
  goal_id: string | null
  idea_id?: string | null
  created_by: string
  assigned_to: string | null
  title: string
  description?: string | null
  planned_seconds: number | null
  actual_seconds: number
  status: WorkspaceTaskStatus
  progress_label: string | null
  progress_percentage: number | null
  started_at: string | null
  completed_at: string | null
  completed_cleared_at?: string | null
}

export type TaskCollaboratorRow = {
  id: string
  task_id: string
  workspace_id: string
  user_id: string
  participation_status: WorkspaceTaskStatus
  started_at: string | null
  completed_at: string | null
  removed_at: string | null
}

export type TaskFocusTotalRow = {
  task_id: string
  user_id: string
  focused_seconds: number
}

export function rowToTaskCollaborator(
  row: TaskCollaboratorRow,
): TaskCollaborator {
  return {
    id: row.id,
    taskId: row.task_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    participationStatus: row.participation_status,
    focusedSeconds: 0,
    startedAt: row.started_at ? new Date(row.started_at).getTime() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
    removedAt: row.removed_at ? new Date(row.removed_at).getTime() : null,
  }
}

export function attachTaskCollaborators(
  tasks: WorkspaceTask[],
  collaborators: TaskCollaborator[],
): WorkspaceTask[] {
  const byTask = new Map<string, TaskCollaborator[]>()
  for (const collaborator of collaborators) {
    if (collaborator.removedAt !== null) continue
    const list = byTask.get(collaborator.taskId) ?? []
    list.push(collaborator)
    byTask.set(collaborator.taskId, list)
  }
  return tasks.map(task => ({
    ...task,
    collaborators: byTask.get(task.id) ?? [],
  }))
}

export function attachTaskFocusTotals(
  tasks: WorkspaceTask[],
  rows: TaskFocusTotalRow[],
): WorkspaceTask[] {
  const byTask = new Map<string, number>()
  const byTaskUser = new Map<string, number>()

  for (const row of rows) {
    const seconds = Number(row.focused_seconds) || 0
    byTask.set(row.task_id, (byTask.get(row.task_id) ?? 0) + seconds)
    byTaskUser.set(`${row.task_id}:${row.user_id}`, seconds)
  }

  return tasks.map(task => ({
    ...task,
    totalFocusSeconds: byTask.get(task.id) ?? task.workedSeconds,
    collaborators: (task.collaborators ?? []).map(collaborator => ({
      ...collaborator,
      focusedSeconds:
        byTaskUser.get(`${collaborator.taskId}:${collaborator.userId}`) ?? 0,
    })),
  }))
}

export function rowToTask(row: WorkspaceTaskRow): WorkspaceTask {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    parentTaskId: row.parent_task_id,
    goalId: row.goal_id,
    ideaId: row.idea_id ?? null,
    createdBy: row.created_by,
    assignedTo: row.assigned_to,
    name: row.title,
    description: row.description ?? null,
    plannedMinutes:
      row.planned_seconds !== null && row.planned_seconds !== undefined
        ? Math.round(row.planned_seconds / 60)
        : null,
    workedSeconds: row.actual_seconds,
    status: row.status,
    completedClearedAt: row.completed_cleared_at
      ? new Date(row.completed_cleared_at).getTime()
      : null,
    progressLabel: row.progress_label ?? undefined,
    progressPercentage: row.progress_percentage ?? undefined,
    startedAt: row.started_at ? new Date(row.started_at).getTime() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
  }
}

// Same live-elapsed-time pattern as useTimer's getLiveSeconds, just against
// WorkspaceTaskStatus's 'working' instead of personal Task's 'active'.
export function getWorkspaceLiveSeconds(task: WorkspaceTask, now: number) {
  return (
    task.workedSeconds +
    (task.status === 'working' && task.startedAt
      ? Math.max(0, now - task.startedAt) / 1000
      : 0)
  )
}
