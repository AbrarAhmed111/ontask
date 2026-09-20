import { describe, expect, it } from 'vitest'
import {
  DAILY_UPDATE_SECTIONS,
  DraftUpdate,
  MAX_ITEMS_PER_SECTION,
  MAX_ITEM_LENGTH,
  buildDay,
  clearDraft,
  draftFromUpdate,
  draftItemCount,
  draftProblem,
  draftStorageKey,
  draftToPayload,
  emptyDraft,
  formatDay,
  isValidDay,
  itemsOfType,
  loadDraft,
  mentionSegments,
  moveItem,
  newDraftItem,
  orderMembers,
  readCandidates,
  readUpdates,
  referenceOf,
  sameContent,
  saveDraft,
  shiftDay,
  splitPastedText,
  submissionLabels,
  summarizeDay,
  taskHref,
  workspaceToday,
} from '@/lib/dailyUpdates'
import type {
  DailyUpdate,
  DailyUpdateItem,
  WorkspaceMember,
} from '@/types/workspace'

const member = (
  userId: string,
  fullName: string | null,
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

const ABRAR = member('abrar', 'Abrar Ahmed', {
  role: 'owner',
  joinedAt: '2026-01-01T00:00:00Z',
})
const IQRA = member('iqra', 'Iqra Nadeem', { joinedAt: '2026-01-02T00:00:00Z' })
const ARAYSH = member('araysh', 'Araysh', { joinedAt: '2026-01-03T00:00:00Z' })

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
  items: DailyUpdateItem[] = [item()],
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

// A draft with the given text per section.
function draftOf(
  texts: Partial<Record<'done' | 'blocker' | 'next', string[]>>,
) {
  const draft: DraftUpdate = { done: [], blocker: [], next: [] }
  for (const section of DAILY_UPDATE_SECTIONS) {
    draft[section.type] = (texts[section.type] ?? ['']).map(text =>
      newDraftItem(text),
    )
  }
  return draft
}

describe('what goes to the server', () => {
  it('turns each line into a SEPARATE item, in section then list order', () => {
    const draft = draftOf({
      done: [
        'Completed Slack integration',
        'Fixed Daily Report notifications',
        'Tested Slack OAuth',
      ],
      next: ['Finish notification preferences', 'Deploy production changes'],
    })
    expect(draftToPayload(draft)).toEqual([
      {
        type: 'done',
        content: 'Completed Slack integration',
        task_id: null,
        mentioned_user_ids: [],
      },
      {
        type: 'done',
        content: 'Fixed Daily Report notifications',
        task_id: null,
        mentioned_user_ids: [],
      },
      {
        type: 'done',
        content: 'Tested Slack OAuth',
        task_id: null,
        mentioned_user_ids: [],
      },
      {
        type: 'next',
        content: 'Finish notification preferences',
        task_id: null,
        mentioned_user_ids: [],
      },
      {
        type: 'next',
        content: 'Deploy production changes',
        task_id: null,
        mentioned_user_ids: [],
      },
    ])
  })

  it('never sends blank rows -- they are only somewhere to type', () => {
    const draft = draftOf({
      done: ['Real work', '   ', ''],
      blocker: [''],
      next: [''],
    })
    expect(draftToPayload(draft)).toHaveLength(1)
    expect(draftItemCount(draft)).toBe(1)
  })

  it('carries the task and the mentioned people by id, never by name', () => {
    const draft = draftOf({ blocker: ['Waiting on @Iqra Nadeem'] })
    draft.blocker[0].task = {
      id: 'task-pay',
      title: 'Payment Integration',
      kind: 'task',
      status: 'queued',
      goalName: null,
      parentTitle: null,
    }
    draft.blocker[0].mentions = [
      { userId: 'iqra', label: 'Iqra Nadeem', start: 11, end: 23 },
      { userId: 'iqra', label: 'Iqra Nadeem', start: 30, end: 42 },
    ]
    const [payload] = draftToPayload(draft)
    expect(payload.task_id).toBe('task-pay')
    expect(payload.mentioned_user_ids).toEqual(['iqra']) // one person, once
    expect(JSON.stringify(payload)).not.toContain('title')
  })

  it('keeps one line per item: a stray line break becomes a space', () => {
    const draft = draftOf({ done: ['Completed payment API\nAdded validation'] })
    expect(draftToPayload(draft)[0].content).toBe(
      'Completed payment API Added validation',
    )
  })

  it('has a reason a draft cannot be submitted, in words', () => {
    expect(draftProblem(emptyDraft())).toMatch(/at least one item/i)
    expect(draftProblem(draftOf({ done: ['Work'] }))).toBeNull()
    const tooLong = draftOf({ done: ['a'.repeat(MAX_ITEM_LENGTH + 1)] })
    expect(draftProblem(tooLong)).toMatch(/500 characters/)
    const tooMany = draftOf({
      next: Array.from(
        { length: MAX_ITEMS_PER_SECTION + 1 },
        (_, i) => `Item ${i}`,
      ),
    })
    expect(draftProblem(tooMany)).toMatch(/20 items/)
  })

  it('knows when nothing changed, ignoring blank rows and row keys', () => {
    const a = draftOf({ done: ['One', 'Two'] })
    const b = draftOf({ done: ['One', '', 'Two'] })
    expect(sameContent(a, b)).toBe(true)
    expect(sameContent(a, draftOf({ done: ['One', 'Three'] }))).toBe(false)
  })
})

describe('typing and pasting', () => {
  it('splits a pasted block into one item per line, blank lines included', () => {
    expect(
      splitPastedText(
        'Completed Slack integration\n\nFixed Daily Report notifications\r\n\r\nTested Slack OAuth',
      ),
    ).toEqual([
      'Completed Slack integration',
      'Fixed Daily Report notifications',
      'Tested Slack OAuth',
    ])
  })

  it('drops list formatting from pasted lines', () => {
    expect(
      splitPastedText('- one\n* two\n• three\n✓ four\n1. five\n2) six'),
    ).toEqual(['one', 'two', 'three', 'four', 'five', 'six'])
  })

  it('reorders within a section and leaves out-of-range moves alone', () => {
    const items = ['a', 'b', 'c'].map(text => newDraftItem(text))
    expect(moveItem(items, 1, -1).map(i => i.text)).toEqual(['b', 'a', 'c'])
    expect(moveItem(items, 1, 1).map(i => i.text)).toEqual(['a', 'c', 'b'])
    expect(moveItem(items, 0, -1).map(i => i.text)).toEqual(['a', 'b', 'c'])
    expect(moveItem(items, 2, 1).map(i => i.text)).toEqual(['a', 'b', 'c'])
  })
})

describe('editing a submitted update', () => {
  it('rebuilds the draft with tasks and mentions, sections in order', () => {
    const submitted = update('abrar', [
      item({
        id: 'i-2',
        type: 'next',
        position: 0,
        content: 'Deploy the changes',
      }),
      item({
        id: 'i-1',
        type: 'blocker',
        position: 0,
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
    ])
    const draft = draftFromUpdate(submitted, [ABRAR, IQRA])
    expect(draft.blocker[0].task?.title).toBe('Payment Integration')
    expect(draft.blocker[0].mentions).toHaveLength(1)
    expect(draft.blocker[0].mentions[0]).toMatchObject({
      userId: 'iqra',
      start: 33,
    })
    expect(draft.done).toHaveLength(1) // an empty section keeps a row to type into
    expect(draft.done[0].text).toBe('')
    // and it round-trips: editing nothing changes nothing
    expect(sameContent(draft, draftFromUpdate(submitted, [ABRAR, IQRA]))).toBe(
      true,
    )
  })

  it('keeps a reference to a deleted task, so editing does not silently drop it', () => {
    const stale = update('abrar', [item({ taskId: 'task-gone', task: null })])
    const draft = draftFromUpdate(stale, [ABRAR])
    expect(draft.done[0].task).toMatchObject({ id: 'task-gone', title: null })
    expect(draftToPayload(draft)[0].task_id).toBe('task-gone')
  })

  it('does not carry a mention of someone who has left', () => {
    const submitted = update('abrar', [
      item({ content: 'Asked @Removed Person', mentionedUserIds: ['gone'] }),
    ])
    expect(draftFromUpdate(submitted, [ABRAR]).done[0].mentions).toEqual([])
  })
})

describe('reading the server answer', () => {
  it('reads an update with resolved tasks and mentions', () => {
    const [read] = readUpdates([
      {
        id: 'u-1',
        user_id: 'abrar',
        report_date: '2026-09-20',
        submitted_at: '2026-09-20T09:42:00Z',
        edited_at: '2026-09-20T10:15:00Z',
        items: [
          {
            id: 'i-1',
            type: 'done',
            content: 'Finished onboarding copy',
            position: 0,
            task_id: 'task-sub',
            task: {
              id: 'task-sub',
              title: 'Finish onboarding copy',
              status: 'working',
              kind: 'goal_subtask',
              goal_id: 'g-1',
              goal_name: 'Launch Product',
              parent_task_id: 'task-parent',
              parent_title: 'Build the onboarding flow',
            },
            mentioned_user_ids: ['iqra'],
          },
        ],
      },
    ])
    expect(read.editedAt).toBe('2026-09-20T10:15:00Z')
    const [first] = read.items
    expect(first.task).toMatchObject({
      kind: 'goal_subtask',
      goalName: 'Launch Product',
      parentTitle: 'Build the onboarding flow',
    })
    expect(first.mentionedUserIds).toEqual(['iqra'])
  })

  it('survives null, missing and malformed content without throwing', () => {
    expect(readUpdates(null)).toEqual([])
    expect(readUpdates({ not: 'a list' })).toEqual([])
    expect(readUpdates([null, 5, 'x', {}, { id: 'u', user_id: 'a' }])).toEqual(
      [],
    )
    const [read] = readUpdates([
      {
        id: 'u-1',
        user_id: 'abrar',
        report_date: '2026-09-20',
        submitted_at: '2026-09-20T09:42:00Z',
        items: [
          null,
          { id: 'i-1', type: 'done', content: null },
          { id: 'i-2', type: 'done', content: '   ' },
          { id: 'i-3', type: 'bogus', content: 'x' },
          {
            id: 'i-4',
            type: 'done',
            content: 'Good',
            task: 'not-an-object',
            mentioned_user_ids: [1, 'iqra'],
          },
        ],
      },
    ])
    expect(read.items).toHaveLength(1)
    expect(read.items[0].content).toBe('Good')
    expect(read.items[0].task).toBeNull()
    expect(read.items[0].mentionedUserIds).toEqual(['iqra'])
    expect(read.editedAt).toBeNull()
  })

  it('reads a null `items` as an update with no items', () => {
    const [read] = readUpdates([
      {
        id: 'u',
        user_id: 'a',
        report_date: '2026-09-20',
        submitted_at: '2026-09-20T09:00:00Z',
        items: null,
      },
    ])
    expect(read.items).toEqual([])
  })

  it('orders each section by position', () => {
    const shuffled = update('abrar', [
      item({ id: 'b', position: 1, content: 'Second' }),
      item({ id: 'a', position: 0, content: 'First' }),
      item({ id: 'n', type: 'next', position: 0, content: 'Later' }),
    ])
    expect(itemsOfType(shuffled, 'done').map(i => i.content)).toEqual([
      'First',
      'Second',
    ])
    expect(itemsOfType(shuffled, 'blocker')).toEqual([])
  })
})

describe('task references', () => {
  it('reads as available, unavailable (deleted) or none', () => {
    expect(referenceOf(item())).toBeNull()
    expect(referenceOf(item({ taskId: 'gone', task: null }))).toEqual({
      state: 'unavailable',
    })
    expect(
      referenceOf(
        item({
          taskId: 't',
          task: {
            id: 't',
            title: 'Slack Integration',
            status: 'completed',
            kind: 'goal_task',
            goalId: 'g',
            goalName: 'Launch Product',
            parentTaskId: null,
            parentTitle: null,
          },
        }),
      ),
    ).toMatchObject({
      state: 'available',
      title: 'Slack Integration',
      goalName: 'Launch Product',
      kind: 'goal_task',
    })
  })

  it('links into the existing task view, not a second detail page', () => {
    expect(taskHref('design-team', 'task 1')).toBe(
      '/workspaces/design-team?task=task%201',
    )
  })
})

describe('who the page lists', () => {
  it('lists EVERY member, reported or not', () => {
    const day = buildDay(
      [ABRAR, IQRA, ARAYSH],
      [update('abrar'), update('iqra')],
      'abrar',
    )
    expect(day.map(entry => entry.member.userId)).toEqual([
      'abrar',
      'iqra',
      'araysh',
    ])
    expect(
      day.find(entry => entry.member.userId === 'araysh')?.update,
    ).toBeNull()
  })

  it('counts who reported without scoring anyone', () => {
    const day = buildDay([ABRAR, IQRA, ARAYSH], [update('abrar')], 'abrar')
    expect(summarizeDay(day)).toEqual({ reported: 1, notReported: 2, total: 3 })
    expect(summarizeDay([])).toEqual({ reported: 0, notReported: 0, total: 0 })
  })

  it('leaves out an update by someone who is no longer a member', () => {
    const day = buildDay([ABRAR], [update('abrar'), update('left')], 'abrar')
    expect(day).toHaveLength(1)
    expect(summarizeDay(day).reported).toBe(1)
  })

  it('puts you first, then the owner, then by joining -- whatever order they arrive in', () => {
    const expected = ['iqra', 'abrar', 'araysh']
    for (const arrival of [
      [ABRAR, IQRA, ARAYSH],
      [ARAYSH, IQRA, ABRAR],
      [IQRA, ARAYSH, ABRAR],
    ]) {
      expect(orderMembers(arrival, 'iqra').map(m => m.userId)).toEqual(expected)
    }
  })

  it('breaks a tie by name, then id, so two identical names never swap', () => {
    const a = member('u-a', 'Sam Lee', { joinedAt: '2026-02-01T00:00:00Z' })
    const b = member('u-b', 'Sam Lee', { joinedAt: '2026-02-01T00:00:00Z' })
    expect(orderMembers([b, a], 'me').map(m => m.userId)).toEqual([
      'u-a',
      'u-b',
    ])
    expect(orderMembers([a, b], 'me').map(m => m.userId)).toEqual([
      'u-a',
      'u-b',
    ])
  })

  it('does not reorder when someone submits (the order ignores who reported)', () => {
    const before = buildDay([ABRAR, IQRA, ARAYSH], [], 'abrar').map(
      e => e.member.userId,
    )
    const after = buildDay(
      [ABRAR, IQRA, ARAYSH],
      [update('araysh')],
      'abrar',
    ).map(e => e.member.userId)
    expect(after).toEqual(before)
  })
})

describe('the workspace-local day', () => {
  it('is today in the workspace timezone, not the reader’s', () => {
    // 2026-09-20 02:00 UTC is still 19 Sep in Los Angeles and already 20 Sep in Karachi.
    const instant = new Date('2026-09-20T02:00:00Z')
    expect(workspaceToday('UTC', instant)).toBe('2026-09-20')
    expect(workspaceToday('America/Los_Angeles', instant)).toBe('2026-09-19')
    expect(workspaceToday('Asia/Karachi', instant)).toBe('2026-09-20')
  })

  it('falls back to UTC for a timezone it does not know', () => {
    expect(workspaceToday('Not/AZone', new Date('2026-09-20T02:00:00Z'))).toBe(
      '2026-09-20',
    )
    expect(workspaceToday('', new Date('2026-09-20T02:00:00Z'))).toBe(
      '2026-09-20',
    )
  })

  it('moves between days across month and year ends', () => {
    expect(shiftDay('2026-09-20', -1)).toBe('2026-09-19')
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('formats a day as itself, unshifted by any timezone', () => {
    expect(formatDay('2026-09-20')).toBe('September 20, 2026')
    expect(formatDay('2026-01-01')).toBe('January 1, 2026')
  })

  it('validates a day', () => {
    expect(isValidDay('2026-09-20')).toBe(true)
    expect(isValidDay('2026-02-30')).toBe(false)
    expect(isValidDay('20-09-2026')).toBe(false)
  })

  it('says when it was submitted, and updated only if it was changed', () => {
    expect(submissionLabels(update('abrar'))).toEqual([
      expect.stringMatching(/^Submitted at \d{1,2}:\d{2}/),
    ])
    const edited = submissionLabels(
      update('abrar', [item()], { editedAt: '2026-09-20T10:15:00Z' }),
    )
    expect(edited).toHaveLength(2)
    expect(edited[1]).toMatch(/^Updated at \d{1,2}:\d{2}/)
  })
})

describe('mentions inside an item', () => {
  it('marks a tagged member’s @Name and leaves the rest as text', () => {
    expect(
      mentionSegments('Waiting for Stripe credentials — @Iqra Nadeem, thanks', [
        IQRA,
      ]),
    ).toEqual([
      { text: 'Waiting for Stripe credentials — ', mention: false },
      { text: '@Iqra Nadeem', mention: true },
      { text: ', thanks', mention: false },
    ])
  })

  it('shows the words plainly when the tagged person is no longer a member', () => {
    expect(mentionSegments('Asked @Removed Person', [])).toEqual([
      { text: 'Asked @Removed Person', mention: false },
    ])
  })

  it('does not treat a name typed without a tag as a mention', () => {
    expect(mentionSegments('Iqra will help', [])).toEqual([
      { text: 'Iqra will help', mention: false },
    ])
  })
})

describe('the local draft', () => {
  const store = () => {
    const data = new Map<string, string>()
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    }
  }
  const key = draftStorageKey('abrar', 'ws-1', '2026-09-20')

  it('is kept per person, workspace and day', () => {
    expect(
      new Set([
        draftStorageKey('abrar', 'ws-1', '2026-09-20'),
        draftStorageKey('iqra', 'ws-1', '2026-09-20'),
        draftStorageKey('abrar', 'ws-2', '2026-09-20'),
        draftStorageKey('abrar', 'ws-1', '2026-09-21'),
      ]).size,
    ).toBe(4)
  })

  it('round-trips what was typed, tasks and mentions included', () => {
    const storage = store()
    const draft = draftOf({ blocker: ['Waiting on @Iqra Nadeem'] })
    draft.blocker[0].mentions = [
      { userId: 'iqra', label: 'Iqra Nadeem', start: 11, end: 23 },
    ]
    draft.blocker[0].task = {
      id: 'task-pay',
      title: 'Payment Integration',
      kind: 'task',
      status: 'queued',
      goalName: null,
      parentTitle: null,
    }
    saveDraft(key, draft, storage)
    const loaded = loadDraft(key, [ABRAR, IQRA], storage)!
    expect(draftToPayload(loaded)).toEqual(draftToPayload(draft))
  })

  it('is never "submitted": it only ever lives in storage', () => {
    const storage = store()
    saveDraft(key, draftOf({ done: ['Half typed'] }), storage)
    expect(storage.data.size).toBe(1) // nothing else was written anywhere
  })

  it('leaves nothing behind for an empty draft, and clears on request', () => {
    const storage = store()
    saveDraft(key, draftOf({ done: ['x'] }), storage)
    saveDraft(key, emptyDraft(), storage)
    expect(storage.data.size).toBe(0)
    saveDraft(key, draftOf({ done: ['x'] }), storage)
    clearDraft(key, storage)
    expect(loadDraft(key, [ABRAR], storage)).toBeNull()
  })

  it('drops mentions of people who are no longer members', () => {
    const storage = store()
    const draft = draftOf({ blocker: ['Asked @Iqra Nadeem'] })
    draft.blocker[0].mentions = [
      { userId: 'iqra', label: 'Iqra Nadeem', start: 6, end: 18 },
    ]
    saveDraft(key, draft, storage)
    expect(loadDraft(key, [ABRAR], storage)!.blocker[0].mentions).toEqual([])
  })

  it('ignores a corrupt or foreign draft', () => {
    const storage = store()
    for (const bad of [
      '{not json',
      '[]',
      '"x"',
      '{"done":"nope"}',
      '{"done":[{"text":5}]}',
    ]) {
      storage.setItem(key, bad)
      expect(loadDraft(key, [ABRAR], storage)).toBeNull()
    }
  })

  it('works without storage at all (private window, blocked site data)', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => saveDraft(key, draftOf({ done: ['x'] }), broken)).not.toThrow()
    expect(() => clearDraft(key, broken)).not.toThrow()
    expect(loadDraft(key, [ABRAR], broken)).toBeNull()
    expect(loadDraft(key, [ABRAR], null)).toBeNull()
    expect(() => saveDraft(key, draftOf({ done: ['x'] }), null)).not.toThrow()
  })
})

describe('the task picker rows', () => {
  it('reads suggestions and drops malformed ones', () => {
    const rows = readCandidates([
      {
        task_id: 't-1',
        title: 'Build onboarding',
        status: 'queued',
        kind: 'goal_task',
        goal_id: 'g',
        goal_name: 'Launch Product',
        parent_task_id: null,
        parent_title: null,
        assigned_to: 'abrar',
        reason: 'assigned',
      },
      { task_id: 't-2', title: '   ' },
      null,
      { title: 'no id' },
      {
        task_id: 't-3',
        title: 'Odd',
        status: 'weird',
        kind: 'weird',
        reason: 'weird',
      },
    ])
    expect(rows.map(r => r.taskId)).toEqual(['t-1', 't-3'])
    expect(rows[0]).toMatchObject({
      kind: 'goal_task',
      goalName: 'Launch Product',
      reason: 'assigned',
    })
    expect(rows[1]).toMatchObject({
      status: 'queued',
      kind: 'task',
      reason: 'worked_on',
    })
    expect(readCandidates(undefined)).toEqual([])
  })
})
