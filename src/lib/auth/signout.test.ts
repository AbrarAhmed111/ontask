import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clearAllCache = vi.fn()
const signOut = vi.fn()
const rpc = vi.fn()
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

  it('ends the auth session without touching task timers', async () => {
    await expect(clientSignout()).resolves.toEqual({ success: true })

    expect(rpc).not.toHaveBeenCalled()
    expect(order).toEqual(['signOut', 'clearAllCache'])
  })
})
