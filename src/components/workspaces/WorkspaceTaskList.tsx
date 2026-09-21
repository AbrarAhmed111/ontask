import { WorkspaceMember, WorkspaceTask } from '@/types/workspace'
import { WorkspaceTaskCard } from '@/components/workspaces/WorkspaceTaskCard'
import { WorkspaceParentTaskCard } from '@/components/workspaces/WorkspaceParentTaskCard'
import { TaskTree } from '@/components/tasks/TaskTree'
import type { AuthUser } from '@/hooks/useAuth'

// Renders a flat task list, or a Task -> Subtask tree when some tasks carry
// a parentTaskId (only possible inside a Goal — see
// supabase/migrations/0021_workspace_goals.sql). Reused as-is for both the
// permanently-flat workspace overview list and a single Goal's task tree;
// which one it's rendering falls out of whether any task in `tasks` has a
// parentTaskId, and whether the hierarchy-management callbacks are passed.
// Layout and drag-reorder are shared with the guest's list (TaskTree).
export function WorkspaceTaskList({
  tasks,
  members,
  user,
  getWorkedSeconds,
  onStart,
  onPause,
  onEmergencyStop,
  onFinish,
  onReopen,
  onEdit,
  onDelete,
  onReassign,
  onReorder,
  onAddSubtask,
  onDeleteParent,
  onMoveTo,
  getBlockedBy,
  onManageDependencies,
}: {
  tasks: WorkspaceTask[]
  members: WorkspaceMember[]
  user: AuthUser | null
  getWorkedSeconds: (task: WorkspaceTask) => number
  onStart: (id: string) => void
  onPause: (task: WorkspaceTask) => void
  onEmergencyStop?: (task: WorkspaceTask) => void
  onFinish: (task: WorkspaceTask) => void
  onReopen?: (task: WorkspaceTask) => void
  onEdit: (task: WorkspaceTask) => void
  onDelete: (id: string) => void
  onReassign: (id: string, userId: string | string[] | null) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onAddSubtask?: (parentId: string) => void
  onDeleteParent?: (task: WorkspaceTask) => void
  onMoveTo?: (taskId: string, parentId: string | null) => void
  // Goal-scoped only (see GoalCard) — a flat list never passes these.
  getBlockedBy?: (task: WorkspaceTask) => string[]
  onManageDependencies?: (task: WorkspaceTask) => void
}) {
  return (
    <TaskTree
      tasks={tasks}
      onReorder={onReorder}
      renderParent={(parent, subtasks, moveOptions) => (
        <WorkspaceParentTaskCard
          parent={parent}
          subtasks={subtasks}
          members={members}
          user={user}
          getWorkedSeconds={getWorkedSeconds}
          onStart={onStart}
          onPause={onPause}
          onEmergencyStop={onEmergencyStop}
          onFinish={onFinish}
          onReopen={onReopen}
          onEdit={onEdit}
          onDelete={onDelete}
          onReassign={onReassign}
          onAddSubtask={() => onAddSubtask?.(parent.id)}
          onDeleteParent={() => onDeleteParent?.(parent)}
          moveOptions={moveOptions}
          onMoveTo={(taskId, parentId) => onMoveTo?.(taskId, parentId)}
          getBlockedBy={getBlockedBy}
          onManageDependencies={onManageDependencies}
        />
      )}
      renderTask={(task, { index, moveOptions, drag }) => (
        <WorkspaceTaskCard
          task={task}
          index={index}
          workedSeconds={Math.round(getWorkedSeconds(task))}
          members={members}
          user={user}
          onStart={() => onStart(task.id)}
          onPause={() => onPause(task)}
          onEmergencyStop={
            onEmergencyStop ? () => onEmergencyStop(task) : undefined
          }
          onFinish={() => onFinish(task)}
          onReopen={onReopen ? () => onReopen(task) : undefined}
          onEdit={() => onEdit(task)}
          onDelete={() => onDelete(task.id)}
          onReassign={userId => onReassign(task.id, userId)}
          onAddSubtask={onAddSubtask ? () => onAddSubtask(task.id) : undefined}
          moveOptions={onMoveTo ? moveOptions : undefined}
          onMoveTo={
            onMoveTo ? parentId => onMoveTo(task.id, parentId) : undefined
          }
          blockedBy={getBlockedBy?.(task)}
          onManageDependencies={
            onManageDependencies ? () => onManageDependencies(task) : undefined
          }
          drag={drag}
        />
      )}
    />
  )
}
