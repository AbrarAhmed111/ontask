import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, settle } from '@/test/renderHook'
import { fakeSupabase, stubBrowser } from '@/test/fakeSupabase'
import { useDailyUpdates, useTaskCandidates } from '@/hooks/useDailyUpdates'

vi.mock('@/lib/supabase/client', async () => {
  const { fakeSupabase: fake } = await import('@/test/fakeSupabase')
  return { createClient: () => fake.client }
})

const ME = 'user-me'
const user = {
  id: ME,
  email: 'me@example.com',
  fullName: 'Me',
  avatarUrl: null,
}
const DAY = '2026-09-20'

const row = (
  id: string,
  userId: string,
  content = 'Completed Slack integration',
) => ({
  id,
  user_id: userId,
  report_date: DAY,
  submitted_at: '2026-09-20T09:42:00Z',
  edited_at: null,
  items: [
    {
      id: `${id}-1`,
      type: 'done',
      content,
      position: 0,
      task_id: null,
      task: null,
      mentioned_user_ids: [],
    },
  ],
})

const reads = () =>
  fakeSupabase.rpcCalls.filter(call => call.name === 'get_daily_updates')

describe('useDailyUpdates', () => {
  beforeEach(() => {
    fakeSupabase.reset()
    stubBrowser()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reads the day through get_daily_updates for this workspace and date', async () => {
    fakeSupabase.onRpc('get_daily_updates', () => ({
      error: null,
      data: [row('u-1', 'abrar')],
    }))
    const { result } = renderHook(
      ({ day }) => useDailyUpdates('ws-1', user, day, true),
      { day: DAY },
    )
    expect(result.current.ready).toBe(false)
    await settle()

    expect(reads()).toEqual([
      {
        name: 'get_daily_updates',
        args: { p_workspace_id: 'ws-1', p_report_date: DAY },
      },
    ])
    expect(result.current.ready).toBe(true)
    expect(result.current.updates.map(u => u.userId)).toEqual(['abrar'])
    expect(result.current.updates[0].items[0].content).toBe(
      'Completed Slack integration',
    )
  })

  it('reads nothing while disabled (a personal workspace, or the workspace not loaded)', async () => {
    const { result } = renderHook(
      ({ enabled }) => useDailyUpdates('ws-1', user, DAY, enabled),
      { enabled: false },
    )
    await settle()
    expect(reads()).toHaveLength(0)
    expect(result.current.updates).toEqual([])
    expect(result.current.ready).toBe(true) // nothing to wait for
  })

  it('shows a member’s update without a refresh when the database says it was submitted', async () => {
    let data = [row('u-1', 'abrar')]
    fakeSupabase.onRpc('get_daily_updates', () => ({ error: null, data }))
    const { result } = renderHook(
      () => useDailyUpdates('ws-1', user, DAY, true),
      {},
    )
    await settle()
    expect(result.current.updates.map(u => u.userId)).toEqual(['abrar'])

    // Iqra submits: Not Reported -> Reported for everyone watching.
    data = [row('u-1', 'abrar'), row('u-2', 'iqra')]
    act(() => {
      fakeSupabase.emit('daily_updates', {
        eventType: 'INSERT',
        new: { id: 'u-2', report_date: DAY },
      })
    })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    await settle()

    expect(reads()).toHaveLength(2)
    expect(result.current.updates.map(u => u.userId)).toEqual(['abrar', 'iqra'])
  })

  it('turns a burst of events (an edit rewrites the update and its items) into one read', async () => {
    fakeSupabase.onRpc('get_daily_updates', () => ({ error: null, data: [] }))
    renderHook(() => useDailyUpdates('ws-1', user, DAY, true), {})
    await settle()
    expect(reads()).toHaveLength(1)

    act(() => {
      fakeSupabase.emit('daily_updates', { new: { report_date: DAY } })
      fakeSupabase.emit('daily_update_items', { new: { id: 'i-1' } })
      fakeSupabase.emit('daily_update_items', { new: { id: 'i-2' } })
    })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    await settle()
    expect(reads()).toHaveLength(2)
  })

  it('ignores an update for another day', async () => {
    fakeSupabase.onRpc('get_daily_updates', () => ({ error: null, data: [] }))
    renderHook(() => useDailyUpdates('ws-1', user, DAY, true), {})
    await settle()

    act(() => {
      fakeSupabase.emit('daily_updates', {
        new: { report_date: '2026-09-19' },
        old: { report_date: '2026-09-19' },
      })
    })
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    await settle()
    expect(reads()).toHaveLength(1)
  })

  it('reads again when the tab comes back or the network returns', async () => {
    const browser = stubBrowser()
    fakeSupabase.onRpc('get_daily_updates', () => ({ error: null, data: [] }))
    renderHook(() => useDailyUpdates('ws-1', user, DAY, true), {})
    await settle()
    act(() => browser.fire('visibilitychange'))
    act(() => browser.fire('online'))
    await settle()
    expect(reads()).toHaveLength(3)
  })

  it('shows a loading state, not the previous day, when the day changes', async () => {
    fakeSupabase.onRpc('get_daily_updates', args => ({
      error: null,
      data:
        args.p_report_date === DAY
          ? [row('u-1', 'abrar')]
          : [row('u-9', 'iqra', 'Yesterday')],
    }))
    const { result, rerender, renders } = renderHook(
      ({ day }) => useDailyUpdates('ws-1', user, day, true),
      { day: DAY },
    )
    await settle()
    expect(result.current.updates[0].userId).toBe('abrar')

    rerender({ day: '2026-09-19' })
    expect(result.current.ready).toBe(false)
    expect(result.current.updates).toEqual([]) // never yesterday's cards under today's date
    await settle()
    expect(result.current.updates[0].items[0].content).toBe('Yesterday')
    // at no point were the old day's updates shown for the new day
    const badRender = renders.find(
      r => r.ready && r.updates[0]?.userId === 'abrar' && r !== renders[1],
    )
    expect(badRender).toBeUndefined()
  })

  it('drops a slow answer for a day the member has already left', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    fakeSupabase.onRpc('get_daily_updates', async args => {
      if (args.p_report_date === DAY) {
        await gate
        return {
          error: null,
          data: [row('u-1', 'abrar', 'Slow answer for the old day')],
        }
      }
      return {
        error: null,
        data: [row('u-2', 'iqra', 'Fast answer for the new day')],
      }
    })
    const { result, rerender } = renderHook(
      ({ day }) => useDailyUpdates('ws-1', user, day, true),
      { day: DAY },
    )
    rerender({ day: '2026-09-19' })
    await settle()
    release()
    await settle()
    expect(result.current.updates.map(u => u.userId)).toEqual(['iqra'])
  })

  it('drops an older read that finishes after a newer one for the same day', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let calls = 0
    fakeSupabase.onRpc('get_daily_updates', async () => {
      calls += 1
      if (calls === 1) {
        await gate // the first read is slow...
        return { error: null, data: [row('u-1', 'abrar', 'Stale answer')] }
      }
      return { error: null, data: [row('u-2', 'iqra', 'Fresh answer')] }
    })
    const { result } = renderHook(
      () => useDailyUpdates('ws-1', user, DAY, true),
      {},
    )
    // ...and while it is in flight the database reports a change: a second read
    act(() => {
      fakeSupabase.emit('daily_updates', { new: { report_date: DAY } })
    })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    await settle()
    expect(result.current.updates.map(u => u.userId)).toEqual(['iqra'])

    release() // the old answer lands last and must not win
    await settle()
    expect(result.current.updates.map(u => u.userId)).toEqual(['iqra'])
    expect(result.current.updates[0].items[0].content).toBe('Fresh answer')
  })

  it('says so when the read fails, and keeps what was on screen', async () => {
    let fail = false
    fakeSupabase.onRpc('get_daily_updates', () =>
      fail
        ? { error: { message: 'Failed to fetch' } }
        : { error: null, data: [row('u-1', 'abrar')] },
    )
    const { result } = renderHook(
      () => useDailyUpdates('ws-1', user, DAY, true),
      {},
    )
    await settle()
    fail = true
    act(() => {
      fakeSupabase.emit('daily_updates', { new: { report_date: DAY } })
    })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    await settle()
    expect(result.current.error).toMatch(/couldn't load daily updates/i)
    expect(result.current.updates.map(u => u.userId)).toEqual(['abrar'])
  })

  it('a first read that fails is an error with nothing to show, not an empty day', async () => {
    fakeSupabase.onRpc('get_daily_updates', () => ({
      error: { message: 'Failed to fetch' },
    }))
    const { result } = renderHook(
      () => useDailyUpdates('ws-1', user, DAY, true),
      {},
    )
    await settle()
    expect(result.current.error).not.toBeNull()
    expect(result.current.updates).toEqual([])
  })

  it('submits the items to the server for this workspace and day, then re-reads', async () => {
    fakeSupabase.onRpc('get_daily_updates', () => ({ error: null, data: [] }))
    fakeSupabase.onRpc('submit_daily_update', () => ({ error: null, data: {} }))
    const { result } = renderHook(
      () => useDailyUpdates('ws-1', user, DAY, true),
      {},
    )
    await settle()

    const items = [
      {
        type: 'done' as const,
        content: 'Completed Slack integration',
        task_id: 'task-slack',
        mentioned_user_ids: [],
      },
    ]
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.submit(items)
    })
    await settle()

    expect(outcome).toEqual({ success: true })
    const submit = fakeSupabase.rpcCalls.find(
      c => c.name === 'submit_daily_update',
    )
    expect(submit?.args).toEqual({
      p_workspace_id: 'ws-1',
      p_report_date: DAY,
      p_items: items,
    })
    expect(reads()).toHaveLength(2) // the result shown is the server's answer
  })

  it('reports the server’s reason when a submission is refused', async () => {
    fakeSupabase.onRpc('get_daily_updates', () => ({ error: null, data: [] }))
    fakeSupabase.onRpc('submit_daily_update', () => ({
      error: { message: 'a referenced task does not belong to this workspace' },
    }))
    const { result } = renderHook(
      () => useDailyUpdates('ws-1', user, DAY, true),
      {},
    )
    await settle()
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.submit([
        {
          type: 'done',
          content: 'x',
          task_id: 'other-ws',
          mentioned_user_ids: [],
        },
      ])
    })
    expect(outcome).toEqual({
      success: false,
      error: 'a referenced task does not belong to this workspace',
    })
    expect(reads()).toHaveLength(1) // nothing to re-read: nothing changed
  })
})

describe('useTaskCandidates', () => {
  beforeEach(() => {
    fakeSupabase.reset()
    stubBrowser()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const candidateRow = (id: string, title: string) => ({
    task_id: id,
    title,
    status: 'queued',
    kind: 'task',
    goal_id: null,
    goal_name: null,
    parent_task_id: null,
    parent_title: null,
    assigned_to: ME,
    reason: 'assigned',
  })

  it('asks the server for the section’s suggestions, limited, and nothing while closed', async () => {
    fakeSupabase.onRpc('daily_update_task_candidates', () => ({
      error: null,
      data: [candidateRow('t-1', 'Slack Notification Preferences')],
    }))
    const { result, rerender } = renderHook(
      ({ open }) => useTaskCandidates('ws-1', 'next', '', open),
      { open: false },
    )
    await settle()
    expect(fakeSupabase.rpcCalls).toHaveLength(0)

    rerender({ open: true })
    await act(async () => {
      vi.advanceTimersByTime(0)
    })
    await settle()
    expect(fakeSupabase.rpcCalls[0]).toEqual({
      name: 'daily_update_task_candidates',
      args: {
        p_workspace_id: 'ws-1',
        p_item_type: 'next',
        p_query: '',
        p_limit: 12,
      },
    })
    expect(result.current.candidates.map(c => c.title)).toEqual([
      'Slack Notification Preferences',
    ])
    expect(result.current.loading).toBe(false)
  })

  it('waits for a pause in typing, then searches once', async () => {
    fakeSupabase.onRpc('daily_update_task_candidates', args => ({
      error: null,
      data: [candidateRow('t-2', `Match for ${args.p_query}`)],
    }))
    const { result, rerender } = renderHook(
      ({ query }) => useTaskCandidates('ws-1', 'done', query, true),
      { query: '' },
    )
    await act(async () => {
      vi.advanceTimersByTime(0)
    })
    await settle()
    const before = fakeSupabase.rpcCalls.length

    for (const query of ['s', 'sl', 'sla']) rerender({ query })
    expect(fakeSupabase.rpcCalls).toHaveLength(before) // nothing yet: still typing
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    await settle()

    expect(fakeSupabase.rpcCalls).toHaveLength(before + 1)
    expect(fakeSupabase.rpcCalls.at(-1)?.args.p_query).toBe('sla')
    expect(result.current.candidates[0].title).toBe('Match for sla')
  })

  it('says so when the suggestions cannot be loaded', async () => {
    fakeSupabase.onRpc('daily_update_task_candidates', () => ({
      error: { message: 'boom' },
    }))
    const { result } = renderHook(
      () => useTaskCandidates('ws-1', 'blocker', '', true),
      {},
    )
    await act(async () => {
      vi.advanceTimersByTime(0)
    })
    await settle()
    expect(result.current.error).toMatch(/couldn't load tasks/i)
    expect(result.current.candidates).toEqual([])
  })
})
