import { Fragment, ReactNode } from 'react'
import type { TaskDragProps } from '@/components/tasks/TaskCardShell'
import type { TaskMoveOption } from '@/components/tasks/TaskMoveSelect'

type TaskTreeNode = { id: string; name: string; parentTaskId: string | null }

// Lays a task list out as a flat run of cards, or as parent cards holding
// subtasks when some tasks carry a `parentTaskId`, and owns drag-to-reorder
// between the root-level cards. It knows nothing about how a card looks or
// which data model the tasks come from — the guest list and the workspace
// list each pass their own renderers — so the layout and reorder behavior
// exists once.
//
// Whether hierarchy shows up is decided by the data, not by this component:
// workspace tasks only ever have a parent inside a Goal (see
// supabase/migrations/0021_workspace_goals.sql), so the workspace overview's
// list is always flat.
export function TaskTree<T extends TaskTreeNode>({
  tasks,
  onReorder,
  renderTask,
  renderParent,
}: {
  tasks: T[]
  onReorder: (fromIndex: number, toIndex: number) => void
  renderTask: (
    task: T,
    context: {
      index: number
      moveOptions: TaskMoveOption[]
      drag: TaskDragProps
    },
  ) => ReactNode
  renderParent: (
    parent: T,
    subtasks: T[],
    moveOptions: TaskMoveOption[],
    context: { index: number; drag: TaskDragProps },
  ) => ReactNode
}) {
  const rootTasks = tasks.filter(task => !task.parentTaskId)
  const moveOptionsFor = (task: T): TaskMoveOption[] =>
    rootTasks
      .filter(root => root.id !== task.id)
      .map(root => ({ id: root.id, name: root.name }))

  return (
    <div className="space-y-3">
      {rootTasks.map((task, index) => {
        const subtasks = tasks.filter(t => t.parentTaskId === task.id)
        const moveOptions = moveOptionsFor(task)
        return (
          <Fragment key={task.id}>
            {subtasks.length > 0
              ? renderParent(task, subtasks, moveOptions, {
                  index,
                  drag: {
                    onDragStart: event => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData(
                        'text/task-index',
                        String(index),
                      )
                    },
                    onDragOver: event => event.preventDefault(),
                    onDrop: event => {
                      event.preventDefault()
                      const fromIndex = Number(
                        event.dataTransfer.getData('text/task-index'),
                      )
                      onReorder(fromIndex, index)
                    },
                  },
                })
              : renderTask(task, {
                  index,
                  moveOptions,
                  drag: {
                    onDragStart: event => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData(
                        'text/task-index',
                        String(index),
                      )
                    },
                    onDragOver: event => event.preventDefault(),
                    onDrop: event => {
                      event.preventDefault()
                      const fromIndex = Number(
                        event.dataTransfer.getData('text/task-index'),
                      )
                      onReorder(fromIndex, index)
                    },
                  },
                })}
          </Fragment>
        )
      })}
    </div>
  )
}
