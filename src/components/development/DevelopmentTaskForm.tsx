'use client'

import { FormEvent, ReactNode, useMemo, useState } from 'react'
import { GitBranch, Target, UserRound } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { SelectMenu, SelectMenuOption } from '@/components/ui/SelectMenu'
import {
  PriorityFlag,
  WorkTypeIcon,
} from '@/components/development/DevelopmentBadges'
import {
  generateBranchName,
  isValidBranchName,
  numberedBranchName,
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

// Create a Development Task. It is always a new task. Its branch name follows
// the type (feature/, fix/, ...), the title and the assignee; if another task
// in the workspace already has that name, it is numbered -02, -03, ... The
// form previews that under the title; the server decides, and the dialog shows
// the final name (to copy) once the task exists.
export function DevelopmentTaskForm({
  members,
  goals,
  currentUserId,
  takenBranchNames,
  onCreate,
  onCancel,
}: {
  members: WorkspaceMember[]
  goals: Goal[]
  currentUserId: string
  // Branch names other Development Tasks in this workspace already have.
  takenBranchNames: string[]
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
  const previewBranchName = branchName
    ? numberedBranchName(branchName, takenBranchNames)
    : ''

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
              {previewBranchName !== branchName &&
                ' — numbered, another task already uses this name'}
            </span>
          </span>
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
