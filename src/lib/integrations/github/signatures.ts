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

// The `state` round-tripped through GitHub's authorize/install screens: who
// started the connection, for which workspace, and when -- signed, so it can't
// be forged or pointed at another workspace, and short-lived. The workspace in
// it is the ONLY source of which workspace gets connected.
export type ConnectState = {
  userId: string
  workspaceId: string
  issuedAt: number
}

// After authorizing, a GitHub user who can see several installations of the
// app (their own account, an organisation...) picks one. The list comes from
// GitHub (GET /user/installations with their one-off token, then discarded),
// is signed here, and is the only set of installation ids the pick may use --
// an id the browser sends is never trusted on its own.
export type InstallationChoice = ConnectState & {
  kind: 'installation_choice'
  installations: { id: number; account: string | null }[]
}

export const CONNECT_STATE_TTL_MS = 15 * 60 * 1000

function sign(secret: string, body: string) {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

function encodeSigned(secret: string, payload: object) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(secret, body)}`
}

// The payload if the signature is ours, the shape is a connection token and it
// is still fresh; else null.
function decodeSigned(
  secret: string,
  value: string | null,
  now: number,
): Record<string, unknown> | null {
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
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (
      typeof payload?.userId !== 'string' ||
      typeof payload?.workspaceId !== 'string' ||
      typeof payload?.issuedAt !== 'number' ||
      now - payload.issuedAt > CONNECT_STATE_TTL_MS ||
      payload.issuedAt > now + 60_000
    )
      return null
    return payload
  } catch {
    return null
  }
}

export function encodeConnectState(secret: string, state: ConnectState) {
  return encodeSigned(secret, {
    userId: state.userId,
    workspaceId: state.workspaceId,
    issuedAt: state.issuedAt,
  })
}

export function decodeConnectState(
  secret: string,
  value: string | null,
  now = Date.now(),
): ConnectState | null {
  const payload = decodeSigned(secret, value, now)
  // A choice token is not a state, even though it is signed the same way.
  if (!payload || 'kind' in payload) return null
  return {
    userId: payload.userId as string,
    workspaceId: payload.workspaceId as string,
    issuedAt: payload.issuedAt as number,
  }
}

export function encodeInstallationChoice(
  secret: string,
  choice: Omit<InstallationChoice, 'kind'>,
) {
  return encodeSigned(secret, { ...choice, kind: 'installation_choice' })
}

export function decodeInstallationChoice(
  secret: string,
  value: string | null,
  now = Date.now(),
): InstallationChoice | null {
  const payload = decodeSigned(secret, value, now)
  if (
    !payload ||
    payload.kind !== 'installation_choice' ||
    !Array.isArray(payload.installations)
  )
    return null
  const installations = (payload.installations as unknown[]).filter(
    (item): item is { id: number; account: string | null } =>
      typeof item === 'object' &&
      item !== null &&
      Number.isSafeInteger((item as { id?: unknown }).id),
  )
  return { ...(payload as InstallationChoice), installations }
}
