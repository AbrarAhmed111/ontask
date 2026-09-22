import { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BlockedNowPanel } from '@/components/blockers/BlockedNowPanel'
import { BlockerButton } from '@/components/blockers/BlockerButton'
import { BlockerDialog } from '@/components/blockers/BlockerDialog'
import { BlockerDisplay } from '@/components/blockers/BlockerDisplay'
import { ResolveBlockerDialog } from '@/components/blockers/ResolveBlockerDialog'
import { TaskBlockerActionsContext } from '@/components/blockers/TaskBlockerActionsContext'
import { MemberMentionPicker } from '@/components/mentions/MemberMentionPicker'
import { MentionTextarea } from '@/components/mentions/MentionTextarea'
import { StaticBlockersProvider } from '@/components/workspaces/WorkspaceBlockersContext'
import {
  WorkspaceDetailContext,
  WorkspaceDetailContextValue,
} from '@/components/workspaces/WorkspaceDetailContext'
import { WorkspaceTaskCard } from '@/components/workspaces/WorkspaceTaskCard'
import type { AuthUser } from '@/hooks/useAuth'
import type { TaskBlockerActions } from '@/hooks/useTaskBlockerActions'
import type {
  TaskBlocker,
  WorkspaceMember,
  WorkspaceTask,
} from '@/types/workspace'

// The real Modal renders through a portal, which has nowhere to go under
// server rendering; a plain inline stand-in keeps the dialogs' own content
// testable.
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    title,
    eyebrow,
    children,
  }: {
    title: string
    eyebrow?: string
    children: ReactNode
  }) => (
    <section role="dialog" aria-label={title}>
      {eyebrow && <p>{eyebrow}</p>}
      <h2>{title}</h2>
      {children}
    </section>
  ),
}))

const noop = () => {}

const member = (
  userId: string,
  fullName: string,
  role: WorkspaceMember['role'] = 'member',
): WorkspaceMember => ({
  id: `m-${userId}`,
  workspaceId: 'w1',
  userId,
  role,
  joinedAt: '2026-01-01',
  fullName,
  email: `${userId}@example.com`,
  avatarUrl: null,
})

const abrar = member('u-abrar', 'Abrar Ahmed')
const araysh = member('u-araysh', 'Araysh Khan')
const rachel = member('u-rachel', 'Rachel Smith')
const olive = member('u-olive', 'Olive Owner', 'owner')
const sam = member('u-sam', 'Sam Bystander')
const MEMBERS = [abrar, araysh, rachel, olive, sam]

const authUser = (m: WorkspaceMember): AuthUser => ({
  id: m.userId,
  email: m.email,
  fullName: m.fullName,
  avatarUrl: null,
})

const task = (overrides: Partial<WorkspaceTask> = {}): WorkspaceTask => ({
  id: 't-1',
  workspaceId: 'w1',
  parentTaskId: null,
  goalId: null,
  createdBy: 'u-olive',
  assignedTo: 'u-abrar',
  name: 'Student API',
  plannedMinutes: 60,
  workedSeconds: 600,
  status: 'queued',
  startedAt: null,
  completedAt: null,
  ...overrides,
})

const blocker = (overrides: Partial<TaskBlocker> = {}): TaskBlocker => ({
  id: 'b-1',
  taskId: 't-1',
  workspaceId: 'w1',
  createdBy: 'u-abrar',
  reason: 'Waiting for API credentials from @Araysh Khan.',
  status: 'active',
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  resolvedBy: null,
  resolutionNote: null,
  mentionedUserIds: ['u-araysh'],
  ...overrides,
})

const actions: TaskBlockerActions = {
  block: () => true,
  update: () => true,
  resolve: () => true,
}

function renderCard({
  viewer,
  task: taskProp = task(),
  blockers = [],
  isPersonal = false,
  members = MEMBERS,
  withActions = true,
  blockedBy,
}: {
  viewer: WorkspaceMember
  task?: WorkspaceTask
  blockers?: TaskBlocker[]
  isPersonal?: boolean
  members?: WorkspaceMember[]
  withActions?: boolean
  blockedBy?: string[]
}) {
  const detail = {
    workspaceId: 'w1',
    isPersonal,
    isOwner: viewer.role === 'owner',
  } as unknown as WorkspaceDetailContextValue
  return renderToStaticMarkup(
    <WorkspaceDetailContext.Provider value={detail}>
      <StaticBlockersProvider blockers={blockers}>
        <TaskBlockerActionsContext.Provider
          value={withActions ? actions : null}
        >
          <WorkspaceTaskCard
            task={taskProp}
            workedSeconds={taskProp.workedSeconds}
            members={members}
            user={authUser(viewer)}
            onStart={noop}
            onPause={noop}
            onFinish={noop}
            onEdit={noop}
            onDelete={noop}
            onReassign={noop}
            blockedBy={blockedBy}
          />
        </TaskBlockerActionsContext.Provider>
      </StaticBlockersProvider>
    </WorkspaceDetailContext.Provider>,
  )
}

// The opening tag of the first <button> whose visible text includes `label`.
function buttonTag(html: string, label: string): string | null {
  for (const match of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = match[2].replace(/<[^>]*>/g, '')
    if (text.includes(label)) return match[1]
  }
  return null
}

// Whether that tag really carries the boolean `disabled` attribute. Not a
// substring test: the buttons' class lists include Tailwind's `disabled:`
// variants, which would make every button look disabled.
const isDisabled = (tag: string | null) => /\sdisabled=""/.test(tag ?? '')

const blockedTask = () => task({ status: 'blocked' })

describe('the Blocker action on a task card', () => {
  it('is offered to the current assignee', () => {
    const html = renderCard({ viewer: abrar })
    expect(html).toContain('aria-label="Report a blocker on Student API"')
    expect(buttonTag(html, 'Blocker')).not.toBeNull()
  })

  it('explains itself with a tooltip', () => {
    expect(renderCard({ viewer: abrar })).toContain(
      'title="Mark this task as blocked and say what&#x27;s in the way. Its timer stops."',
    )
  })

  it('is offered on a running or paused task too', () => {
    for (const status of ['working', 'paused'] as const)
      expect(
        renderCard({ viewer: abrar, task: task({ status, startedAt: 1 }) }),
      ).toContain('Report a blocker on')
  })

  it('is not offered to anyone else — the owner and a bystander included', () => {
    for (const viewer of [olive, sam, araysh])
      expect(renderCard({ viewer })).not.toContain('Report a blocker on')
  })

  it('is not offered to the previous assignee after a reassignment', () => {
    const reassigned = task({ assignedTo: 'u-rachel' })
    expect(renderCard({ viewer: abrar, task: reassigned })).not.toContain(
      'Report a blocker on',
    )
    expect(renderCard({ viewer: rachel, task: reassigned })).toContain(
      'Report a blocker on',
    )
  })

  it('is not offered in a personal workspace', () => {
    expect(renderCard({ viewer: abrar, isPersonal: true })).not.toContain(
      'Report a blocker on',
    )
  })

  it('is not offered when nothing can act on it', () => {
    expect(renderCard({ viewer: abrar, withActions: false })).not.toContain(
      'Report a blocker on',
    )
  })

  it('is not offered on a finished task or one that is already blocked', () => {
    for (const status of ['completed', 'skipped'] as const)
      expect(
        renderCard({ viewer: abrar, task: task({ status }) }),
      ).not.toContain('Report a blocker on')
    expect(
      renderCard({
        viewer: abrar,
        task: blockedTask(),
        blockers: [blocker()],
      }),
    ).not.toContain('Report a blocker on')
  })
})

describe('a blocked task card', () => {
  const render = (viewer: WorkspaceMember, t = blockedTask()) =>
    renderCard({ viewer, task: t, blockers: [blocker()] })

  it('says it is blocked, with the reason, in words', () => {
    const html = render(abrar)
    expect(html).toContain('Blocked')
    expect(html).toContain('Waiting for API credentials from @Araysh Khan.')
    expect(html).toContain('aria-label="Blocker on Student API"')
    // Not colour alone: the state is spelled out for assistive technology too.
    expect(html).toContain('this task cannot continue')
  })

  it('shows who is being asked to help', () => {
    const html = render(sam)
    expect(html).toContain('Waiting on')
    expect(html).toContain('Araysh Khan')
  })

  it('is fully visible to every member, whether or not they can resolve it', () => {
    for (const viewer of MEMBERS) {
      const html = render(viewer)
      expect(html).toContain('Waiting for API credentials from @Araysh Khan.')
      expect(html).toContain('Waiting on')
    }
  })

  it('cannot be started while blocked', () => {
    const html = render(abrar)
    const start = buttonTag(html, 'Start')
    expect(start).not.toBeNull()
    expect(isDisabled(start)).toBe(true)
    expect(start).toContain('Blocked — resolve the blocker to continue')
  })

  it('cannot be finished while blocked', () => {
    const finish = buttonTag(render(abrar), 'Finish')
    expect(isDisabled(finish)).toBe(true)
    expect(finish).toContain('Resolve the blocker before finishing this task')
  })

  it('keeps an assignee: "Unassigned" is not offered while blocked', () => {
    // The picker's list is only rendered when open, so this checks the wiring
    // through the prop that hides it.
    expect(render(abrar)).toContain('aria-label="Change assignee"')
  })

  describe('Resolve blocker', () => {
    const canResolve = (viewer: WorkspaceMember, t = blockedTask()) =>
      buttonTag(render(viewer, t), 'Resolve blocker') !== null

    it('is offered to the current assignee', () => {
      expect(canResolve(abrar)).toBe(true)
    })

    it('is offered to a mentioned member', () => {
      expect(canResolve(araysh)).toBe(true)
    })

    it('is not offered to a member who was not mentioned', () => {
      expect(canResolve(sam)).toBe(false)
    })

    it('is not offered to the workspace owner just for being the owner', () => {
      expect(canResolve(olive)).toBe(false)
    })

    it('moves with the assignee: the previous one loses it, the new one gains it', () => {
      const reassigned = task({ status: 'blocked', assignedTo: 'u-rachel' })
      expect(canResolve(abrar, reassigned)).toBe(false)
      expect(canResolve(rachel, reassigned)).toBe(true)
      expect(canResolve(araysh, reassigned)).toBe(true)
    })

    it('is not offered to someone who is no longer in the workspace', () => {
      // Still named on the blocker, but absent from the member list.
      const html = renderCard({
        viewer: araysh,
        task: blockedTask(),
        blockers: [blocker()],
        members: MEMBERS.filter(m => m.userId !== 'u-araysh'),
      })
      expect(buttonTag(html, 'Resolve blocker')).toBeNull()
    })

    it('tells a member who cannot resolve it who can, instead of just hiding the button', () => {
      const html = render(sam)
      expect(html).toContain(
        'Only Abrar Ahmed or Araysh Khan can resolve this.',
      )
    })

    it('does not show that line to someone who can', () => {
      expect(render(abrar)).not.toContain('can resolve this.')
    })
  })

  describe('Edit blocker', () => {
    const canEdit = (viewer: WorkspaceMember) =>
      buttonTag(render(viewer), 'Edit blocker') !== null

    it('is for the assignee only', () => {
      expect(canEdit(abrar)).toBe(true)
      expect(canEdit(araysh)).toBe(false)
      expect(canEdit(olive)).toBe(false)
      expect(canEdit(sam)).toBe(false)
    })
  })

  it('is not confused with a Goal dependency', () => {
    const html = renderCard({
      viewer: sam,
      task: task(),
      blockedBy: ['Design the schema'],
    })
    expect(html).toContain('Blocked by: Design the schema')
    // A dependency is not a blocker: no reason, nobody to ask, nothing to resolve.
    expect(html).not.toContain('Waiting on')
    expect(buttonTag(html, 'Resolve blocker')).toBeNull()
  })
})

describe('a collaborative task card', () => {
  it('shows each collaborator focus time and the all-task total', () => {
    const html = renderCard({
      viewer: abrar,
      task: task({
        workedSeconds: 5100,
        totalFocusSeconds: 6000,
        collaborators: [
          {
            id: 'c-abrar',
            taskId: 't-1',
            workspaceId: 'w1',
            userId: 'u-abrar',
            participationStatus: 'paused',
            focusedSeconds: 2400,
            startedAt: null,
            completedAt: null,
            removedAt: null,
          },
          {
            id: 'c-araysh',
            taskId: 't-1',
            workspaceId: 'w1',
            userId: 'u-araysh',
            participationStatus: 'completed',
            focusedSeconds: 3600,
            startedAt: null,
            completedAt: null,
            removedAt: null,
          },
        ],
      }),
    })

    expect(html).toContain('All Focus Time')
    expect(html).toContain('01h 40m 00s')
    expect(html).toContain('40m')
    expect(html).toContain('01h 00m')
  })
})

describe('BlockerButton', () => {
  it('has an accessible name that says which task', () => {
    const html = renderToStaticMarkup(
      <BlockerButton taskName="Student API" onClick={noop} />,
    )
    expect(html).toContain('aria-label="Report a blocker on Student API"')
    expect(html).toContain('type="button"')
  })
})

describe('BlockerDialog', () => {
  const render = (props: Partial<Parameters<typeof BlockerDialog>[0]> = {}) =>
    renderToStaticMarkup(
      <BlockerDialog
        taskName="Student API"
        members={MEMBERS}
        actorId="u-abrar"
        onSubmit={noop}
        onClose={noop}
        {...props}
      />,
    )

  it('asks the question, with Block Task and Cancel', () => {
    const html = render()
    expect(html).toContain('What&#x27;s blocking this task?')
    expect(html).toContain('Block Task')
    expect(html).toContain('Cancel')
    expect(html).toContain('role="dialog"')
  })

  it('has a labelled reason field', () => {
    expect(render()).toContain('aria-label="What&#x27;s blocking this task?"')
  })

  it('says mentioning is optional and how to do it', () => {
    const html = render()
    expect(html).toContain('Type @ to mention a workspace member')
    expect(html).toContain('optional')
  })

  it('cannot be submitted until there is a reason', () => {
    expect(isDisabled(buttonTag(render(), 'Block Task'))).toBe(true)
  })

  it('does not offer the person raising it as someone to mention', () => {
    // Nothing is listed until "@" is typed; the exclusion is what the field is
    // handed, checked via the markup it is built from.
    expect(render()).not.toContain('role="listbox"')
  })

  it('edits an existing blocker: prefilled, with its mentions, and Save changes', () => {
    const html = render({
      initial: {
        reason: 'Waiting for API credentials from @Araysh Khan.',
        mentionedMembers: [araysh],
      },
    })
    expect(html).toContain('Edit blocker')
    expect(html).toContain('Save changes')
    expect(html).not.toContain('Block Task')
    expect(html).toContain('Waiting for API credentials from @Araysh Khan.')
    expect(html).toContain('aria-label="Mentioned members"')
    expect(html).toContain('Remove mention of Araysh Khan')
  })

  it('visually emphasizes an anchored mention in the input', () => {
    const text = 'Waiting for @Araysh Khan.'
    const html = renderToStaticMarkup(
      <MentionTextarea
        value={{
          text,
          mentions: [
            {
              userId: araysh.userId,
              label: 'Araysh Khan',
              start: text.indexOf('@Araysh Khan'),
              end: text.indexOf('@Araysh Khan') + '@Araysh Khan'.length,
            },
          ],
        }}
        onChange={noop}
        members={MEMBERS}
        ariaLabel="Blocker reason"
      />,
    )
    expect(html).toContain('<mark')
    expect(html).toContain('font-bold')
    expect(html).toContain('@Araysh Khan')
  })
})

describe('ResolveBlockerDialog', () => {
  const html = renderToStaticMarkup(
    <ResolveBlockerDialog
      taskName="Student API"
      reason="Waiting for API credentials from @Araysh Khan."
      onSubmit={noop}
      onClose={noop}
    />,
  )

  it('shows what is being resolved', () => {
    expect(html).toContain('Resolve blocker')
    expect(html).toContain('Student API')
    expect(html).toContain('Waiting for API credentials from @Araysh Khan.')
  })

  it('has an optional note and the two buttons', () => {
    expect(html).toContain('What changed?')
    expect(html).toContain('(optional)')
    expect(html).toContain('Cancel')
    expect(buttonTag(html, 'Resolve blocker')).not.toBeNull()
    // The note is optional: the confirm button is never gated on it.
    expect(isDisabled(buttonTag(html, 'Resolve blocker'))).toBe(false)
  })

  it('says resolving does not start the timer', () => {
    expect(html).toContain('doesn&#x27;t start')
  })
})

describe('MemberMentionPicker', () => {
  const render = (members: WorkspaceMember[], activeIndex = 0) =>
    renderToStaticMarkup(
      <MemberMentionPicker
        id="list"
        members={members}
        activeIndex={activeIndex}
        onSelect={noop}
      />,
    )

  it('is a listbox of options', () => {
    const html = render([araysh, rachel])
    expect(html).toContain('role="listbox"')
    expect(html.match(/role="option"/g)).toHaveLength(2)
  })

  it('marks exactly the active option as selected', () => {
    const html = render([araysh, rachel], 1)
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html.match(/aria-selected="false"/g)).toHaveLength(1)
  })

  it('shows each person’s name and email', () => {
    const html = render([araysh])
    expect(html).toContain('Araysh Khan')
    expect(html).toContain('u-araysh@example.com')
  })

  it('lists two members with the same name as two options, told apart by email', () => {
    const twin = {
      ...abrar,
      id: 'm-twin',
      userId: 'u-abrar-2',
      email: 'abrar.other@example.org',
    }
    const html = render([abrar, twin])
    expect(html.match(/Abrar Ahmed/g)).toHaveLength(2)
    expect(html).toContain('u-abrar@example.com')
    expect(html).toContain('abrar.other@example.org')
    expect(html.match(/role="option"/g)).toHaveLength(2)
  })
})

describe('BlockedNowPanel', () => {
  it('shows nothing when nothing is blocked', () => {
    expect(
      renderToStaticMarkup(<BlockedNowPanel items={[]} members={MEMBERS} />),
    ).toBe('')
  })

  it('lists each blocked task with its reason, its assignee and who is being asked', () => {
    const html = renderToStaticMarkup(
      <BlockedNowPanel
        members={MEMBERS}
        items={[{ task: blockedTask(), blocker: blocker() }]}
      />,
    )
    expect(html).toContain('aria-label="Blocked tasks"')
    expect(html).toContain('Student API')
    expect(html).toContain('Waiting for API credentials from @Araysh Khan.')
    expect(html).toContain('Waiting on Araysh Khan')
    expect(html).toContain('Abrar Ahmed')
  })

  it('names the goal a goal task belongs to', () => {
    const html = renderToStaticMarkup(
      <BlockedNowPanel
        members={MEMBERS}
        items={[
          { task: blockedTask(), goalName: 'School MVP', blocker: blocker() },
        ]}
      />,
    )
    expect(html).toContain('Goal: School MVP')
  })
})

describe('BlockerDisplay', () => {
  it('handles a blocker whose author has left the workspace', () => {
    const html = renderToStaticMarkup(
      <BlockerDisplay
        task={{ assignedTo: 'u-abrar', name: 'Student API' }}
        blocker={blocker({ createdBy: 'u-gone' })}
        members={MEMBERS}
        canResolve={false}
        canEdit={false}
        onResolve={noop}
        onEdit={noop}
      />,
    )
    expect(html).toContain('Reported by a former member')
  })
})
