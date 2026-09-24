'use client'

import { useState } from 'react'
import { Link2, MessageSquare } from 'lucide-react'
import { WorkspaceMember, WorkspaceTask } from '@/types/workspace'
import { Avatar } from '@/components/ui/Avatar'
import { WorkspaceTaskCard } from '@/components/workspaces/WorkspaceTaskCard'
import { ParentTaskShell } from '@/components/tasks/ParentTaskShell'
import type { TaskDragProps } from '@/components/tasks/TaskCardShell'
import type { TaskMoveOption } from '@/components/tasks/TaskMoveSelect'
import { TaskNotesPanel } from '@/components/tasks/TaskNotesPanel'
import type { AuthUser } from '@/hooks/useAuth'
import { useTaskNoteCount } from '@/components/workspaces/TaskNoteCountsContext'

function AssigneeStack({ members }: { members: WorkspaceMember[] }) {
  const shown = members.slice(0, 3)
  const overflow = members.length - shown.length
  return (
    <div className="flex shrink-0 items-center">
      <div className="flex -space-x-1.5">
        {shown.map(member => (
          <Avatar
            key={member.userId}
            person={member}
            title={member.fullName || member.email || 'Member'}
            className="h-5 w-5 border-2 border-panel text-[8px]"
          />
        ))}
      </div>
      {overflow > 0 && (
        <span className="-ml-1.5 grid h-5 w-5 place-items-center rounded-full border-2 border-panel bg-slate-200 font-mono text-[8px] font-bold text-muted">
          +{overflow}
        </span>
      )}
    </div>
  )
}

// A workspace task that groups subtasks (only ever inside a Goal). The frame
// is shared with the guest's local parents (ParentTaskShell); assignees,
// dependencies and shared notes are the workspace-specific header extras.
export function WorkspaceParentTaskCard({
  parent,
  subtasks,
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
  onAddSubtask,
  onDeleteParent,
  moveOptions,
  onMoveTo,
  getBlockedBy,
  onManageDependencies,
  drag,
}: {
  parent: WorkspaceTask
  subtasks: WorkspaceTask[]
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
  onAddSubtask: () => void
  onDeleteParent: () => void
  moveOptions: TaskMoveOption[]
  onMoveTo: (taskId: string, parentId: string | null) => void
  getBlockedBy?: (task: WorkspaceTask) => string[]
  onManageDependencies?: (task: WorkspaceTask) => void
  drag?: TaskDragProps
}) {
  const [notesOpen, setNotesOpen] = useState(false)
  const noteCount = useTaskNoteCount(parent.id)
  const assignees = Array.from(
    new Map(
      subtasks
        .map(task => members.find(m => m.userId === task.assignedTo))
        .filter((m): m is WorkspaceMember => Boolean(m))
        .map(m => [m.userId, m] as const),
    ).values(),
  )
  const parentBlockedBy = getBlockedBy?.(parent) ?? []

  return (
    <ParentTaskShell
      title={parent.name}
      subtasks={subtasks}
      getWorkedSeconds={getWorkedSeconds}
      onAddSubtask={onAddSubtask}
      onDelete={onDeleteParent}
      drag={drag}
      extras={
        <>
          {assignees.length > 0 && <AssigneeStack members={assignees} />}
          {parentBlockedBy.length > 0 && (
            <span
              title={`Blocked by: ${parentBlockedBy.join(', ')}`}
              className="shrink-0 whitespace-nowrap rounded-full bg-coral/10 px-2.5 py-1 font-mono text-[9px] uppercase text-coral"
            >
              Blocked
            </span>
          )}
          {onManageDependencies && (
            <button
              onClick={() => onManageDependencies(parent)}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-semibold text-muted transition hover:text-[var(--ws-accent,#375b4b)]"
            >
              <Link2 size={12} /> Dependencies
            </button>
          )}
          <button
            onClick={() => setNotesOpen(open => !open)}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-semibold text-muted transition hover:text-[var(--ws-accent,#375b4b)]"
          >
            <MessageSquare size={12} /> Notes
            {noteCount > 0 && (
              <span
                aria-label={`${noteCount} note${noteCount === 1 ? '' : 's'}`}
              >
                ({noteCount})
              </span>
            )}
          </button>
        </>
      }
      panel={
        notesOpen ? (
          <TaskNotesPanel
            taskId={parent.id}
            workspaceId={parent.workspaceId}
            user={user}
            members={members}
          />
        ) : null
      }
    >
      {subtasks.map(task => (
        <WorkspaceTaskCard
          key={task.id}
          task={task}
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
          moveOptions={moveOptions}
          onMoveTo={parentId => onMoveTo(task.id, parentId)}
          blockedBy={getBlockedBy?.(task)}
          onManageDependencies={
            onManageDependencies ? () => onManageDependencies(task) : undefined
          }
        />
      ))}
    </ParentTaskShell>
  )
}
