'use client'

import { ReactNode, useEffect, useState } from 'react'
import { Target, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Modal } from '@/components/ui/Modal'
import { AssigneePicker } from '@/components/workspaces/AssigneePicker'
import { SelectMenu } from '@/components/ui/SelectMenu'
import {
  StageBadge,
  WorkTypeBadge,
} from '@/components/development/DevelopmentBadges'
import { PRIORITY_OPTIONS } from '@/components/development/DevelopmentTaskForm'
import { CodeTrackingPanel } from '@/components/development/CodeTrackingPanel'
import { generateBranchName } from '@/lib/development/branchName'
import { developmentStage } from '@/lib/development/tracking'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type {
  Goal,
  GithubConnection,
  TaskDevelopment,
  TaskPriority,
  WorkspaceMember,
  WorkspaceTask,
} from '@/types/workspace'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <div className="mt-1 text-xs font-semibold text-ink">{children}</div>
    </div>
  )
}

// One Development Task, built around getting it done: what it is, whose it
// is, where it stands, and -- below the rule -- where its code is.
export function DevelopmentTaskDetail({
  task,
  development,
  goal,
  members,
  connection,
  onReassign,
  onPriorityChange,
  onUpdateBranchName,
  onReconcile,
  onDelete,
  onClose,
}: {
  task: WorkspaceTask
  development: TaskDevelopment
  goal: Goal | null
  members: WorkspaceMember[]
  connection: GithubConnection | null
  onReassign: (userId: string | null) => void
  onPriorityChange: (priority: TaskPriority | null) => void
  onUpdateBranchName: (
    name: string,
  ) => Promise<{ success: boolean; error?: string }>
  onReconcile: (taskId: string) => Promise<string>
  onDelete: () => void
  onClose: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const assignee = members.find(member => member.userId === task.assignedTo)
  const stage = developmentStage(task, development)

  // Opening the task is when a missed GitHub update is worth catching up on
  // (at most once a minute per task). Quietly: what is shown is the cached
  // branch and pull request, and anything new arrives as a normal update.
  const taskId = task.id
  useEffect(() => {
    void onReconcile(taskId)
  }, [taskId, onReconcile])

  const applyBranchName = async (name: string) => {
    const result = await onUpdateBranchName(name)
    if (result.success) showSuccessToast('Branch name updated.')
    else showErrorToast(result.error ?? "Couldn't change the branch name.")
  }

  return (
    <>
      <Modal eyebrow="Development Task" title={task.name} onClose={onClose}>
        <div className="space-y-5">
          {task.description && (
            <p className="whitespace-pre-line text-xs leading-5 text-muted">
              {task.description}
            </p>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Type">
              <WorkTypeBadge type={development.workType} />
            </Field>
            <Field label="Goal">
              {goal ? (
                <span className="inline-flex max-w-full items-center gap-1.5">
                  <Target
                    size={12}
                    className="shrink-0 text-[var(--ws-accent,#375b4b)]"
                  />
                  <span className="truncate">{goal.name}</span>
                </span>
              ) : (
                <span className="font-normal text-muted">No goal</span>
              )}
            </Field>
            <Field label="Status">
              <StageBadge stage={stage} />
            </Field>
            <Field label="Assignee">
              <AssigneePicker
                assignee={assignee}
                members={members}
                onReassign={onReassign}
              />
            </Field>
            <Field label="Priority">
              <SelectMenu
                label="Priority"
                size="sm"
                value={task.priority ?? ''}
                options={PRIORITY_OPTIONS}
                onChange={value => onPriorityChange(value || null)}
                className="max-w-[180px]"
              />
            </Field>
          </div>

          <div className="border-t border-line pt-4">
            <CodeTrackingPanel
              task={task}
              development={development}
              connection={connection}
              suggestedBranchName={generateBranchName(
                task.name,
                assignee ?? null,
                development.workType,
              )}
              onUseBranchName={name => void applyBranchName(name)}
            />
          </div>

          <div className="flex justify-end border-t border-line pt-4">
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} /> Delete Code Task
            </Button>
          </div>
        </div>
      </Modal>

      {confirmDelete && (
        <ConfirmModal
          title="Delete this Code Task?"
          message="This permanently deletes the task and its code tracking record. GitHub branches and Pull Requests are not changed."
          confirmLabel="Delete Code Task"
          onConfirm={() => {
            onDelete()
            setConfirmDelete(false)
            onClose()
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
