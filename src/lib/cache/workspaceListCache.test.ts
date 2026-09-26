import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@/types/workspace'

const workspace: Workspace = {
  id: 'ws-1',
  slug: 'design-team',
  type: 'shared',
  name: 'Design Team',
  description: null,
  ownerId: 'user-a',
  timezone: 'Europe/London',
  reportTime: '12:00:00',
  dailyReportsEnabled: true,
  developmentEnabled: false,
  eventsEnabled: true,
  eventsOverviewEnabled: true,
  eventsCountdownEnabled: true,
  eventsNotificationsEnabled: true,
  eventsMembersCanCreate: true,
  accent: 'ocean',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
}

async function freshModules() {
  vi.resetModules()
  globalThis.indexedDB = new IDBFactory()
  return {
    repo: await import('@/lib/cache/workspaceListCache'),
    store: await import('@/lib/cache/cacheStore'),
  }
}

type Modules = Awaited<ReturnType<typeof freshModules>>
let repo: Modules['repo']
let store: Modules['store']

beforeEach(async () => {
  ;({ repo, store } = await freshModules())
})

describe('workspace list cache', () => {
  it('returns the list and member counts that were saved', async () => {
    const snapshot = { workspaces: [workspace], memberCounts: { 'ws-1': 3 } }

    await repo.saveWorkspaceList('user-a', snapshot)

    expect((await repo.getCachedWorkspaceList('user-a'))?.data).toEqual(
      snapshot,
    )
  })

  it('has nothing on a first visit', async () => {
    expect(await repo.getCachedWorkspaceList('user-a')).toBeUndefined()
  })

  it("does not show one account's workspaces to another account", async () => {
    await repo.saveWorkspaceList('user-a', {
      workspaces: [workspace],
      memberCounts: {},
    })

    expect(await repo.getCachedWorkspaceList('user-b')).toBeUndefined()
  })

  it('an empty list is a real, cacheable answer (not a cache miss)', async () => {
    await repo.saveWorkspaceList('user-a', { workspaces: [], memberCounts: {} })

    expect(
      (await repo.getCachedWorkspaceList('user-a'))?.data.workspaces,
    ).toEqual([])
  })

  it('the list is replaced wholesale, so a workspace the user lost drops out', async () => {
    const other = { ...workspace, id: 'ws-2', slug: 'other' }
    await repo.saveWorkspaceList('user-a', {
      workspaces: [workspace, other],
      memberCounts: {},
    })

    // Revalidation says the user is now only in ws-1.
    await repo.saveWorkspaceList('user-a', {
      workspaces: [workspace],
      memberCounts: {},
    })

    const cached = await repo.getCachedWorkspaceList('user-a')
    expect(cached?.data.workspaces.map(w => w.id)).toEqual(['ws-1'])
  })

  it.each([
    ['not an object', 'text'],
    ['no workspaces array', { memberCounts: {} }],
    [
      'a workspace missing a field',
      { workspaces: [{ id: 'ws-1' }], memberCounts: {} },
    ],
    [
      'a workspace of an unknown type',
      { workspaces: [{ ...workspace, type: 'mystery' }], memberCounts: {} },
    ],
    [
      'a non-numeric member count',
      { workspaces: [workspace], memberCounts: { 'ws-1': 'three' } },
    ],
  ])(
    'ignores a stored value with %s instead of returning it',
    async (_name, bad) => {
      // Written straight through the store, as an older build or a damaged
      // browser profile might have left it.
      await store.writeCache('user-a', 'workspace-list', 'all', bad)

      expect(await repo.getCachedWorkspaceList('user-a')).toBeUndefined()
    },
  )
})
