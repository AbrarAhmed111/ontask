import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import {
  decodeInstallationChoice,
  encodeConnectState,
} from '@/lib/integrations/github/signatures'

// The connect callback, in every branch it can take. What is checked is the
// workspace scoping (only the workspace named in the signed state is ever
// written) and that nothing from the URL is trusted without GitHub's own
// answer about which installations this GitHub user can access.

const SECRET = 'client-secret'
const USER = 'user-1'
const WS_A = { id: 'ws-a', slug: 'team-a', type: 'shared' }
const WS_B = { id: 'ws-b', slug: 'team-b', type: 'shared' }

const requireWorkspaceOwner = vi.fn()
vi.mock('@/lib/integrations/github/routeAuth', () => ({
  requireWorkspaceOwner: (id: string) => requireWorkspaceOwner(id),
}))

const listUserInstallations = vi.fn()
vi.mock('@/lib/integrations/github/githubApp', () => ({
  connectStateSecret: () => SECRET,
  listUserInstallations: (code: string) => listUserInstallations(code),
  authorizeUrl: (state: string) =>
    `https://github.com/login/oauth/authorize?state=${state}`,
  installUrl: (state: string) =>
    `https://github.com/apps/ontask/installations/new?state=${state}`,
}))

const connectWorkspaceInstallation = vi.fn()
vi.mock('@/lib/integrations/github/connectWorkspace', async importActual => ({
  ...(await importActual<object>()),
  connectWorkspaceInstallation: (input: unknown) =>
    connectWorkspaceInstallation(input),
}))

vi.mock('@/lib/integrations/slack/slackUrl', () => ({
  getBaseUrl: () => 'https://ontask.test',
}))

import { GET } from './route'

const stateFor = (workspaceId: string, userId = USER) =>
  encodeConnectState(SECRET, { userId, workspaceId, issuedAt: Date.now() })

function callback(
  query: Record<string, string>,
  { cookie }: { cookie?: string } = {},
) {
  const url = new URL('https://ontask.test/api/integrations/github/callback')
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value)
  const request = new NextRequest(url, {
    headers: cookie ? { cookie: `ontask_github_state=${cookie}` } : {},
  })
  return GET(request)
}

const location = (response: Response) => response.headers.get('location') ?? ''

beforeEach(() => {
  requireWorkspaceOwner.mockReset()
  requireWorkspaceOwner.mockImplementation(async (id: string) => ({
    userId: USER,
    workspace: id === WS_A.id ? WS_A : WS_B,
  }))
  listUserInstallations.mockReset()
  connectWorkspaceInstallation.mockReset()
  connectWorkspaceInstallation.mockResolvedValue({ ok: true })
})

describe('GitHub connect callback — workspace scoping', () => {
  it('connects the workspace named in the signed state (B), and only B', async () => {
    listUserInstallations.mockResolvedValue([{ id: 77, account: 'abrar' }])
    const response = await callback({ code: 'c', state: stateFor(WS_B.id) })
    expect(requireWorkspaceOwner).toHaveBeenCalledWith(WS_B.id)
    expect(connectWorkspaceInstallation).toHaveBeenCalledTimes(1)
    expect(connectWorkspaceInstallation).toHaveBeenCalledWith({
      workspaceId: WS_B.id,
      userId: USER,
      installationId: 77,
    })
    expect(location(response)).toBe(
      'https://ontask.test/workspaces/team-b/settings?integrations-settings&github=connected',
    )
  })

  it('reuses an installation already used by workspace A for workspace B without touching A', async () => {
    listUserInstallations.mockResolvedValue([{ id: 77, account: 'abrar' }])
    await callback({ code: 'c', state: stateFor(WS_A.id) })
    await callback({ code: 'c2', state: stateFor(WS_B.id) })
    expect(
      connectWorkspaceInstallation.mock.calls.map(
        ([input]) => (input as { workspaceId: string }).workspaceId,
      ),
    ).toEqual([WS_A.id, WS_B.id])
  })

  it('refuses a state started by another OnTask user', async () => {
    const response = await callback({
      code: 'c',
      state: stateFor(WS_B.id, 'someone-else'),
    })
    expect(location(response)).toContain('github_error=different_user')
    expect(listUserInstallations).not.toHaveBeenCalled()
  })

  it('stops at the owner check (a non-owner gets its 403)', async () => {
    requireWorkspaceOwner.mockResolvedValue(
      NextResponse.json({ error: 'no' }, { status: 403 }),
    )
    const response = await callback({ code: 'c', state: stateFor(WS_B.id) })
    expect(response.status).toBe(403)
    expect(connectWorkspaceInstallation).not.toHaveBeenCalled()
  })
})

describe('GitHub connect callback — existing installations', () => {
  it('connects the only installation the GitHub user can access', async () => {
    listUserInstallations.mockResolvedValue([{ id: 5, account: 'abrar' }])
    await callback({ code: 'c', state: stateFor(WS_B.id) })
    expect(connectWorkspaceInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 5 }),
    )
  })

  it('offers a signed choice when several are accessible, bound to this user and workspace', async () => {
    listUserInstallations.mockResolvedValue([
      { id: 5, account: 'abrar' },
      { id: 6, account: 'devwebies' },
    ])
    const response = await callback({ code: 'c', state: stateFor(WS_B.id) })
    expect(connectWorkspaceInstallation).not.toHaveBeenCalled()
    const url = new URL(location(response))
    expect(url.pathname).toBe('/workspaces/team-b/settings')
    expect(url.searchParams.has('integrations-settings')).toBe(true)
    const choice = decodeInstallationChoice(
      SECRET,
      url.searchParams.get('github_choose'),
    )
    expect(choice).toMatchObject({
      userId: USER,
      workspaceId: WS_B.id,
      installations: [
        { id: 5, account: 'abrar' },
        { id: 6, account: 'devwebies' },
      ],
    })
  })

  it('sends a user with no accessible installation on to install the app, with the same state', async () => {
    listUserInstallations.mockResolvedValue([])
    const state = stateFor(WS_B.id)
    const response = await callback({ code: 'c', state })
    expect(location(response)).toBe(
      `https://github.com/apps/ontask/installations/new?state=${state}`,
    )
    expect(response.headers.get('set-cookie')).toContain('ontask_github_state=')
    expect(connectWorkspaceInstallation).not.toHaveBeenCalled()
  })
})

describe('GitHub connect callback — fresh installation', () => {
  it('connects the installation GitHub just returned, once it is confirmed as the user’s', async () => {
    listUserInstallations.mockResolvedValue([
      { id: 5, account: 'abrar' },
      { id: 9, account: 'new-org' },
    ])
    await callback({
      code: 'c',
      installation_id: '9',
      setup_action: 'install',
      state: stateFor(WS_B.id),
    })
    expect(connectWorkspaceInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS_B.id, installationId: 9 }),
    )
  })

  it('refuses an installation id this GitHub user cannot access', async () => {
    listUserInstallations.mockResolvedValue([{ id: 5, account: 'abrar' }])
    const response = await callback({
      code: 'c',
      installation_id: '999',
      state: stateFor(WS_B.id),
    })
    expect(location(response)).toContain('github_error=installation_not_yours')
    expect(connectWorkspaceInstallation).not.toHaveBeenCalled()
  })

  it('restarts the authorize step (ignoring the code) when GitHub drops the state', async () => {
    const state = stateFor(WS_B.id)
    const response = await callback(
      { code: 'someone-elses-code', installation_id: '9' },
      { cookie: state },
    )
    expect(location(response)).toBe(
      `https://github.com/login/oauth/authorize?state=${state}`,
    )
    expect(listUserInstallations).not.toHaveBeenCalled()
    expect(connectWorkspaceInstallation).not.toHaveBeenCalled()
  })
})

describe('GitHub connect callback — failures', () => {
  it.each([
    [{ code: 'c', state: 'forged.state' }, '/workspaces?github_error=expired'],
    [{ code: 'c' }, '/workspaces?github_error=expired'],
  ])('rejects an invalid or missing state %#', async (query, expected) => {
    const response = await callback(query)
    expect(location(response)).toBe(`https://ontask.test${expected}`)
    expect(listUserInstallations).not.toHaveBeenCalled()
  })

  it('reports a cancelled authorization', async () => {
    const response = await callback({
      error: 'access_denied',
      state: stateFor(WS_B.id),
    })
    expect(location(response)).toContain('github_error=authorization_cancelled')
  })

  it('reports a missing code', async () => {
    const response = await callback({ state: stateFor(WS_B.id) })
    expect(location(response)).toContain('github_error=authorization_required')
  })

  it('reports an organisation approval request', async () => {
    const response = await callback({
      setup_action: 'request',
      state: stateFor(WS_B.id),
    })
    expect(location(response)).toContain('github_error=approval_pending')
  })

  it('reports a code GitHub would not exchange', async () => {
    listUserInstallations.mockResolvedValue(null)
    const response = await callback({ code: 'c', state: stateFor(WS_B.id) })
    expect(location(response)).toContain('github_error=authorization_failed')
  })

  it('reports a malformed installation id', async () => {
    const response = await callback({
      code: 'c',
      installation_id: 'abc',
      state: stateFor(WS_B.id),
    })
    expect(location(response)).toContain('github_error=missing_installation')
  })
})
