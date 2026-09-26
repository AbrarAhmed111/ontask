import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeInstallationChoice } from '@/lib/integrations/github/signatures'

// Picking one of several GitHub accounts: the browser sends an installation id,
// which is accepted only from the signed list issued for this OnTask user and
// THIS workspace.

const SECRET = 'client-secret'
const USER = 'user-1'

const requireWorkspaceOwner = vi.fn()
vi.mock('@/lib/integrations/github/routeAuth', () => ({
  requireWorkspaceOwner: (id: string) => requireWorkspaceOwner(id),
}))
vi.mock('@/lib/integrations/github/githubApp', () => ({
  connectStateSecret: () => SECRET,
}))
const connectWorkspaceInstallation = vi.fn()
vi.mock('@/lib/integrations/github/connectWorkspace', () => ({
  connectWorkspaceInstallation: (input: unknown) =>
    connectWorkspaceInstallation(input),
}))

import { POST } from './route'

const token = (workspaceId: string, userId = USER) =>
  encodeInstallationChoice(SECRET, {
    userId,
    workspaceId,
    issuedAt: Date.now(),
    installations: [
      { id: 5, account: 'abrar' },
      { id: 6, account: 'devwebies' },
    ],
  })

const pick = (body: Record<string, unknown>) =>
  POST(
    new Request('https://ontask.test/api/integrations/github/installation', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  requireWorkspaceOwner.mockReset()
  requireWorkspaceOwner.mockImplementation(async (id: string) => ({
    userId: USER,
    workspace: { id, slug: id, type: 'shared' },
  }))
  connectWorkspaceInstallation.mockReset()
  connectWorkspaceInstallation.mockResolvedValue({ ok: true })
})

describe('choosing a GitHub installation', () => {
  it('connects the chosen installation to this workspace', async () => {
    const response = await pick({
      workspaceId: 'ws-b',
      installationId: 6,
      token: token('ws-b'),
    })
    expect(response.status).toBe(200)
    expect(connectWorkspaceInstallation).toHaveBeenCalledWith({
      workspaceId: 'ws-b',
      userId: USER,
      installationId: 6,
    })
  })

  it('refuses a list issued for another workspace', async () => {
    const response = await pick({
      workspaceId: 'ws-b',
      installationId: 6,
      token: token('ws-a'),
    })
    expect(response.status).toBe(400)
    expect(connectWorkspaceInstallation).not.toHaveBeenCalled()
  })

  it('refuses a list issued to another OnTask user', async () => {
    const response = await pick({
      workspaceId: 'ws-b',
      installationId: 6,
      token: token('ws-b', 'someone-else'),
    })
    expect(response.status).toBe(400)
  })

  it('refuses an installation id that is not in the list', async () => {
    const response = await pick({
      workspaceId: 'ws-b',
      installationId: 999,
      token: token('ws-b'),
    })
    expect(response.status).toBe(400)
    expect(connectWorkspaceInstallation).not.toHaveBeenCalled()
  })

  it('refuses a forged list', async () => {
    const [body] = token('ws-b').split('.')
    const response = await pick({
      workspaceId: 'ws-b',
      installationId: 6,
      token: `${body}.forged`,
    })
    expect(response.status).toBe(400)
  })
})
