import { WorkspaceTask, WorkspaceTaskStatus } from '@/types/workspace'

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
