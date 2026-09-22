import { describe, expect, it } from 'vitest'
import {
  attachTaskCollaborators,
  attachTaskFocusTotals,
  rowToTask,
  rowToTaskCollaborator,
  type TaskCollaboratorRow,
  type WorkspaceTaskRow,
} from '@/lib/tasks/workspaceMappers'

const taskRow = (
  overrides: Partial<WorkspaceTaskRow> = {},
): WorkspaceTaskRow => ({
  id: 'task-1',
  workspace_id: 'ws-1',
  parent_task_id: null,
  goal_id: null,
  idea_id: null,
  created_by: 'u-owner',
  assigned_to: 'u-1',
  title: 'Collaborative task',
  description: null,
  planned_seconds: 3600,
  actual_seconds: 5400,
  status: 'paused',
  progress_label: null,
  progress_percentage: null,
  started_at: null,
  completed_at: null,
  ...overrides,
})

const collaboratorRow = (
  userId: string,
  overrides: Partial<TaskCollaboratorRow> = {},
): TaskCollaboratorRow => ({
  id: `collab-${userId}`,
  task_id: 'task-1',
  workspace_id: 'ws-1',
  user_id: userId,
  participation_status: 'paused',
  started_at: null,
  completed_at: null,
  removed_at: null,
  ...overrides,
})

describe('workspace task mappers', () => {
  it('attaches per-member and all-task focused seconds', () => {
    const [task] = attachTaskFocusTotals(
      attachTaskCollaborators(
        [rowToTask(taskRow())],
        [
          rowToTaskCollaborator(collaboratorRow('u-1')),
          rowToTaskCollaborator(collaboratorRow('u-2')),
        ],
      ),
      [
        { task_id: 'task-1', user_id: 'u-1', focused_seconds: 2400 },
        { task_id: 'task-1', user_id: 'u-2', focused_seconds: 3600 },
        { task_id: 'task-1', user_id: 'u-former', focused_seconds: 900 },
      ],
    )

    expect(task.totalFocusSeconds).toBe(6900)
    expect(task.collaborators?.map(c => [c.userId, c.focusedSeconds])).toEqual([
      ['u-1', 2400],
      ['u-2', 3600],
    ])
  })
})
