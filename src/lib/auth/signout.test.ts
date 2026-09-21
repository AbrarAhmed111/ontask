import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clearAllCache = vi.fn()
const signOut = vi.fn()
const rpc = vi.fn()
const openEntries: { task_id: string | null; task_kind: string | null }[] = []
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
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          is: (isColumn: string, isValue: unknown) => {
            order.push(
              `select:${table}:${column}:${value}:${isColumn}:${isValue}`,
            )
            return Promise.resolve({ data: openEntries, error: null })
          },
        }),
      }),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      order.push(`rpc:${String(args.p_task_id)}`)
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
    openEntries.length = 0
    order.length = 0
    clearAllCache.mockResolvedValue(undefined)
    signOut.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ error: null })
    stubBrowserStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('pauses the signed-in user running workspace tasks before ending the session', async () => {
    openEntries.push(
      { task_id: 'task-1', task_kind: 'workspace' },
      { task_id: 'task-2', task_kind: 'workspace' },
      { task_id: 'task-1', task_kind: 'workspace' },
      { task_id: null, task_kind: 'workspace' },
    )

    await expect(clientSignout()).resolves.toEqual({ success: true })

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenNthCalledWith(1, 'pause_workspace_task', {
      p_task_id: 'task-1',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'pause_workspace_task', {
      p_task_id: 'task-2',
    })
    expect(order).toEqual([
      'select:task_time_entries:task_kind:workspace:ended_at:null',
      'rpc:task-1',
      'rpc:task-2',
      'clearAllCache',
      'signOut',
    ])
  })
})
