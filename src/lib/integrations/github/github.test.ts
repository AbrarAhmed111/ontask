import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { normalizeGithubEvent } from '@/lib/integrations/github/events'
import {
  CONNECT_STATE_TTL_MS,
  decodeConnectState,
  decodeInstallationChoice,
  encodeConnectState,
  encodeInstallationChoice,
  verifyWebhookSignature,
} from '@/lib/integrations/github/signatures'
import { readInstallationChoice } from '@/lib/integrations/github/installationChoice'

const REPO = { id: 22, full_name: 'acme/ontask' }
const INSTALLATION = { id: 11 }

const pullRequest = (overrides: Record<string, unknown> = {}) => ({
  id: 900,
  number: 142,
  html_url: 'https://github.com/acme/ontask/pull/142',
  title: 'Implement Google OAuth',
  state: 'open',
  merged: false,
  merged_at: null,
  created_at: '2026-09-26T10:00:00Z',
  closed_at: null,
  updated_at: '2026-09-26T10:00:00Z',
  head: { ref: 'feature/google-oauth-abrar', repo: { id: REPO.id } },
  base: { ref: 'main', repo: { id: REPO.id } },
  ...overrides,
})

const prEvent = (action: string, pr = pullRequest()) =>
  normalizeGithubEvent('pull_request', {
    action,
    installation: INSTALLATION,
    repository: REPO,
    pull_request: pr,
  })

describe('normalizeGithubEvent', () => {
  it('turns a created branch into a branch event', () => {
    expect(
      normalizeGithubEvent('create', {
        ref_type: 'branch',
        ref: 'feature/google-oauth-abrar',
        installation: INSTALLATION,
        repository: REPO,
      }),
    ).toEqual({
      kind: 'branch',
      installation_id: 11,
      repository_id: 22,
      branch: 'feature/google-oauth-abrar',
    })
  })

  it('ignores tags', () => {
    expect(
      normalizeGithubEvent('create', {
        ref_type: 'tag',
        ref: 'v1.0.0',
        installation: INSTALLATION,
        repository: REPO,
      }),
    ).toBeNull()
  })

  it('reads a push only as proof the branch exists (never commits)', () => {
    const event = normalizeGithubEvent('push', {
      ref: 'refs/heads/feature/google-oauth-abrar',
      deleted: false,
      commits: [{ id: 'abc' }],
      installation: INSTALLATION,
      repository: REPO,
    })
    expect(event).toEqual({
      kind: 'branch',
      installation_id: 11,
      repository_id: 22,
      branch: 'feature/google-oauth-abrar',
    })
  })

  it('reports a deleted branch, from a delete event or a deleting push', () => {
    const deleted = {
      kind: 'branch_deleted',
      installation_id: 11,
      repository_id: 22,
      branch: 'feature/x',
    }
    expect(
      normalizeGithubEvent('push', {
        ref: 'refs/heads/feature/x',
        deleted: true,
        installation: INSTALLATION,
        repository: REPO,
      }),
    ).toEqual(deleted)
    expect(
      normalizeGithubEvent('delete', {
        ref_type: 'branch',
        ref: 'feature/x',
        installation: INSTALLATION,
        repository: REPO,
      }),
    ).toEqual(deleted)
    expect(
      normalizeGithubEvent('delete', {
        ref_type: 'tag',
        ref: 'v1',
        installation: INSTALLATION,
        repository: REPO,
      }),
    ).toBeNull()
  })

  it('ignores a tag push', () => {
    expect(
      normalizeGithubEvent('push', {
        ref: 'refs/tags/v1',
        installation: INSTALLATION,
        repository: REPO,
      }),
    ).toBeNull()
  })

  it('carries an opened PR with its stable id and source branch', () => {
    expect(prEvent('opened')).toMatchObject({
      kind: 'pull_request',
      branch: 'feature/google-oauth-abrar',
      pull_request: {
        id: 900,
        number: 142,
        url: 'https://github.com/acme/ontask/pull/142',
        state: 'open',
        merged: false,
        base_branch: 'main',
      },
    })
  })

  it('distinguishes merged from closed without merging', () => {
    const merged = prEvent(
      'closed',
      pullRequest({
        state: 'closed',
        merged: true,
        merged_at: '2026-09-26T15:00:00Z',
      }),
    )
    const closed = prEvent('closed', pullRequest({ state: 'closed' }))
    expect(merged?.kind === 'pull_request' && merged.pull_request.merged).toBe(
      true,
    )
    expect(
      closed?.kind === 'pull_request' && closed.pull_request,
    ).toMatchObject({ state: 'closed', merged: false })
  })

  it("ignores a fork's PR even when the branch name matches", () => {
    expect(
      prEvent(
        'opened',
        pullRequest({
          head: { ref: 'feature/google-oauth-abrar', repo: { id: 999 } },
        }),
      ),
    ).toBeNull()
  })

  it('ignores PR actions that cannot change a stage', () => {
    expect(prEvent('labeled')).toBeNull()
    expect(prEvent('review_requested')).toBeNull()
  })

  it('maps installation lifecycle events', () => {
    expect(
      normalizeGithubEvent('installation', {
        action: 'deleted',
        installation: INSTALLATION,
      }),
    ).toEqual({ kind: 'installation_deleted', installation_id: 11 })
    expect(
      normalizeGithubEvent('installation_repositories', {
        action: 'removed',
        installation: INSTALLATION,
        repositories_removed: [{ id: 22 }, { id: 23 }],
      }),
    ).toEqual({
      kind: 'repositories_removed',
      installation_id: 11,
      repository_ids: [22, 23],
    })
  })

  it('maps repository rename events to metadata refresh by stable id', () => {
    expect(
      normalizeGithubEvent('repository', {
        action: 'renamed',
        installation: INSTALLATION,
        repository: {
          id: 22,
          full_name: 'acme/new-name',
          html_url: 'https://github.com/acme/new-name',
        },
      }),
    ).toEqual({
      kind: 'repository_metadata',
      installation_id: 11,
      repository_id: 22,
      repository_full_name: 'acme/new-name',
      repository_url: 'https://github.com/acme/new-name',
    })
  })

  it('ignores events without an installation, and unknown events', () => {
    expect(
      normalizeGithubEvent('create', {
        ref_type: 'branch',
        ref: 'x',
        repository: REPO,
      }),
    ).toBeNull()
    expect(
      normalizeGithubEvent('ping', { installation: INSTALLATION }),
    ).toBeNull()
  })
})

describe('verifyWebhookSignature', () => {
  const secret = 'webhook-secret'
  const body = '{"action":"opened"}'
  const sign = (value: string) =>
    `sha256=${createHmac('sha256', secret).update(value).digest('hex')}`

  it('accepts GitHub’s signature of the exact body', () => {
    expect(verifyWebhookSignature(secret, body, sign(body))).toBe(true)
  })

  it('rejects a modified body, a wrong secret or a missing header', () => {
    expect(verifyWebhookSignature(secret, `${body} `, sign(body))).toBe(false)
    expect(verifyWebhookSignature('other', body, sign(body))).toBe(false)
    expect(verifyWebhookSignature(secret, body, null)).toBe(false)
    expect(verifyWebhookSignature(secret, body, 'sha1=abc')).toBe(false)
    expect(verifyWebhookSignature('', body, sign(body))).toBe(false)
  })
})

describe('connect state', () => {
  const secret = 'state-secret'
  const state = { userId: 'u1', workspaceId: 'w1', issuedAt: 1_000_000 }

  it('round-trips', () => {
    expect(
      decodeConnectState(secret, encodeConnectState(secret, state), 1_000_500),
    ).toEqual(state)
  })

  it('rejects a tampered payload', () => {
    const [, signature] = encodeConnectState(secret, state).split('.')
    const forged = Buffer.from(
      JSON.stringify({ ...state, workspaceId: 'someone-elses' }),
    ).toString('base64url')
    expect(
      decodeConnectState(secret, `${forged}.${signature}`, 1_000_500),
    ).toBeNull()
  })

  it('rejects another secret and an expired state', () => {
    const value = encodeConnectState(secret, state)
    expect(decodeConnectState('other', value, 1_000_500)).toBeNull()
    expect(
      decodeConnectState(
        secret,
        value,
        state.issuedAt + CONNECT_STATE_TTL_MS + 1,
      ),
    ).toBeNull()
  })
})

describe('connect state vs installation choice', () => {
  const secret = 'state-secret'
  const base = { userId: 'u1', workspaceId: 'w1', issuedAt: Date.now() }

  it('a choice token is never accepted as a connect state', () => {
    const choice = encodeInstallationChoice(secret, {
      ...base,
      installations: [{ id: 5, account: 'abrar' }],
    })
    expect(decodeConnectState(secret, choice)).toBeNull()
    expect(decodeInstallationChoice(secret, choice)?.installations).toEqual([
      { id: 5, account: 'abrar' },
    ])
  })

  it('a connect state is never accepted as a choice token', () => {
    const state = encodeConnectState(secret, base)
    expect(decodeInstallationChoice(secret, state)).toBeNull()
  })

  it('the browser can read the choice for display only', () => {
    const choice = encodeInstallationChoice(secret, {
      ...base,
      installations: [{ id: 5, account: 'abrar' }],
    })
    expect(readInstallationChoice(choice)).toEqual([
      { id: 5, account: 'abrar' },
    ])
    expect(readInstallationChoice(encodeConnectState(secret, base))).toBeNull()
  })
})
