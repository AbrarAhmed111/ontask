import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clearAllCache = vi.fn()
const signOut = vi.fn()
const rpc = vi.fn()
const personalTasks: {
  id: string
  started_at: string | null
  actual_seconds: number | null
}[] = []
const updatePersonalTask = vi.fn()
const order: string[] = []

vi.mock('@/lib/cache/cacheStore', () => ({
  clearAllCache: () => {
    order.push('clearAllCache')
    return clearAllCache()
  },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signOut: () => {
        order.push('signOut')
        return signOut()
      },
    },
    from: (table: string) => {
      if (table !== 'personal_tasks') throw new Error(`unexpected ${table}`)
      return {
        select: () => ({
          eq: (column: string, value: unknown) => ({
            eq: (nextColumn: string, nextValue: unknown) => {
              order.push(
                `select:${table}:${column}:${value}:${nextColumn}:${nextValue}`,
              )
              return Promise.resolve({ data: personalTasks, error: null })
            },
          }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: (column: string, value: unknown) => {
            order.push(`update:${table}:${column}:${value}`)
            return updatePersonalTask(values)
          },
        }),
      }
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      order.push(`rpc:${name}`)
      return rpc(name, args)
    },
  }),
}))

import { clientSignout } from './signout'

function stubBrowserStorage() {
  const storage = {
    removeItem: vi.fn(),
  }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('sessionStorage', storage)
  vi.stubGlobal('document', { cookie: '' })
  vi.stubGlobal('window', {
    google: { accounts: { id: { disableAutoSelect: vi.fn() } } },
  })
}

describe('clientSignout', () => {
  beforeEach(() => {
    personalTasks.length = 0
    order.length = 0
    clearAllCache.mockResolvedValue(undefined)
    signOut.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ error: null })
    updatePersonalTask.mockResolvedValue({ error: null })
    stubBrowserStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('pauses running tasks before ending the session', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T12:00:00.000Z'))
    personalTasks.push(
      {
        id: 'personal-1',
        started_at: '2026-09-21T11:59:30.000Z',
        actual_seconds: 10,
      },
      {
        id: 'personal-2',
        started_at: null,
        actual_seconds: null,
      },
    )

    await expect(clientSignout()).resolves.toEqual({ success: true })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('pause_my_running_workspace_tasks', {})
    expect(updatePersonalTask).toHaveBeenNthCalledWith(1, {
      status: 'paused',
      started_at: null,
      actual_seconds: 40,
    })
    expect(updatePersonalTask).toHaveBeenNthCalledWith(2, {
      status: 'paused',
      started_at: null,
      actual_seconds: 0,
    })
    expect(order).toEqual([
      'select:personal_tasks:status:working:completed:false',
      'rpc:pause_my_running_workspace_tasks',
      'update:personal_tasks:id:personal-1',
      'update:personal_tasks:id:personal-2',
      'clearAllCache',
      'signOut',
    ])
  })
})
