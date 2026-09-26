import { beforeEach, describe, expect, it, vi } from 'vitest'

// Saving an installation to a workspace: only that workspace's row, and the
// repository rule (keep the chosen one on reconnect, auto-pick a single one,
// otherwise ask -- never an arbitrary one).

type Repo = { id: number; fullName: string; htmlUrl: string; private: boolean }
const repo = (id: number): Repo => ({
  id,
  fullName: `acme/repo-${id}`,
  htmlUrl: `https://github.com/acme/repo-${id}`,
  private: false,
})

let repositories: Repo[] = []
vi.mock('@/lib/integrations/github/githubApp', () => ({
  getInstallation: async () => ({
    account: 'acme',
    manageUrl: 'https://github.com/settings/installations/1',
  }),
  listInstallationRepositories: async () => ({
    total: repositories.length,
    repositories,
  }),
}))

let existing: { installation_id: number; repository_id: number | null } | null
const upsert = vi.fn()
const eq = vi.fn()
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: (column: string, value: string) => {
          eq(column, value)
          return { maybeSingle: async () => ({ data: existing, error: null }) }
        },
      }),
      upsert: async (row: unknown, options: unknown) => {
        upsert(row, options)
        return { error: null }
      },
    }),
  }),
}))

import { connectWorkspaceInstallation } from '@/lib/integrations/github/connectWorkspace'

const connect = (installationId = 1) =>
  connectWorkspaceInstallation({
    workspaceId: 'ws-b',
    userId: 'user-1',
    installationId,
  })

const saved = () => upsert.mock.calls[0][0] as Record<string, unknown>

beforeEach(() => {
  upsert.mockReset()
  eq.mockReset()
  existing = null
  repositories = []
})

describe('connectWorkspaceInstallation', () => {
  it('writes only the given workspace’s row, keyed by workspace', async () => {
    repositories = [repo(10)]
    await connect()
    expect(eq).toHaveBeenCalledWith('workspace_id', 'ws-b')
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(saved().workspace_id).toBe('ws-b')
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'workspace_id' })
  })

  it('picks a single granted repository automatically', async () => {
    repositories = [repo(10)]
    await connect()
    expect(saved()).toMatchObject({
      repository_id: 10,
      status: 'connected',
      account_login: 'acme',
    })
  })

  it('asks for a repository when several are granted', async () => {
    repositories = [repo(10), repo(11)]
    await connect()
    expect(saved()).toMatchObject({
      repository_id: null,
      status: 'repository_required',
    })
  })

  it('asks for a repository when none is granted', async () => {
    await connect()
    expect(saved()).toMatchObject({ status: 'repository_required' })
  })

  it('keeps the chosen repository when the same installation reconnects', async () => {
    repositories = [repo(10), repo(11)]
    existing = { installation_id: 1, repository_id: 11 }
    await connect(1)
    expect(saved()).toMatchObject({ repository_id: 11, status: 'connected' })
  })

  it('does not keep a repository the installation can no longer see', async () => {
    repositories = [repo(10), repo(12)]
    existing = { installation_id: 1, repository_id: 11 }
    await connect(1)
    expect(saved()).toMatchObject({ status: 'repository_required' })
  })

  it('does not carry a repository over from a different installation', async () => {
    repositories = [repo(10), repo(11)]
    existing = { installation_id: 2, repository_id: 11 }
    await connect(1)
    expect(saved()).toMatchObject({ status: 'repository_required' })
  })
})
