'use client'

import { FormEvent, ReactNode, useMemo, useState } from 'react'
import { AlertTriangle, GitBranch, Target, UserRound } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { SelectMenu, SelectMenuOption } from '@/components/ui/SelectMenu'
import {
  PriorityFlag,
  WorkTypeIcon,
} from '@/components/development/DevelopmentBadges'
import {
  BranchCollision,
  BranchHolder,
  branchCollision,
  generateBranchName,
  isValidBranchName,
} from '@/lib/development/branchName'
import {
  PRIORITIES,
  PRIORITY_LABELS,
  WORK_TYPES,
} from '@/lib/development/tracking'
import type {
  DevelopmentWorkType,
  Goal,
  TaskPriority,
  WorkspaceMember,
} from '@/types/workspace'
import type { DevelopmentTaskInput } from '@/hooks/useDevelopmentTasks'

const FIELD_CLASS =
  'mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-sage focus:ring-4 focus:ring-sage/15'

// A labelled field whose control is not a native input (the SelectMenus), so
// the label is a plain caption rather than a <label> wrapping it.
function Field({
  label,
  optional,
  children,
}: {
  label: string
  optional?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-muted">
        {label}
        {optional && (
          <span className="font-normal text-muted/80"> (optional)</span>
        )}
      </p>
      {children}
    </div>
  )
}

export const WORK_TYPE_OPTIONS: SelectMenuOption<DevelopmentWorkType>[] =
  WORK_TYPES.map(type => ({
    value: type.value,
    label: type.label,
    description: `${type.description} · ${type.branchPrefix}`,
    icon: <WorkTypeIcon type={type.value} />,
  }))

// '' stands for "no priority" -- a SelectMenu value is always a string.
export const PRIORITY_OPTIONS: SelectMenuOption<TaskPriority | ''>[] = [
  { value: '', label: 'No priority', icon: <PriorityFlag priority={null} /> },
  ...PRIORITIES.map(priority => ({
    value: priority,
    label: PRIORITY_LABELS[priority],
    icon: <PriorityFlag priority={priority} />,
  })),
]

// Said as soon as the branch a new task would get is already linked to
// another Development Task: which task, and what happens instead. One branch
// is never linked to two tasks -- the new one gets a numbered name or, when
// the other task is finished, may take the name over on purpose.
export function BranchCollisionNotice({
  collision,
  takeOver,
  onTakeOverChange,
}: {
  collision: BranchCollision
  takeOver: boolean
  onTakeOverChange: (takeOver: boolean) => void
}) {
  const { holder, numberedName, canTakeOver } = collision
  return (
    <span
      role="status"
      className="mt-1.5 block rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-normal leading-5 text-amber-900"
    >
      <span className="flex items-start gap-1.5 font-semibold">
        <AlertTriangle size={12} className="mt-1 shrink-0" aria-hidden />
        <span>
          This branch is already linked to another Development Task: “
          {holder.title}”{holder.finished ? ' (finished)' : ''}.
        </span>
      </span>
      <span className="mt-0.5 block pl-[18px]">
        {takeOver ? (
          <>
            This task will use{' '}
            <code className="font-mono font-semibold">{holder.branchName}</code>
            . “{holder.title}” keeps its history but stops following the branch.
          </>
        ) : (
          <>
            This task will use{' '}
            <code className="font-mono font-semibold">{numberedName}</code>{' '}
            instead.
          </>
        )}
      </span>
      {canTakeOver && (
        <label className="mt-1 flex items-center gap-1.5 pl-[18px] font-semibold">
          <input
            type="checkbox"
            checked={takeOver}
            onChange={event => onTakeOverChange(event.target.checked)}
            className="accent-[var(--ws-accent,#375b4b)]"
          />
          Reuse <code className="font-mono">{holder.branchName}</code> for this
          task
        </label>
      )}
    </span>
  )
}

// Create a Development Task. It is always a new task. Its branch name follows
// the type (feature/, fix/, ...), the title and the assignee; if another task
// in the workspace already has that name, the form says which, and the new
// task is numbered -02, -03, ... (or, if that task is finished, may reuse the
// name). The server decides, and the dialog shows the final name (to copy)
// once the task exists.
export function DevelopmentTaskForm({
  members,
  goals,
  currentUserId,
  branchHolders,
  onCreate,
  onCancel,
}: {
  members: WorkspaceMember[]
  goals: Goal[]
  currentUserId: string
  // The Development Tasks in this workspace holding a branch name.
  branchHolders: BranchHolder[]
  onCreate: (
    input: DevelopmentTaskInput,
  ) => Promise<{ success: boolean; error?: string }>
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [workType, setWorkType] = useState<DevelopmentWorkType>('feature')
  const [description, setDescription] = useState('')
  const [goalId, setGoalId] = useState('')
  const [assigneeId, setAssigneeId] = useState(currentUserId)
  const [priority, setPriority] = useState<TaskPriority | ''>('medium')
  // The branch name the person chose to take over, if any. The choice is per
  // name: a different title or assignee has to be chosen again.
  const [takeOverFor, setTakeOverFor] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const goalOptions: SelectMenuOption<string>[] = useMemo(
    () => [
      {
        value: '',
        label: 'No goal',
        icon: <Target size={13} className="text-muted/50" />,
      },
      ...goals
        .filter(goal => goal.status === 'active')
        .map(goal => ({
          value: goal.id,
          label: goal.name,
          icon: (
            <Target size={13} className="text-[var(--ws-accent,#375b4b)]" />
          ),
        })),
    ],
    [goals],
  )

  const assigneeOptions: SelectMenuOption<string>[] = useMemo(
    () => [
      {
        value: '',
        label: 'Unassigned',
        icon: (
          <span className="grid h-5 w-5 place-items-center rounded-full border border-dashed border-line text-muted">
            <UserRound size={11} />
          </span>
        ),
      },
      ...members.map(member => ({
        value: member.userId,
        label: member.fullName || member.email || 'Member',
        description:
          member.userId === currentUserId ? 'You' : (member.email ?? undefined),
        icon: <Avatar person={member} className="h-5 w-5 text-[8px]" />,
      })),
    ],
    [members, currentUserId],
  )

  // What is sent (the server numbers it if taken), and what it will become.
  const branchName = useMemo(() => {
    if (!title.trim()) return ''
    const member = members.find(m => m.userId === assigneeId) ?? null
    return generateBranchName(title, member, workType)
  }, [title, assigneeId, workType, members])
  const collision = branchName
    ? branchCollision(branchName, branchHolders)
    : null
  const takeOver = Boolean(collision?.canTakeOver) && takeOverFor === branchName
  const previewBranchName =
    collision && !takeOver ? collision.numberedName : branchName

  const canSubmit =
    !saving && title.trim() !== '' && isValidBranchName(branchName)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    const result = await onCreate({
      title: title.trim(),
      description: description.trim(),
      workType,
      goalId: goalId || null,
      assigneeId: assigneeId || null,
      priority: priority || null,
      branchName,
      takeOverBranch: takeOver,
    })
    setSaving(false)
    if (!result.success) setError(result.error ?? "Couldn't save.")
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <label className="block text-xs font-semibold text-muted">
        Title
        <input
          required
          autoFocus
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder={
            workType === 'bug' || workType === 'hotfix'
              ? 'e.g. Login button does nothing on Safari'
              : 'e.g. Implement Google OAuth'
          }
          maxLength={200}
          className={FIELD_CLASS}
        />
        {previewBranchName && (
          <span className="mt-1.5 flex items-center gap-1.5 text-[10px] font-normal text-muted">
            <GitBranch size={11} className="shrink-0" />
            <span className="min-w-0 truncate">
              Branch{' '}
              <code className="font-mono font-semibold text-ink">
                {previewBranchName}
              </code>
            </span>
          </span>
        )}
        {collision && (
          <BranchCollisionNotice
            collision={collision}
            takeOver={takeOver}
            onTakeOverChange={checked =>
              setTakeOverFor(checked ? branchName : null)
            }
          />
        )}
      </label>

      <Field label="Type">
        <SelectMenu
          label="Type"
          value={workType}
          options={WORK_TYPE_OPTIONS}
          onChange={setWorkType}
        />
      </Field>

      <label className="block text-xs font-semibold text-muted">
        Description
        <textarea
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder={
            workType === 'bug' || workType === 'hotfix'
              ? 'What happens, and what should happen instead? (optional)'
              : 'What should this change do? (optional)'
          }
          rows={3}
          className={`${FIELD_CLASS} resize-none`}
        />
      </label>

      <Field label="Goal" optional>
        <SelectMenu
          label="Goal"
          value={goalId}
          options={goalOptions}
          onChange={setGoalId}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assignee">
          <SelectMenu
            label="Assignee"
            value={assigneeId}
            options={assigneeOptions}
            onChange={setAssigneeId}
          />
        </Field>
        <Field label="Priority">
          <SelectMenu
            label="Priority"
            value={priority}
            options={PRIORITY_OPTIONS}
            onChange={setPriority}
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {saving ? 'Creating…' : 'Create Development Task'}
        </Button>
      </div>
    </form>
  )
}
