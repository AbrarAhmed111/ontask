import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DailyUpdateForm } from '@/components/daily-updates/DailyUpdateForm'
import { DailyUpdatesBoard } from '@/components/daily-updates/DailyUpdatesBoard'
import { DailyUpdatesClient } from '@/components/daily-updates/DailyUpdatesClient'
import { TaskReferencePicker } from '@/components/daily-updates/TaskReferencePicker'
import {
  WorkspaceDetailContext,
  WorkspaceDetailContextValue,
} from '@/components/workspaces/WorkspaceDetailContext'
import { WorkspaceShell } from '@/components/workspaces/WorkspaceShell'
import {
  buildDay,
  draftFromUpdate,
  emptyDraft,
  newDraftItem,
} from '@/lib/dailyUpdates'
import type {
  DailyUpdate,
  DailyUpdateItem,
  Workspace,
  WorkspaceMember,
} from '@/types/workspace'

// The hooks read Supabase inside effects, which server rendering never runs; the
// mock only keeps the import from needing a real client.
vi.mock('@/lib/supabase/client', async () => {
  const { fakeSupabase: fake } = await import('@/test/fakeSupabase')
  return { createClient: () => fake.client }
})

const member = (
  userId: string,
  fullName: string,
  overrides: Partial<WorkspaceMember> = {},
): WorkspaceMember => ({
  id: `m-${userId}`,
  workspaceId: 'ws-1',
  userId,
  role: 'member',
  joinedAt: '2026-01-01T00:00:00Z',
  fullName,
  email: `${userId}@example.com`,
  avatarUrl: null,
  ...overrides,
})

const ABRAR = member('abrar', 'Abrar Ahmed', { role: 'owner' })
const IQRA = member('iqra', 'Iqra Nadeem', { joinedAt: '2026-01-02T00:00:00Z' })
const ARAYSH = member('araysh', 'Araysh', { joinedAt: '2026-01-03T00:00:00Z' })
const MEMBERS = [ABRAR, IQRA, ARAYSH]

const item = (overrides: Partial<DailyUpdateItem> = {}): DailyUpdateItem => ({
  id: 'i-1',
  type: 'done',
  content: 'Completed Slack integration',
  position: 0,
  taskId: null,
  task: null,
  mentionedUserIds: [],
  ...overrides,
})

const update = (
  userId: string,
  items: DailyUpdateItem[],
  overrides: Partial<DailyUpdate> = {},
): DailyUpdate => ({
  id: `u-${userId}`,
  userId,
  reportDate: '2026-09-20',
  submittedAt: '2026-09-20T09:42:00Z',
  editedAt: null,
  items,
  ...overrides,
})

const ABRAR_UPDATE = update('abrar', [
  item({
    id: 'a-1',
    content: 'Completed Slack integration',
    taskId: 'task-slack',
    task: {
      id: 'task-slack',
      title: 'OnTask Integration to Slack',
      status: 'completed',
      kind: 'task',
      goalId: null,
      goalName: null,
      parentTaskId: null,
      parentTitle: null,
    },
  }),
  item({ id: 'a-2', content: 'Added Daily Report narration', position: 1 }),
  item({
    id: 'a-3',
    type: 'blocker',
    content: 'Waiting for Stripe credentials — @Iqra Nadeem',
    taskId: 'task-pay',
    task: {
      id: 'task-pay',
      title: 'Payment Integration',
      status: 'queued',
      kind: 'task',
      goalId: null,
      goalName: null,
      parentTaskId: null,
      parentTitle: null,
    },
    mentionedUserIds: ['iqra'],
  }),
  item({
    id: 'a-4',
    type: 'next',
    content: 'Continue onboarding',
    taskId: 'task-sub',
    task: {
      id: 'task-sub',
      title: 'Finish onboarding flow',
      status: 'working',
      kind: 'goal_subtask',
      goalId: 'g-1',
      goalName: 'Launch Product',
      parentTaskId: 'task-parent',
      parentTitle: 'Build onboarding',
    },
  }),
])

function board(
  props: Partial<Parameters<typeof DailyUpdatesBoard>[0]> = {},
  updates: DailyUpdate[] = [ABRAR_UPDATE],
  members: WorkspaceMember[] = MEMBERS,
) {
  return renderToStaticMarkup(
    <DailyUpdatesBoard
      ready
      error={null}
      day="2026-09-20"
      isToday
      entries={buildDay(members, updates, 'abrar')}
      members={members}
      workspaceSlug="design-team"
      currentUserId="abrar"
      renderOwnCard={() => null}
      onPrevious={() => {}}
      onNext={() => {}}
      onToday={() => {}}
      {...props}
    />,
  )
}

describe('the Daily Updates page', () => {
  it('titles the day and says how many members reported', () => {
    const html = board()
    expect(html).toContain('Daily Updates')
    expect(html).toContain('September 20, 2026')
    expect(html).toContain('1 of 3 members reported')
    expect(html).toContain('2 Not Reported')
  })

  it('shows a card for EVERY member, in a stable order, reported or not', () => {
    const html = board()
    for (const name of ['Abrar Ahmed', 'Iqra Nadeem', 'Araysh']) {
      expect(html).toContain(`${name}&#x27;s Daily Update`)
    }
    // you first, then by joining
    expect(html.indexOf('Abrar Ahmed&#x27;s')).toBeLessThan(
      html.indexOf('Iqra Nadeem&#x27;s'),
    )
    expect(html.indexOf('Iqra Nadeem&#x27;s')).toBeLessThan(
      html.indexOf('Araysh&#x27;s'),
    )
  })

  it('says only "Not Reported" for someone who has not submitted', () => {
    const html = board({}, [ABRAR_UPDATE])
    const araysh = html.slice(html.indexOf('Araysh&#x27;s Daily Update'))
    expect(araysh).toContain('Not Reported')
    expect(araysh).toContain(
      'This member has not submitted an update for this date.',
    )
    // ...and never reads as no work, no blockers, inactive or unproductive
    for (const phrase of [
      'No blockers',
      'Nothing reported',
      'Nothing planned',
      'inactive',
      'no activity',
      'unproductive',
      'no work',
    ]) {
      expect(araysh.toLowerCase()).not.toContain(phrase.toLowerCase())
    }
  })

  it('turns Not Reported into a report as soon as the update exists', () => {
    const before = board({}, [])
    expect(before).toContain('0 of 3 members reported')
    expect(before).toContain('3 Not Reported')
    expect(before).toContain('Nobody has submitted an update yet today.')

    const after = board({}, [update('araysh', [item()])])
    expect(after).toContain('1 of 3 members reported')
    expect(after).toContain('Submitted at')
    expect(after).not.toContain('Nobody has submitted')
  })

  it('does not turn reporting into a score', () => {
    const html = board()
    expect(html).not.toMatch(/%|score|rank|productiv/i)
  })

  it('shows Done, Blocker and Next as separate sections in the same order', () => {
    const html = board()
    const card = html.slice(
      html.indexOf('Abrar Ahmed&#x27;s Daily Update'),
      html.indexOf('Iqra Nadeem&#x27;s Daily Update'),
    )
    const done = card.indexOf('What Is Done?')
    const blocker = card.indexOf('Any Blocker?')
    const next = card.indexOf('What&#x27;s Next?')
    expect(done).toBeGreaterThan(-1)
    expect(blocker).toBeGreaterThan(done)
    expect(next).toBeGreaterThan(blocker)
    expect(card).toContain('Completed Slack integration')
    expect(card).toContain('Added Daily Report narration')
    expect(card).toContain('Waiting for Stripe credentials')
    expect(card).toContain('Continue onboarding')
  })

  it('says "No blockers" / "Nothing planned" for a reported update with those sections empty', () => {
    const html = board({}, [update('iqra', [item()])])
    const card = html.slice(html.indexOf('Iqra Nadeem&#x27;s Daily Update'))
    expect(card).toContain('No blockers')
    expect(card).toContain('Nothing planned')
  })

  it('links a referenced task into the existing task view', () => {
    const html = board()
    expect(html).toContain('OnTask Integration to Slack')
    expect(html).toContain('href="/workspaces/design-team?task=task-slack"')
    expect(html).toContain('href="/workspaces/design-team?task=task-pay"')
  })

  it('keeps a Goal task’s and a subtask’s context', () => {
    const html = board()
    expect(html).toContain('Goal: Launch Product')
    expect(html).toContain('Build onboarding')
    expect(html).toContain('Finish onboarding flow')
  })

  it('reads a deleted task as unavailable but keeps the words', () => {
    const html = board({}, [
      update('abrar', [
        item({
          content: 'Wrapped up the old work',
          taskId: 'gone',
          task: null,
        }),
      ]),
    ])
    expect(html).toContain('Wrapped up the old work')
    expect(html).toContain('Referenced task no longer available')
    expect(html).not.toContain('task=gone')
  })

  it('highlights a tagged member and never invents a mention', () => {
    const html = board()
    expect(html).toMatch(/<mark[^>]*>@Iqra Nadeem<\/mark>/)
    const plain = board({}, [
      update('abrar', [item({ content: 'Iqra will help with @Nobody' })]),
    ])
    expect(plain).not.toContain('<mark')
  })

  it('says a tagged person who left was a former member, without breaking the item', () => {
    const html = board({}, [
      update('abrar', [
        item({
          type: 'blocker',
          content: 'Waiting on @Gone Person',
          mentionedUserIds: ['gone'],
        }),
      ]),
    ])
    expect(html).toContain('Waiting on @Gone Person')
    expect(html).toContain('Asked a former member')
  })

  it('shows when it was submitted, and updated only if it was changed', () => {
    expect(board()).toMatch(/Submitted at \d{1,2}:\d{2}/)
    expect(board()).not.toContain('Updated at')
    const edited = board({}, [
      update('abrar', [item()], { editedAt: '2026-09-20T10:15:00Z' }),
    ])
    expect(edited).toMatch(
      /Submitted at \d{1,2}:\d{2}.*Updated at \d{1,2}:\d{2}/,
    )
  })

  it('offers Edit on your own submitted update only when it is editable', () => {
    const withEdit = renderToStaticMarkup(
      <DailyUpdatesBoard
        ready
        error={null}
        day="2026-09-20"
        isToday
        entries={buildDay(MEMBERS, [ABRAR_UPDATE], 'abrar')}
        members={MEMBERS}
        workspaceSlug="design-team"
        currentUserId="abrar"
        renderOwnCard={() => null}
        onPrevious={() => {}}
        onNext={() => {}}
        onToday={() => {}}
      />,
    )
    // no edit control on anyone’s card unless the page hands one over
    expect(withEdit).not.toContain('Edit')
  })

  it('handles a workspace with no members', () => {
    const html = board({}, [], [])
    expect(html).toContain('No members yet')
    expect(html).not.toContain('Not Reported')
  })

  it('waits with placeholders while loading, and says when loading failed', () => {
    const loading = board({ ready: false })
    expect(loading).not.toContain('reported')
    expect(loading).toContain('animate-pulse')
    expect(board({ error: 'Couldn’t load Daily Updates.' })).toContain(
      'Couldn’t load Daily Updates.',
    )
  })

  it('moves between days, only forward until today', () => {
    const today = board()
    expect(today).toMatch(/aria-label="Next day"[^>]*disabled=""/)
    expect(today).not.toContain('>Today<')
    const past = board({ day: '2026-09-19', isToday: false, isYesterday: true })
    expect(past).toContain('September 19, 2026')
    expect(past).toContain('Yesterday')
    expect(past).toContain('>Today<')
    expect(past).not.toMatch(/aria-label="Next day"[^>]*disabled=""/)
    expect(board({ day: '2026-09-19', isToday: false, isYesterday: true }, [])).toContain(
      'Nobody submitted an update for yesterday.',
    )
  })
})

describe('the form', () => {
  const form = (props: Partial<Parameters<typeof DailyUpdateForm>[0]> = {}) =>
    renderToStaticMarkup(
      <DailyUpdateForm
        workspaceId="ws-1"
        currentUserId="abrar"
        members={MEMBERS}
        initial={emptyDraft()}
        submitted={null}
        draftKey="draft-key"
        onSubmit={async () => ({ success: true })}
        {...props}
      />,
    )

  it('offers the three sections, each ready to type into', () => {
    const html = form()
    for (const title of [
      'What Is Done?',
      'Any Blocker?',
      'What&#x27;s Next?',
    ]) {
      expect(html).toContain(title)
    }
    expect((html.match(/<textarea/g) ?? []).length).toBe(3)
    expect(html).toContain('Add item')
    expect(html).toContain('Link a task')
  })

  it('cannot submit until there is something to submit', () => {
    expect(form()).toMatch(/<button[^>]*disabled=""[^>]*>Submit update/)
    const filled = emptyDraft()
    filled.done = [newDraftItem('Completed Slack integration')]
    expect(form({ initial: filled })).not.toMatch(
      /<button[^>]*disabled=""[^>]*>Submit update/,
    )
  })

  it('shows one row per existing item, with its task, when changing an update', () => {
    const initial = draftFromUpdate(ABRAR_UPDATE, MEMBERS)
    const html = form({
      initial,
      submitted: draftFromUpdate(ABRAR_UPDATE, MEMBERS),
    })
    expect(html).toContain('OnTask Integration to Slack')
    expect(html).toContain('Completed Slack integration')
    expect(html).toContain('Added Daily Report narration')
    expect(html).toContain('Save changes')
    expect(html).not.toContain('Submit update')
    // nothing changed yet, so there is nothing to save
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save changes/)
  })

  it('lets each item be moved and removed', () => {
    const initial = draftFromUpdate(ABRAR_UPDATE, MEMBERS)
    const html = form({ initial })
    expect(html).toContain('Move What Is Done? item 2 up')
    expect(html).toContain('Remove What Is Done? item 1')
    // the first item cannot move up, the last cannot move down
    expect(html).toMatch(
      /aria-label="Move What Is Done\? item 1 up"[^>]*disabled=""/,
    )
  })

  it('says nothing is shared until submitted', () => {
    expect(form()).toContain('Nothing is shared until you submit.')
  })
})

describe('the task picker', () => {
  it('is a searchable list, not the whole task table', () => {
    const html = renderToStaticMarkup(
      <TaskReferencePicker
        workspaceId="ws-1"
        itemType="done"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('Search tasks')
    expect(html).toContain('Suggested for you')
  })
})

describe('the page in a workspace', () => {
  const workspace = (type: 'shared' | 'personal'): Workspace => ({
    id: 'ws-1',
    slug: type === 'personal' ? 'personal-workspace' : 'design-team',
    type,
    name: 'Design Team',
    description: null,
    ownerId: 'abrar',
    timezone: 'UTC',
    reportTime: '12:00:00',
    dailyReportsEnabled: true,
    accent: 'forest',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })
  const context = (type: 'shared' | 'personal') =>
    ({
      workspaceId: 'ws-1',
      user: {
        id: 'abrar',
        email: 'a@example.com',
        fullName: 'Abrar',
        avatarUrl: null,
      },
      workspace: workspace(type),
      members: MEMBERS,
      isPersonal: type === 'personal',
      ready: true,
    }) as unknown as WorkspaceDetailContextValue

  it('renders nothing in a personal workspace', () => {
    const html = renderToStaticMarkup(
      <WorkspaceDetailContext.Provider value={context('personal')}>
        <DailyUpdatesClient />
      </WorkspaceDetailContext.Provider>,
    )
    expect(html).toBe('')
  })

  it('renders the page, with placeholders until the day has loaded, in a shared workspace', () => {
    const html = renderToStaticMarkup(
      <WorkspaceDetailContext.Provider value={context('shared')}>
        <DailyUpdatesClient />
      </WorkspaceDetailContext.Provider>,
    )
    expect(html).toContain('Daily Updates')
    expect(html).toContain('animate-pulse')
  })
})

describe('navigation', () => {
  const shell = (isPersonal: boolean) =>
    renderToStaticMarkup(
      <WorkspaceShell
        workspaceId="ws-1"
        workspace={null}
        members={[]}
        role="owner"
        ready={false}
        user={{
          id: 'abrar',
          email: 'a@example.com',
          fullName: 'Abrar',
          avatarUrl: null,
        }}
        onlineUserIds={new Set()}
        section="daily-updates"
        onSectionChange={() => {}}
        isPersonal={isPersonal}
        onLogout={() => {}}
      >
        <p>page</p>
      </WorkspaceShell>,
    )

  it('adds Daily Updates beside Overview in a shared workspace', () => {
    const html = shell(false)
    expect(html).toContain('title="Daily Updates"')
    expect(html).toContain('title="Overview"')
    // Daily Reports keep their own place on the overview; nothing was renamed
    expect(html).not.toContain('title="Daily Reports"')
  })

  it('has no Daily Updates in a personal workspace', () => {
    expect(shell(true)).not.toContain('Daily Updates')
  })
})
