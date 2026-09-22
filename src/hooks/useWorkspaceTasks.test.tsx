import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, settle } from '@/test/renderHook'
import {
  fakeSupabase,
  omitGuardedCompletion,
  serveGuardedCompletion,
  stubBrowser,
} from '@/test/fakeSupabase'
import { useWorkspaceTasks } from '@/hooks/useWorkspaceTasks'
import { clearAllCache, writeCache } from '@/lib/cache/cacheStore'
import {
  TaskCollaboratorRow,
  WorkspaceTaskRow,
  rowToTask,
} from '@/lib/tasks/workspaceMappers'
import type { WorkspaceTask } from '@/types/workspace'

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
const NOW = Date.parse('2026-09-19T12:00:00Z')
const MINUTE = 60_000
const COMPLETE = 'complete_workspace_task'
const GUARDED = 'auto_complete_workspace_task'

// Every test gets a task (and so a timer run) nobody else has used: the
// "already sent" memory is deliberately kept for the whole browser session.
let sequence = 0
function runningTask(
  overrides: Partial<WorkspaceTaskRow> & { startedMinutesAgo?: number } = {},
): WorkspaceTaskRow {
  sequence += 1
  const { startedMinutesAgo = 90, ...rest } = overrides
  return {
    id: `task-${sequence}`,
    workspace_id: 'ws-1',
    parent_task_id: null,
    goal_id: null,
    created_by: ME,
    assigned_to: ME,
    title: `Task ${sequence}`,
    planned_seconds: 60 * 60,
    actual_seconds: 0,
    status: 'working',
    progress_label: null,
    progress_percentage: null,
    started_at: new Date(
      NOW - startedMinutesAgo * MINUTE + sequence,
    ).toISOString(),
    completed_at: null,
    ...rest,
  }
}

const paused = (row: WorkspaceTaskRow): WorkspaceTaskRow => ({
  ...row,
  status: 'paused',
  started_at: null,
  actual_seconds: 1800,
})

const completions = () =>
  fakeSupabase.rpcCalls.filter(call => call.name === COMPLETE)
const guardedCalls = () =>
  fakeSupabase.rpcCalls.filter(call => call.name === GUARDED)
const taskReads = () =>
  fakeSupabase.reads.filter(r => r.table === 'workspace_tasks' && r.single)

let browser: ReturnType<typeof stubBrowser>
let onComplete: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
    ],
  })
  vi.setSystemTime(NOW)
  browser = stubBrowser()
  fakeSupabase.reset()
  omitGuardedCompletion(fakeSupabase) // a database without migration 0043
  await clearAllCache()
  onComplete = vi.fn()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const mount = () =>
  renderHook(() => useWorkspaceTasks('ws-1', user, [], onComplete, false), {})

// The timer ticks once a second; let the effects it triggers (a server read,
// an RPC) run to completion.
async function tick(ms = 1000) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await settle()
}

const seedCache = (rows: WorkspaceTaskRow[], userId = ME) =>
  writeCache(userId, 'tasks', 'ws-1', rows.map(rowToTask), 'ws-1')

const statusOf = (tasks: WorkspaceTask[], id: string) =>
  tasks.find(t => t.id === id)?.status

const collaboratorRow = (
  taskId: string,
  userId: string,
): TaskCollaboratorRow => ({
  id: `${taskId}:${userId}`,
  task_id: taskId,
  workspace_id: 'ws-1',
  user_id: userId,
  participation_status: 'queued',
  started_at: null,
  completed_at: null,
  removed_at: null,
})

describe('useWorkspaceTasks: cached data renders, but never triggers completion', () => {
  it('shows a cached overdue running task immediately, without waiting for the server', async () => {
    const row = runningTask()
    await seedCache([row])
    fakeSupabase.setRows('workspace_tasks', [row])
    fakeSupabase.hold('workspace_tasks') // the server has not answered

    const hook = mount()
    await settle()

    expect(hook.result.current.tasks.map(t => t.id)).toEqual([row.id])
    // No skeleton over content that is already known.
    expect(hook.result.current.ready).toBe(true)
  })

  it('completes nothing, and does not even look at the task, while only the cache has answered', async () => {
    const row = runningTask()
    await seedCache([row])
    fakeSupabase.setRows('workspace_tasks', [row])
    fakeSupabase.hold('workspace_tasks')
    const hook = mount()
    await settle()

    await tick(5000)

    expect(hook.result.current.tasks[0].status).toBe('working')
    expect(completions()).toHaveLength(0)
    expect(taskReads()).toHaveLength(0)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('once Supabase confirms it is still running and overdue, completes it -- exactly once', async () => {
    const row = runningTask()
    await seedCache([row])
    fakeSupabase.setRows('workspace_tasks', [row])
    const release = fakeSupabase.hold('workspace_tasks')
    const hook = mount()
    await settle()
    await tick(3000)
    expect(completions()).toHaveLength(0)

    release() // the server answers: same task, still working, still overdue
    await settle()
    await tick(1000)
    await tick(5000)

    expect(completions()).toEqual([
      { name: COMPLETE, args: { p_task_id: row.id, p_skip: false } },
    ])
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('completed')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('completes nothing when the server says the task was paused on another device', async () => {
    const row = runningTask()
    await seedCache([row])
    fakeSupabase.setRows('workspace_tasks', [paused(row)])
    const release = fakeSupabase.hold('workspace_tasks')
    const hook = mount()
    await settle()
    await tick(3000)

    release()
    await settle()
    await tick(10_000)

    expect(completions()).toHaveLength(0)
    expect(onComplete).not.toHaveBeenCalled()
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('paused')
  })

  it('completes nothing when the server says its planned time was extended', async () => {
    const row = runningTask()
    await seedCache([row])
    fakeSupabase.setRows('workspace_tasks', [
      { ...row, planned_seconds: 4 * 3600 },
    ])
    const hook = mount()
    await settle()

    await tick(10_000)

    expect(completions()).toHaveLength(0)
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')
  })

  it('does not complete a cached task the server no longer has', async () => {
    const row = runningTask()
    await seedCache([row])
    fakeSupabase.setRows('workspace_tasks', []) // deleted elsewhere
    const hook = mount()
    await settle()

    await tick(10_000)

    expect(completions()).toHaveLength(0)
    expect(hook.result.current.tasks).toEqual([])
  })

  it('does nothing for a cached running task that still has time left', async () => {
    const row = runningTask({ startedMinutesAgo: 10 })
    await seedCache([row])
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    await settle()

    await tick(10_000)

    expect(completions()).toHaveLength(0)
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')
  })
})

describe('useWorkspaceTasks: current data keeps the existing behavior', () => {
  it('cold start: with nothing cached, a running overdue task fetched from the server is completed', async () => {
    const row = runningTask()
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    expect(hook.result.current.ready).toBe(false) // the existing loading state

    await settle()
    await tick(1000)

    expect(hook.result.current.ready).toBe(true)
    expect(completions()).toHaveLength(1)
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('completed')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('only the timer’s own controller completes it', async () => {
    const row = runningTask({ assigned_to: 'someone-else' })
    fakeSupabase.setRows('workspace_tasks', [row])
    mount()
    await settle()

    await tick(10_000)

    expect(completions()).toHaveLength(0)
  })

  it('a task that runs out while the workspace is open is completed when it does', async () => {
    const row = runningTask({ startedMinutesAgo: 59 })
    fakeSupabase.setRows('workspace_tasks', [row])
    mount()
    await settle()
    await tick(30_000)
    expect(completions()).toHaveLength(0)

    await tick(45_000) // now past the hour

    expect(completions()).toHaveLength(1)
  })
})

describe('useWorkspaceTasks: refetches, realtime and remounts cannot complete it twice', () => {
  it('keeps collaborators when a task-row realtime update arrives first', async () => {
    const row = runningTask({ status: 'queued', started_at: null })
    fakeSupabase.setRows('workspace_tasks', [row])
    fakeSupabase.setRows('task_collaborators', [
      collaboratorRow(row.id, ME),
      collaboratorRow(row.id, 'user-two'),
    ])
    const hook = mount()
    await settle()

    expect(
      hook.result.current.tasks[0].collaborators?.map(c => c.userId),
    ).toEqual([ME, 'user-two'])

    act(() =>
      fakeSupabase.emit('workspace_tasks', {
        eventType: 'UPDATE',
        new: { ...row, title: 'Renamed task' },
      }),
    )

    expect(hook.result.current.tasks[0].name).toBe('Renamed task')
    expect(
      hook.result.current.tasks[0].collaborators?.map(c => c.userId),
    ).toEqual([ME, 'user-two'])
  })

  it('confirms against the server at the moment of acting, not only the list', async () => {
    // A minute of time left when the list is read...
    const row = runningTask({ startedMinutesAgo: 59 })
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    await settle()
    // ...and before it runs out, another device pauses it while this tab misses
    // the realtime event (a dropped socket): the list still says "working".
    fakeSupabase.setRows('workspace_tasks', [paused(row)])
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')

    await tick(90_000) // the timer, as this tab sees it, runs out

    expect(taskReads().length).toBeGreaterThan(0)
    expect(completions()).toHaveLength(0)
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('paused')
  })

  it('a refetch that raced the commit and still shows the task working does not complete it again', async () => {
    const row = runningTask()
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    await settle()
    await tick(1000)
    expect(completions()).toHaveLength(1)

    // The tab regains focus; the list read returns the row as it was before the
    // completion committed, so the list shows a running, overdue task again.
    browser.fire('visibilitychange')
    await settle()
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')
    await tick(10_000)

    expect(completions()).toHaveLength(1)
  })

  it('a realtime event showing the same run does not complete it again', async () => {
    const row = runningTask()
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    await settle()
    await tick(1000)
    expect(completions()).toHaveLength(1)

    act(() =>
      fakeSupabase.emit('workspace_tasks', { eventType: 'UPDATE', new: row }),
    )
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')
    await tick(10_000)

    expect(completions()).toHaveLength(1)
  })

  it('a realtime event for the completion itself is simply applied', async () => {
    const row = runningTask()
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    await settle()
    await tick(1000)

    act(() =>
      fakeSupabase.emit('workspace_tasks', {
        eventType: 'UPDATE',
        new: { ...row, status: 'completed', started_at: null },
      }),
    )
    await tick(10_000)

    expect(completions()).toHaveLength(1)
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('completed')
  })

  it('a new instance (navigated away and back) cannot repeat a completion already sent', async () => {
    const row = runningTask()
    fakeSupabase.setRows('workspace_tasks', [row])
    const first = mount()
    await settle()
    await tick(1000)
    expect(completions()).toHaveLength(1)
    first.unmount()

    // Back again, before the server's own state has caught up: the list read
    // still returns the task running.
    const second = mount()
    await settle()
    await tick(10_000)

    expect(statusOf(second.result.current.tasks, row.id)).toBe('working')
    expect(completions()).toHaveLength(1)
  })

  it('a failed completion is reverted and reported, then retried once later -- alerting only once', async () => {
    const row = runningTask()
    fakeSupabase.setRows('workspace_tasks', [row])
    let attempt = 0
    fakeSupabase.onRpc(COMPLETE, () => {
      attempt += 1
      return { error: attempt === 1 ? { message: 'network' } : null }
    })
    const hook = mount()
    await settle()

    await tick(1000)
    expect(completions()).toHaveLength(1)
    expect(hook.result.current.error).toBe("Couldn't save task completion.")
    // Put back as the server has it, not left looking completed.
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')

    await tick(5000) // not hammered every second
    expect(completions()).toHaveLength(1)

    await tick(15_000) // after the retry delay
    expect(completions()).toHaveLength(2)
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('completed')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})

describe('useWorkspaceTasks: offline and account isolation', () => {
  it('offline with a cache: keeps the cached tasks, says they may be out of date, completes nothing', async () => {
    const row = runningTask()
    await seedCache([row])
    fakeSupabase.failReads('workspace_tasks', true)
    const hook = mount()
    await settle()

    await tick(10_000)

    expect(hook.result.current.tasks.map(t => t.id)).toEqual([row.id])
    expect(hook.result.current.ready).toBe(true)
    expect(hook.result.current.error).toMatch(/out-of-date/)
    expect(completions()).toHaveLength(0)
    // A network failure comes back before the disk read does. Not even for one
    // render may it be reported as "couldn't load" (there is a cached copy), or
    // be "ready" with an empty list that the cache is about to fill.
    for (const render of hook.renders) {
      expect(render.error).not.toBe("Couldn't load workspace tasks.")
      if (render.ready) expect(render.tasks.map(t => t.id)).toEqual([row.id])
    }
  })

  it('offline with no cache: the plain load error', async () => {
    fakeSupabase.failReads('workspace_tasks', true)
    const hook = mount()
    await settle()

    expect(hook.result.current.error).toBe("Couldn't load workspace tasks.")
    expect(hook.result.current.tasks).toEqual([])
  })

  it("never shows another account's cached tasks, on any render", async () => {
    const theirs = runningTask({ title: 'THEIR-SECRET-TASK' })
    await seedCache([theirs], 'user-other')
    fakeSupabase.setRows('workspace_tasks', [])
    fakeSupabase.hold('workspace_tasks')

    const hook = mount()
    await settle()
    await tick(5000)

    for (const render of hook.renders) {
      expect(render.tasks.map(t => t.name)).not.toContain('THEIR-SECRET-TASK')
    }
    expect(completions()).toHaveLength(0)
  })
})

// The same rules, on a database that has migration 0043: the database itself
// checks -- on its own clock, under the task's row lock -- that the task is still
// the run we saw and really out of time, so the app neither re-reads the task nor
// calls the unguarded RPC.
describe('useWorkspaceTasks: with the guarded completion (migration 0043)', () => {
  beforeEach(() => {
    serveGuardedCompletion(fakeSupabase)
  })

  it('cached data never reaches the database: not a single completion request while only the cache has answered', async () => {
    const row = runningTask()
    await seedCache([row])
    fakeSupabase.setRows('workspace_tasks', [row])
    fakeSupabase.hold('workspace_tasks')
    const hook = mount()
    await settle()

    await tick(10_000)

    expect(hook.result.current.tasks[0].status).toBe('working')
    expect(guardedCalls()).toHaveLength(0)
    expect(completions()).toHaveLength(0)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('once the server has confirmed the list, it asks the database once -- naming the run it saw -- and needs nothing else', async () => {
    const row = runningTask()
    const startedAt = row.started_at // the fake database changes this row when it completes it
    await seedCache([row])
    fakeSupabase.setRows('workspace_tasks', [row])
    const release = fakeSupabase.hold('workspace_tasks')
    const hook = mount()
    await settle()
    await tick(3000)
    expect(guardedCalls()).toHaveLength(0)

    release()
    await settle()
    await tick(1000)
    await tick(5000)

    expect(guardedCalls()).toEqual([
      {
        name: GUARDED,
        args: { p_task_id: row.id, p_expected_started_at: startedAt },
      },
    ])
    // No separate read of the task, and never the unguarded RPC.
    expect(taskReads()).toHaveLength(0)
    expect(completions()).toHaveLength(0)
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('completed')
    expect(onComplete).toHaveBeenCalledTimes(1)
    // The database really did it.
    expect(fakeSupabase.rowsOf('workspace_tasks')[0].status).toBe('completed')
  })

  it('cold start: a running overdue task fetched from the server is completed by the database', async () => {
    const row = runningTask()
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()

    await settle()
    await tick(1000)

    expect(guardedCalls()).toHaveLength(1)
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('completed')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("its clock decides, not the browser's: a database that is behind declines, and is asked again until it agrees", async () => {
    fakeSupabase.reset()
    serveGuardedCompletion(fakeSupabase, { clockOffsetMs: -120_000 })
    const row = runningTask({ startedMinutesAgo: 59 })
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    await settle()

    await tick(61_000) // the browser thinks it is up; the database, two minutes behind, does not
    expect(guardedCalls().length).toBeGreaterThanOrEqual(1)
    await tick(60_000)
    // Not shown as completed, not alerted, not completed -- however often it asked.
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')
    expect(onComplete).not.toHaveBeenCalled()
    expect(fakeSupabase.rowsOf('workspace_tasks')[0].status).toBe('working')
    // Asked again on a delay, not every tick.
    expect(guardedCalls().length).toBeLessThan(40)

    await tick(90_000) // the database's clock has now caught up
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('completed')
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(fakeSupabase.rowsOf('workspace_tasks')[0].status).toBe('completed')
  })

  it('a task paused on another device (a missed realtime event) is not completed, and the list is corrected from the reply', async () => {
    const row = runningTask({ startedMinutesAgo: 59 })
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    await settle()
    // Paused elsewhere after this tab read the list; this tab missed the event.
    fakeSupabase.setRows('workspace_tasks', [paused(row)])
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')

    await tick(90_000)

    expect(guardedCalls()).toHaveLength(1)
    expect(fakeSupabase.rowsOf('workspace_tasks')[0].status).toBe('paused')
    expect(onComplete).not.toHaveBeenCalled()
    expect(completions()).toHaveLength(0)
    // The refusal handed the current task back, so no second read was needed.
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('paused')
    expect(taskReads()).toHaveLength(0)
  })

  it('a task restarted elsewhere (a different run) is left running, and the list shows the new run', async () => {
    // A minute of time left when the list is read...
    const row = runningTask({ startedMinutesAgo: 59 })
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    await settle()
    // ...then, on another device, it is paused and started again: same task, a
    // new run that has plenty of time left. This tab missed the event.
    const restarted = {
      ...row,
      started_at: new Date(NOW - 5 * MINUTE).toISOString(),
      actual_seconds: 1800,
    }
    fakeSupabase.setRows('workspace_tasks', [restarted])

    await tick(90_000) // the old run, as this tab sees it, runs out

    expect(guardedCalls()).toHaveLength(1)
    expect(fakeSupabase.rowsOf('workspace_tasks')[0].status).toBe('working')
    expect(onComplete).not.toHaveBeenCalled()
    expect(completions()).toHaveLength(0)
    // The refusal handed back the run that is actually going.
    expect(hook.result.current.tasks[0].startedAt).toBe(
      Date.parse(String(restarted.started_at)),
    )
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')
  })

  it('a refetch that raced the commit and shows the task working again does not ask twice', async () => {
    const row = runningTask()
    const stale = { ...row }
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    await settle()
    await tick(1000)
    expect(guardedCalls()).toHaveLength(1)

    fakeSupabase.setRows('workspace_tasks', [stale]) // as it was before the commit
    browser.fire('visibilitychange')
    await settle()
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')
    await tick(10_000)

    expect(guardedCalls()).toHaveLength(1)
  })

  it('a realtime event showing the same run does not ask twice', async () => {
    const row = runningTask()
    const stale = { ...row }
    fakeSupabase.setRows('workspace_tasks', [row])
    mount()
    await settle()
    await tick(1000)
    expect(guardedCalls()).toHaveLength(1)

    act(() =>
      fakeSupabase.emit('workspace_tasks', { eventType: 'UPDATE', new: stale }),
    )
    await tick(10_000)

    expect(guardedCalls()).toHaveLength(1)
  })

  it('a new instance (navigated away and back) does not ask again for a run already completed', async () => {
    const row = runningTask()
    const stale = { ...row }
    fakeSupabase.setRows('workspace_tasks', [row])
    const first = mount()
    await settle()
    await tick(1000)
    first.unmount()

    fakeSupabase.setRows('workspace_tasks', [stale])
    const second = mount()
    await settle()
    await tick(10_000)

    expect(statusOf(second.result.current.tasks, row.id)).toBe('working')
    expect(guardedCalls()).toHaveLength(1)
  })

  it('a failed request is reported, nothing is shown as completed meanwhile, and it is retried later -- alerting once', async () => {
    fakeSupabase.reset()
    serveGuardedCompletion(fakeSupabase, { failTimes: 1 })
    const row = runningTask()
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    await settle()

    await tick(1000)
    expect(guardedCalls()).toHaveLength(1)
    expect(hook.result.current.error).toBe("Couldn't save task completion.")
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')
    expect(onComplete).not.toHaveBeenCalled()

    await tick(5000) // not hammered every second
    expect(guardedCalls()).toHaveLength(1)

    await tick(15_000)
    expect(guardedCalls()).toHaveLength(2)
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('completed')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('a reply it cannot understand is treated as a failure, never as a completion', async () => {
    fakeSupabase.onRpc(GUARDED, () => ({
      error: null,
      data: { unexpected: true },
    }))
    const row = runningTask()
    fakeSupabase.setRows('workspace_tasks', [row])
    const hook = mount()
    await settle()

    await tick(1000)

    expect(hook.result.current.error).toBe("Couldn't save task completion.")
    expect(statusOf(hook.result.current.tasks, row.id)).toBe('working')
    expect(onComplete).not.toHaveBeenCalled()
  })

  it("another member's timer is never sent to the database at all", async () => {
    const row = runningTask({ assigned_to: 'someone-else' })
    fakeSupabase.setRows('workspace_tasks', [row])
    mount()
    await settle()

    await tick(10_000)

    expect(guardedCalls()).toHaveLength(0)
  })
})
