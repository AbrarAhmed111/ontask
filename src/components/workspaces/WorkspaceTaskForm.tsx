'use client'

import { FormEvent } from 'react'
import { TaskFormValues } from '@/types'
import { Idea, WorkspaceMember } from '@/types/workspace'
import { TaskForm } from '@/components/tasks/TaskForm'

// The workspace flavour of TaskForm: workspace wording, plus the "Assign to"
// picker — except in a personal workspace, where there's nobody else to
// assign to. Whether that's the case is passed in, not looked up.
export function WorkspaceTaskForm({
  values,
  setValues,
  isPersonal,
  members,
  assignedTo,
  setAssignedTo,
  submitLabel,
  onSubmit,
  onCancel,
  ideas,
  showReferenceIdea = true,
}: {
  values: TaskFormValues
  setValues: (values: TaskFormValues) => void
  isPersonal: boolean
  members: WorkspaceMember[]
  assignedTo: string[]
  setAssignedTo: (userIds: string[]) => void
  submitLabel: string
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
  ideas?: Idea[]
  showReferenceIdea?: boolean
}) {
  return (
    <TaskForm
      values={values}
      setValues={setValues}
      submitLabel={submitLabel}
      onSubmit={onSubmit}
      onCancel={onCancel}
      targetLabel="Planned time"
      namePlaceholder="e.g. Design the homepage"
      ideas={showReferenceIdea ? ideas : undefined}
      assignment={
        isPersonal
          ? undefined
          : {
              members,
              assignedTo,
              onChange: userIds =>
                setAssignedTo(Array.isArray(userIds) ? userIds : [userIds]),
              multiple: true,
            }
      }
    />
  )
}
