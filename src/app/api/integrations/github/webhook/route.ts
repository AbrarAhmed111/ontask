import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { webhookSecret } from '@/lib/integrations/github/githubApp'
import { normalizeGithubEvent } from '@/lib/integrations/github/events'
import { verifyWebhookSignature } from '@/lib/integrations/github/signatures'

// GitHub -> OnTask. Every delivery is verified against the app's webhook
// secret before anything is read from it, reduced to the few facts that matter
// (events.ts), and applied in ONE database transaction by
// apply_github_development_event(), which also drops a delivery it has already
// processed (X-GitHub-Delivery). A failure leaves task state untouched, and the
// next reconciliation catches up.
export async function POST(request: Request) {
  const rawBody = await request.text()
  let secret: string
  try {
    secret = webhookSecret()
  } catch {
    console.error('[GitHub Webhook] GITHUB_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }
  if (
    !verifyWebhookSignature(
      secret,
      rawBody,
      request.headers.get('x-hub-signature-256'),
    )
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = normalizeGithubEvent(
    request.headers.get('x-github-event') ?? '',
    payload,
  )
  if (!event) return NextResponse.json({ outcome: 'ignored' }, { status: 202 })

  const { data, error } = await createServiceRoleClient().rpc(
    'apply_github_development_event',
    {
      p_delivery_id: request.headers.get('x-github-delivery'),
      p_event: event,
    },
  )
  if (error) {
    console.error('[GitHub Webhook] Processing failed:', error)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
  return NextResponse.json(data ?? { outcome: 'processed' })
}
