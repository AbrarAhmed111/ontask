import { createHmac, timingSafeEqual } from 'node:crypto'

// GitHub signs every webhook delivery with the app's webhook secret:
// X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw request body>.
// The body must be the exact bytes received (never re-serialised JSON), and
// the comparison is constant-time.
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!secret || !signatureHeader?.startsWith('sha256=')) return false
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`,
    'utf8',
  )
  const received = Buffer.from(signatureHeader, 'utf8')
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  )
}

// The `state` round-tripped through GitHub's install/authorize screens: who
// started the connection, for which workspace, and when -- signed, so it can't
// be forged or pointed at another workspace, and short-lived.
export type ConnectState = {
  userId: string
  workspaceId: string
  issuedAt: number
}

export const CONNECT_STATE_TTL_MS = 15 * 60 * 1000

function sign(secret: string, body: string) {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

export function encodeConnectState(secret: string, state: ConnectState) {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${body}.${sign(secret, body)}`
}

export function decodeConnectState(
  secret: string,
  value: string | null,
  now = Date.now(),
): ConnectState | null {
  if (!secret || !value) return null
  const [body, signature, extra] = value.split('.')
  if (!body || !signature || extra !== undefined) return null
  const expected = Buffer.from(sign(secret, body))
  const received = Buffer.from(signature)
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    return null
  try {
    const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (
      typeof state?.userId !== 'string' ||
      typeof state?.workspaceId !== 'string' ||
      typeof state?.issuedAt !== 'number' ||
      now - state.issuedAt > CONNECT_STATE_TTL_MS ||
      state.issuedAt > now + 60_000
    )
      return null
    return state as ConnectState
  } catch {
    return null
  }
}
