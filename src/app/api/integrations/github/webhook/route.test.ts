import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The webhook's own job: refuse anything GitHub didn't sign, and hand the
// database exactly one normalised event per delivery (with its delivery id, so
// a retried delivery is dropped there). What the event then does to a task is
// covered against real Postgres in
// supabase/tests/20260926120000_development_module.sql.

const rpc = vi.fn()
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => ({ rpc }),
}))

import { POST } from './route'

const SECRET = 'webhook-secret'

const deliver = (
  event: string,
  payload: unknown,
  { signature }: { signature?: string | null } = {},
) => {
  const body = JSON.stringify(payload)
  const signed = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
  const headers: Record<string, string> = {
    'x-github-event': event,
    'x-github-delivery': 'delivery-1',
  }
  if (signature !== null) headers['x-hub-signature-256'] = signature ?? signed
  return POST(
    new Request('http://localhost/api/integrations/github/webhook', {
      method: 'POST',
      headers,
      body,
    }),
  )
}

const merged = {
  action: 'closed',
  installation: { id: 11 },
  repository: { id: 22 },
  pull_request: {
    id: 900,
    number: 142,
    html_url: 'https://github.com/acme/ontask/pull/142',
    title: 'Implement Google OAuth',
    state: 'closed',
    merged: true,
    merged_at: '2026-09-26T15:00:00Z',
    head: { ref: 'feature/google-oauth-abrar', repo: { id: 22 } },
  },
}

beforeEach(() => {
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', SECRET)
  rpc.mockReset()
  rpc.mockResolvedValue({ data: { outcome: 'processed' }, error: null })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GitHub webhook', () => {
  it('rejects an unsigned or wrongly signed delivery without touching the database', async () => {
    expect(
      (await deliver('pull_request', merged, { signature: null })).status,
    ).toBe(401)
    expect(
      (await deliver('pull_request', merged, { signature: 'sha256=00' }))
        .status,
    ).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('applies a signed PR event once, with its delivery id', async () => {
    const response = await deliver('pull_request', merged)
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('apply_github_development_event', {
      p_delivery_id: 'delivery-1',
      p_event: expect.objectContaining({
        kind: 'pull_request',
        branch: 'feature/google-oauth-abrar',
        pull_request: expect.objectContaining({ merged: true, number: 142 }),
      }),
    })
  })

  it('acknowledges events it does not act on without calling the database', async () => {
    const response = await deliver('issues', {
      action: 'opened',
      installation: { id: 11 },
    })
    expect(response.status).toBe(202)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reports a database failure so the delivery shows as failed on GitHub', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect((await deliver('pull_request', merged)).status).toBe(500)
  })
})
