import { describe, expect, it, vi } from 'vitest'
import type { DragEvent } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { TaskForm } from '@/components/tasks/TaskForm'
import { TaskCardShell } from '@/components/tasks/TaskCardShell'
import { ParentTaskShell } from '@/components/tasks/ParentTaskShell'
import { TaskTree } from '@/components/tasks/TaskTree'
import { AssigneePicker } from '@/components/workspaces/AssigneePicker'
import { WorkspaceTaskForm } from '@/components/workspaces/WorkspaceTaskForm'
import type { TaskFormValues } from '@/types'
import type { WorkspaceMember } from '@/types/workspace'

const values: TaskFormValues = {
  name: '',
  hours: '0',
  minutes: '0',
  goal: '',
  progress: '0',
  trackGoal: false,
}

const member: WorkspaceMember = {
  id: 'm1',
  workspaceId: 'w1',
  userId: 'u1',
  role: 'member',
  joinedAt: '2026-01-01',
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  avatarUrl: null,
}
const secondMember: WorkspaceMember = {
  ...member,
  id: 'm2',
  userId: 'u2',
  fullName: 'Grace Hopper',
  email: 'grace@example.com',
}
const thirdMember: WorkspaceMember = {
  ...member,
  id: 'm3',
  userId: 'u3',
  fullName: 'Katherine Johnson',
  email: 'katherine@example.com',
}

const noop = () => {}

describe('TaskForm', () => {
  const render = (props: Partial<Parameters<typeof TaskForm>[0]> = {}) =>
    renderToStaticMarkup(
      <TaskForm
        values={values}
        setValues={noop}
        submitLabel="Add task"
        onSubmit={noop}
        onCancel={noop}
        {...props}
      />,
    )

  it('has no assignee picker unless assignment is provided', () => {
    expect(render()).not.toContain('Assign to')
  })

  it('offers every member to assign to when assignment is provided', () => {
    const html = render({
      assignment: { members: [member], assignedTo: '', onChange: noop },
    })
    expect(html).toContain('Assign to')
    expect(html).toContain('Unassigned')
    expect(html).toContain('Ada Lovelace')
  })

  it("defaults to the guest's 'today' wording and accepts workspace wording", () => {
    expect(render()).toContain('Today&#x27;s target')
    const workspace = render({ targetLabel: 'Planned time' })
    expect(workspace).toContain('Planned time')
    expect(workspace).not.toContain('Today')
  })
})

describe('WorkspaceTaskForm', () => {
  const render = (isPersonal: boolean) =>
    renderToStaticMarkup(
      <WorkspaceTaskForm
        values={values}
        setValues={noop}
        isPersonal={isPersonal}
        members={[member]}
        assignedTo={[]}
        setAssignedTo={noop}
        submitLabel="Add task"
        onSubmit={noop}
        onCancel={noop}
      />,
    )

  it('never offers assignment in a personal workspace', () => {
    expect(render(true)).not.toContain('Assign to')
  })

  it('offers assignment in a shared workspace, with workspace wording', () => {
    const html = render(false)
    expect(html).toContain('Assign to')
    expect(html).toContain('Planned time')
  })
})

describe('AssigneePicker', () => {
  it('keeps a local multi-assignee draft while realtime catches up', () => {
    const onReassignMany = vi.fn()
    const renderer = create(
      <AssigneePicker
        assignee={member}
        assignees={[member]}
        members={[member, secondMember, thirdMember]}
        onReassign={noop}
        onReassignMany={onReassignMany}
      />,
    )

    act(() => {
      renderer.root
        .findByProps({ 'aria-label': 'Change assignee' })
        .props.onClick()
    })

    const buttonNamed = (name: string) => {
      let node = renderer.root
        .findAllByType('span')
        .find(span => span.props.children === name)
      while (node && node.type !== 'button') node = node.parent ?? undefined
      return node
    }

    act(() => {
      buttonNamed('Grace Hopper')?.props.onClick()
    })
    act(() => {
      buttonNamed('Katherine Johnson')?.props.onClick()
    })

    expect(onReassignMany.mock.calls).toEqual([
      [['u1', 'u2']],
      [['u1', 'u2', 'u3']],
    ])
  })
})

describe('TaskCardShell', () => {
  const render = (props: Partial<Parameters<typeof TaskCardShell>[0]> = {}) =>
    renderToStaticMarkup(
      <TaskCardShell
        title="Write report"
        tone="idle"
        statusLabel="Queued"
        focusLabel="Focused time"
        workedSeconds={0}
        plannedMinutes={60}
        onEdit={noop}
        onDelete={noop}
        {...props}
      />,
    )

  it('renders the title, status, and the edit/delete controls', () => {
    const html = render()
    expect(html).toContain('Write report')
    expect(html).toContain('Queued')
    expect(html).toContain('Focused time')
    expect(html).toContain('aria-label="Edit Write report"')
    expect(html).toContain('aria-label="Delete Write report"')
  })

  it('renders the caller-supplied actions and body', () => {
    const html = render({
      leading: <span>LEADING</span>,
      actions: <span>ACTIONS</span>,
      children: <span>BODY</span>,
    })
    expect(html).toContain('LEADING')
    expect(html).toContain('ACTIONS')
    expect(html).toContain('BODY')
  })

  it('is draggable only for a numbered root card that has drag handlers', () => {
    const drag = { onDragStart: noop, onDragOver: noop, onDrop: noop }
    expect(render({ index: 0, drag })).toContain('draggable="true"')
    expect(render({ index: 0 })).not.toContain('draggable="true"')
    expect(render({ drag })).not.toContain('draggable="true"')
    expect(render({ index: 0, drag })).toContain(
      'aria-label="Reorder Write report"',
    )
  })

  it('numbers root cards and dots subtasks', () => {
    expect(render({ index: 2 })).toContain('03')
    expect(render()).not.toContain('>03<')
  })

  it('shows a blocked task as blocked without changing its tone', () => {
    const html = render({ blocked: true, statusLabel: 'Blocked' })
    expect(html).toContain('Blocked')
    expect(html).toContain('bg-coral/10 text-coral')
  })

  it('shows the optional progress label only when there is one', () => {
    expect(render()).not.toContain('complete ·')
    expect(
      render({ progressLabel: 'Chapter 3', progressPercentage: 40 }),
    ).toContain('Chapter 3')
  })
})

describe('ParentTaskShell', () => {
  it('summarises subtasks as counts and keeps skipped work visible', () => {
    const subtasks = [
      { status: 'completed', worked: 600 },
      { status: 'skipped', worked: 0 },
      { status: 'queued', worked: 600 },
    ]
    const html = renderToStaticMarkup(
      <ParentTaskShell
        title="Launch"
        subtasks={subtasks}
        getWorkedSeconds={task => task.worked}
        onAddSubtask={noop}
        onDelete={noop}
      >
        <span>SUBTASK-ROWS</span>
      </ParentTaskShell>,
    )
    expect(html).toContain('1 completed')
    expect(html).toContain('1 skipped')
    expect(html).toContain('1 remaining')
    expect(html).toContain('20m focused')
    // Collapsed until expanded.
    expect(html).not.toContain('SUBTASK-ROWS')
  })
})

describe('TaskTree', () => {
  type T = { id: string; name: string; parentTaskId: string | null }
  type Props = Parameters<typeof TaskTree<T>>[0]

  const task = (id: string, parentTaskId: string | null = null): T => ({
    id,
    name: id.toUpperCase(),
    parentTaskId,
  })

  // TaskTree is a hook-free component, so calling it directly runs its
  // render-props exactly as React would, and lets us inspect what it hands them.
  const build = (tasks: T[], onReorder = vi.fn()) => {
    const renderTask = vi.fn<Props['renderTask']>(() => null)
    const renderParent = vi.fn<Props['renderParent']>(() => null)
    TaskTree({ tasks, onReorder, renderTask, renderParent })
    return { renderTask, renderParent, onReorder }
  }

  const dragEvent = (
    dataTransfer: Partial<DataTransfer>,
    preventDefault = vi.fn(),
  ) => ({ preventDefault, dataTransfer }) as unknown as DragEvent<HTMLElement>

  it('renders a flat list as plain task cards numbered by root position', () => {
    const { renderTask, renderParent } = build([task('a'), task('b')])
    expect(renderParent).not.toHaveBeenCalled()
    expect(renderTask.mock.calls.map(([t, ctx]) => [t.id, ctx.index])).toEqual([
      ['a', 0],
      ['b', 1],
    ])
  })

  it('renders a task with children as a parent, and never lists children at the root', () => {
    const { renderTask, renderParent } = build([
      task('a'),
      task('b'),
      task('c', 'b'),
    ])
    expect(renderParent).toHaveBeenCalledTimes(1)
    const [parent, subtasks] = renderParent.mock.calls[0]
    expect(parent.id).toBe('b')
    expect(subtasks.map(t => t.id)).toEqual(['c'])
    expect(renderTask.mock.calls.map(([t]) => t.id)).toEqual(['a'])
  })

  it('offers every other root task as a place to move a task', () => {
    const { renderTask } = build([task('a'), task('b'), task('c', 'b')])
    const [, ctx] = renderTask.mock.calls[0]
    expect(ctx.moveOptions.map(o => o.id)).toEqual(['b'])
  })

  it('reorders by dropping a dragged root card onto another', () => {
    const { renderTask, onReorder } = build([task('a'), task('b'), task('c')])
    const dragOf = (i: number) => renderTask.mock.calls[i][1].drag

    // Drag card 0 ...
    const store: Record<string, string> = {}
    dragOf(0).onDragStart(
      dragEvent({
        setData: (k: string, v: string) => void (store[k] = v),
      }),
    )
    // ... and drop it on card 2.
    const preventDefault = vi.fn()
    dragOf(2).onDrop(
      dragEvent({ getData: (k: string) => store[k] }, preventDefault),
    )

    expect(preventDefault).toHaveBeenCalled()
    expect(onReorder).toHaveBeenCalledWith(0, 2)
  })
})
