import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from '@/test/renderHook'
import { useWorkspaceGithub } from '@/hooks/useWorkspaceGithub'
import { SNAPSHOT_WRITE_DELAY_MS } from '@/hooks/useWorkspaceSnapshot'
import { clearAllCache, writeCache } from '@/lib/cache/cacheStore'

// The GitHub connection is per workspace. Switching from a connected workspace
// A to workspace B must show B's own state (here: not connected) -- never A's,
// not even while B's answer is on its way, and not when A's answer arrives
// late.

type Row = Record<string, unknown> | null
const answers = new Map<string, { row: Row; delay: Promise<void> }>()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, workspaceId: string) => ({
          maybeSingle: async () => {
            const answer = answers.get(workspaceId)
            await answer?.delay
            return { data: answer?.row ?? null, error: null }
          },
        }),
      }),
    }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  }),
}))

const rowFor = (workspaceId: string, repo: string) => ({
  workspace_id: workspaceId,
  account_login: 'abrar',
  repository_id: 22,
  repository_full_name: repo,
  repository_url: `https://github.com/${repo}`,
  status: 'connected',
  updated_at: '2026-09-26T00:00:00Z',
})

beforeEach(async () => {
  answers.clear()
  await clearAllCache()
})

describe('useWorkspaceGithub — per workspace', () => {
  it('shows B as not connected after A, and never shows A’s repository for B', async () => {
    answers.set('ws-a', {
      row: rowFor('ws-a', 'acme/repo-a'),
      delay: Promise.resolve(),
    })
    answers.set('ws-b', { row: null, delay: Promise.resolve() })

    const hook = renderHook(
      ({ id }: { id: string }) => useWorkspaceGithub(id, 'user-me', true),
      { id: 'ws-a' },
    )
    await settle()
    expect(hook.result.current.connection?.repositoryFullName).toBe(
      'acme/repo-a',
    )

    const rendersBefore = hook.renders.length
    hook.rerender({ id: 'ws-b' })
    await settle()
    expect(hook.result.current.connection).toBeNull()
    expect(hook.result.current.ready).toBe(true)
    // Not even the first render for B showed A's connection.
    for (const render of hook.renders.slice(rendersBefore)) {
      expect(render.connection).toBeNull()
    }
    expect(hook.result.current.connectUrl).toContain('workspace_id=ws-b')
  })

  it('drops a slow answer for A that arrives after switching to B', async () => {
    let releaseA!: () => void
    answers.set('ws-a', {
      row: rowFor('ws-a', 'acme/repo-a'),
      delay: new Promise<void>(resolve => (releaseA = resolve)),
    })
    answers.set('ws-b', {
      row: rowFor('ws-b', 'acme/repo-b'),
      delay: Promise.resolve(),
    })

    const hook = renderHook(
      ({ id }: { id: string }) => useWorkspaceGithub(id, 'user-me', true),
      { id: 'ws-a' },
    )
    hook.rerender({ id: 'ws-b' })
    await settle()
    releaseA()
    await settle()
    expect(hook.result.current.connection?.repositoryFullName).toBe(
      'acme/repo-b',
    )
    expect(
      hook.renders.some(
        render => render.connection?.repositoryFullName === 'acme/repo-a',
      ),
    ).toBe(false)
  })
})

describe('useWorkspaceGithub — cached', () => {
  it('shows the cached connection before Supabase answers, then the answer', async () => {
    await writeCache(
      'user-me',
      'github-connection',
      'ws-a',
      {
        connection: {
          workspaceId: 'ws-a',
          accountLogin: 'abrar',
          repositoryId: 22,
          repositoryFullName: 'acme/cached',
          repositoryUrl: 'https://github.com/acme/cached',
          status: 'connected',
          updatedAt: '2026-09-25T00:00:00Z',
        },
      },
      'ws-a',
    )
    let release!: () => void
    answers.set('ws-a', {
      row: rowFor('ws-a', 'acme/fresh'),
      delay: new Promise<void>(resolve => (release = resolve)),
    })

    const hook = renderHook(
      ({ id }: { id: string }) => useWorkspaceGithub(id, 'user-me', true),
      { id: 'ws-a' },
    )
    await settle()
    expect(hook.result.current.ready).toBe(true)
    expect(hook.result.current.connection?.repositoryFullName).toBe(
      'acme/cached',
    )

    release()
    await settle()
    expect(hook.result.current.connection?.repositoryFullName).toBe(
      'acme/fresh',
    )
  })

  it('caches "not connected" too, so a reopen needs no loader', async () => {
    answers.set('ws-a', { row: null, delay: Promise.resolve() })
    const first = renderHook(
      ({ id }: { id: string }) => useWorkspaceGithub(id, 'user-me', true),
      { id: 'ws-a' },
    )
    await settle()
    expect(first.result.current.connection).toBeNull()
    await new Promise(resolve =>
      setTimeout(resolve, SNAPSHOT_WRITE_DELAY_MS + 50),
    )
    first.unmount()

    answers.set('ws-a', { row: null, delay: new Promise<void>(() => {}) })
    const second = renderHook(
      ({ id }: { id: string }) => useWorkspaceGithub(id, 'user-me', true),
      { id: 'ws-a' },
    )
    await settle()
    expect(second.result.current.ready).toBe(true)
    expect(second.result.current.connection).toBeNull()
  })
})
