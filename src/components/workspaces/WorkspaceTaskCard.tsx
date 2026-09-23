'use client'

import { useEffect, useState } from 'react'
import {
  CirclePlus,
  Link2,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react'
import { WorkspaceMember, WorkspaceTask } from '@/types/workspace'
import { formatTime } from '@/lib/time'
import {
  canControlTimer,
  canEmergencyStop,
  canReopenTask,
  timerLockReason,
} from '@/lib/tasks/timerPermissions'
import {
  canBlockTask,
  canEditBlocker,
  canResolveBlocker,
} from '@/lib/tasks/blockerPermissions'
import { tourAnchor } from '@/lib/tourAnchors'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { AssigneePicker } from '@/components/workspaces/AssigneePicker'
import { useTaskFocus } from '@/components/workspaces/FocusedTaskContext'
import { useOptionalWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import { useTaskBlocker } from '@/components/workspaces/WorkspaceBlockersContext'
import { BlockerButton } from '@/components/blockers/BlockerButton'
import { BlockerDisplay } from '@/components/blockers/BlockerDisplay'
import {
  BlockerDialogKind,
  BlockerDialogs,
} from '@/components/blockers/BlockerDialogs'
import { useTaskBlockerActionsContext } from '@/components/blockers/TaskBlockerActionsContext'
import {
  TASK_CHIP_CLASS,
  TaskCardShell,
  TaskDragProps,
} from '@/components/tasks/TaskCardShell'
import {
  TaskMoveOption,
  TaskMoveSelect,
} from '@/components/tasks/TaskMoveSelect'
import { TaskNotesPanel } from '@/components/tasks/TaskNotesPanel'
import { useTaskNoteCount } from '@/components/workspaces/TaskNoteCountsContext'
import type { AuthUser } from '@/hooks/useAuth'

function formatCollaboratorFocusTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

// A workspace task (shared or personal, flat or inside a Goal). The card frame
// is shared with the guest's local tasks (TaskCardShell); what's specific to a
// workspace task lives here: assignment, shared notes, dependencies, blockers,
// and the timer permission rules.
export function WorkspaceTaskCard({
  task,
  index,
  workedSeconds,
  members,
  user,
  onStart,
  onPause,
  onEmergencyStop,
  onFinish,
  onReopen,
  onEdit,
  onDelete,
  onAddSubtask,
  onReassign,
  moveOptions,
  onMoveTo,
  drag,
  blockedBy,
  onManageDependencies,
}: {
  task: WorkspaceTask
  index?: number
  workedSeconds: number
  members: WorkspaceMember[]
  user: AuthUser | null
  onStart: () => void
  onPause: () => void
  // Owner-only: stops someone else's running timer (never starts one).
  onEmergencyStop?: () => void
  onFinish: () => void
  onReopen?: () => void
  onEdit: () => void
  onDelete: () => void
  onAddSubtask?: () => void
  onReassign: (userId: string | null | string[]) => void
  moveOptions?: TaskMoveOption[]
  onMoveTo?: (parentId: string | null) => void
  drag?: TaskDragProps
  // Only meaningful for a goal task (see GoalCard/DependencyPicker)
  // — flat tasks never have dependencies, so both stay undefined there.
  blockedBy?: string[]
  onManageDependencies?: () => void
}) {
  const [notesOpen, setNotesOpen] = useState(false)
  const [blockerDialog, setBlockerDialog] = useState<BlockerDialogKind | null>(
    null,
  )
  const noteCount = useTaskNoteCount(task.id)
  const completed = task.status === 'completed' || task.status === 'skipped'
  // Two different things read as "blocked" and stay separate: waiting on an
  // incomplete Goal dependency (derived, `blockedBy`) and having a blocker
  // raised on the task (a stored status, with a reason and people who can
  // clear it).
  const dependencyBlocked =
    Boolean(blockedBy && blockedBy.length > 0) && !completed
  const hasBlocker = task.status === 'blocked'
  const blocked = dependencyBlocked || hasBlocker
  const running = task.status === 'working'
  const statusLabel = blocked
    ? 'Blocked'
    : running
      ? 'In focus'
      : completed
        ? task.status === 'skipped'
          ? 'Skipped'
          : 'Complete'
        : task.status === 'paused'
          ? 'Paused'
          : 'Queued'
  const assignee = members.find(member => member.userId === task.assignedTo)
  const collaborators = (task.collaborators ?? []).filter(
    collaborator => collaborator.removedAt === null,
  )
  const assignees =
    collaborators.length > 0
      ? collaborators
          .map(collaborator =>
            members.find(member => member.userId === collaborator.userId),
          )
          .filter((member): member is WorkspaceMember => Boolean(member))
      : assignee
        ? [assignee]
        : []
  const isCollaborative = collaborators.length > 1
  const liveCollaboratorSeconds = (
    collaborator: (typeof collaborators)[number],
  ) =>
    Math.round(
      collaborator.focusedSeconds +
        (collaborator.participationStatus === 'working' &&
        collaborator.startedAt
          ? Math.max(0, Date.now() - collaborator.startedAt) / 1000
          : 0),
    )
  const collaborativeLiveSeconds = collaborators.reduce(
    (sum, collaborator) =>
      sum +
      (collaborator.participationStatus === 'working' && collaborator.startedAt
        ? Math.max(0, Date.now() - collaborator.startedAt) / 1000
        : 0),
    0,
  )
  const totalFocusedSeconds =
    isCollaborative && task.totalFocusSeconds !== undefined
      ? Math.round(task.totalFocusSeconds + collaborativeLiveSeconds)
      : workedSeconds
  const memberName = (userId: string) => {
    const member = members.find(item => item.userId === userId)
    return member?.fullName || member?.email || 'Member'
  }
  const statusText = (status: WorkspaceTask['status']) =>
    status === 'completed'
      ? 'Completed'
      : status === 'working'
        ? 'Working'
        : status === 'paused'
          ? 'Paused'
          : status === 'blocked'
            ? 'Blocked'
            : status === 'skipped'
              ? 'Skipped'
              : 'Queued'
  // Timer permissions are a workspace-level fact (who's the owner, is this the
  // personal workspace), so they're read from the surrounding workspace rather
  // than threaded through every list and card between here and the page.
  const workspaceDetail = useOptionalWorkspaceDetail()
  // Nobody else to hand a task to in a personal workspace.
  const isPersonal = workspaceDetail?.isPersonal ?? false
  // Only the task's current assignee drives its timer; the owner gets a
  // separate, stop-only override for someone else's running one. The server
  // enforces the same rules — this just hides what it would reject.
  const timerActor = {
    userId: user?.id,
    isPersonal,
    isOwner: workspaceDetail?.isOwner ?? false,
  }
  const canTimer = canControlTimer(task, timerActor)
  const canReopen = canReopenTask(task, timerActor)
  const canStop = canEmergencyStop(task, timerActor)

  // Blockers: everyone sees the active one; who may raise, edit or resolve it
  // follows lib/tasks/blockerPermissions.ts (the server enforces the same).
  const blocker = useTaskBlocker(task.id)
  const blockerActions = useTaskBlockerActionsContext()
  const blockerActor = { userId: user?.id, isPersonal }
  const canBlock = Boolean(blockerActions) && canBlockTask(task, blockerActor)
  const canEditThis =
    Boolean(blockerActions) &&
    blocker !== undefined &&
    canEditBlocker(task, blocker, blockerActor)
  const canResolveThis =
    Boolean(blockerActions) &&
    blocker !== undefined &&
    canResolveBlocker(
      task,
      blocker,
      blockerActor,
      members.map(member => member.userId),
    )

  // Brought into view (and briefly ringed) when a notification links here.
  const focus = useTaskFocus(task.id)
  const [highlighted, setHighlighted] = useState(false)
  useEffect(() => {
    if (!focus) return
    document
      .getElementById(`task-${task.id}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setHighlighted(true)
    const timer = setTimeout(() => setHighlighted(false), 3000)
    return () => clearTimeout(timer)
  }, [focus, task.id])

  return (
    <TaskCardShell
      id={`task-${task.id}`}
      className={highlighted ? 'ring-2 ring-[var(--ws-accent,#375b4b)]' : ''}
      title={task.name}
      description={task.description}
      index={index}
      tone={running ? 'running' : completed ? 'done' : 'idle'}
      blocked={blocked}
      statusLabel={statusLabel}
      focusLabel={isCollaborative ? 'All Focus Time' : 'Focused time'}
      workedSeconds={totalFocusedSeconds}
      plannedMinutes={task.plannedMinutes}
      progressLabel={task.progressLabel}
      progressPercentage={task.progressPercentage}
      drag={drag}
      onEdit={onEdit}
      onDelete={onDelete}
      leading={
        <>
          {!isPersonal && (
            <AssigneePicker
              assignee={assignee}
              assignees={assignees}
              members={members}
              onReassign={onReassign}
              onReassignMany={userIds => onReassign(userIds)}
              // A blocked task keeps an assignee: they can always clear the
              // blocker, so it never ends up with nobody able to.
              canUnassign={!hasBlocker}
            />
          )}
          {onMoveTo && (
            <TaskMoveSelect
              taskName={task.name}
              parentTaskId={task.parentTaskId}
              options={moveOptions}
              onMove={onMoveTo}
            />
          )}
        </>
      }
      actions={
        <>
          {onAddSubtask && (
            <button onClick={onAddSubtask} className={TASK_CHIP_CLASS}>
              <CirclePlus size={13} /> Subtask
            </button>
          )}
          {onManageDependencies && (
            <button onClick={onManageDependencies} className={TASK_CHIP_CLASS}>
              <Link2 size={13} />
              Dependencies
              {blockedBy && blockedBy.length > 0
                ? ` (${blockedBy.length})`
                : ''}
            </button>
          )}
          {canBlock && (
            <BlockerButton
              taskName={task.name}
              onClick={() => setBlockerDialog('block')}
            />
          )}
          <button
            {...tourAnchor('task-notes')}
            onClick={() => setNotesOpen(open => !open)}
            className={TASK_CHIP_CLASS}
          >
            <MessageSquare size={13} /> Notes
            {noteCount > 0 && (
              <span
                aria-label={`${noteCount} note${noteCount === 1 ? '' : 's'}`}
              >
                ({noteCount})
              </span>
            )}
          </button>
          {completed && canReopen && onReopen && (
            <Button variant="secondary" onClick={onReopen}>
              <RotateCcw size={15} /> Continue
            </Button>
          )}
          {!completed && canTimer && (
            <button
              onClick={onFinish}
              disabled={hasBlocker}
              title={
                hasBlocker
                  ? 'Resolve the blocker before finishing this task'
                  : undefined
              }
              className={`${TASK_CHIP_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              Finish
            </button>
          )}
          {!completed && canTimer && (
            <Button
              variant={running ? 'danger' : 'primary'}
              onClick={running ? onPause : onStart}
              disabled={blocked}
              title={
                hasBlocker
                  ? 'Blocked — resolve the blocker to continue'
                  : dependencyBlocked
                    ? 'Blocked by an incomplete dependency'
                    : undefined
              }
            >
              {running ? (
                <>
                  <Pause size={15} /> Pause
                </>
              ) : (
                <>
                  <Play size={15} />{' '}
                  {task.status === 'paused' ? 'Resume' : 'Start'}
                </>
              )}
            </Button>
          )}
          {!completed && !canTimer && !running && (
            <Button
              disabled
              title={timerLockReason(task, timerActor) ?? undefined}
            >
              <Play size={15} /> {task.status === 'paused' ? 'Resume' : 'Start'}
            </Button>
          )}
          {canStop && onEmergencyStop && (
            <Button
              variant="danger"
              onClick={onEmergencyStop}
              title="Stop this timer. The time already recorded is kept and the task stays assigned."
            >
              <Square size={14} /> Emergency stop
            </Button>
          )}
        </>
      }
    >
      {isCollaborative && (
        <div className="flex flex-wrap items-center gap-1.5">
          {collaborators.map(collaborator => {
            const member = members.find(m => m.userId === collaborator.userId)
            return (
              <span
                key={collaborator.id}
                title={`${memberName(collaborator.userId)}: ${statusText(collaborator.participationStatus)}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-white/70 py-1 pl-1 pr-2 text-[10px] font-semibold text-ink"
              >
                <Avatar
                  person={member ?? { fullName: 'Member' }}
                  className="h-5 w-5 shrink-0 text-[8px]"
                />
                <span className="max-w-16 truncate">
                  {memberName(collaborator.userId).split(' ')[0]}
                </span>
                <span className="shrink-0 text-muted">
                  {statusText(collaborator.participationStatus)}
                </span>
                <span className="shrink-0 whitespace-nowrap font-mono tabular-nums text-muted">
                  {formatCollaboratorFocusTime(
                    liveCollaboratorSeconds(collaborator),
                  )}
                </span>
              </span>
            )
          })}
        </div>
      )}

      {dependencyBlocked && (
        <p className="rounded-lg border border-coral/20 bg-coral/5 px-3 py-2 text-[11px] font-semibold text-coral">
          Blocked by: {blockedBy!.join(', ')}
        </p>
      )}

      {blocker && (
        <BlockerDisplay
          task={task}
          blocker={blocker}
          members={members}
          canResolve={canResolveThis}
          canEdit={canEditThis}
          onResolve={() => setBlockerDialog('resolve')}
          onEdit={() => setBlockerDialog('edit')}
        />
      )}

      {notesOpen && (
        <TaskNotesPanel
          taskId={task.id}
          workspaceId={task.workspaceId}
          user={user}
          members={members}
        />
      )}

      <BlockerDialogs
        kind={blockerDialog}
        task={task}
        blocker={blocker}
        members={members}
        user={user}
        onClose={() => setBlockerDialog(null)}
      />
    </TaskCardShell>
  )
}
