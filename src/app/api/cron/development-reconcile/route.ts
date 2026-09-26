import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { reconcileDevelopmentTask } from '@/lib/integrations/github/reconcileTask'

// The safety net behind the GitHub webhooks for tasks nobody happens to open.
// Invoked every 15 minutes by Supabase pg_cron/pg_net (the
// `development-reconcile-tick` job in
// supabase/migrations/20260926190000_development_needs_attention.sql), never by
// a browser.
//
// Deliberately small: list_development_tasks_to_reconcile offers only tasks
// GitHub could still move (not finished, PR not merged, connection working),
// each at most once every 30 minutes, at most BATCH per run -- one to three
// GitHub requests each. Each task is claimed first (the same one-a-minute
// claim a person opening the task takes), and applied through the webhook's
// own database function, so repeating a check changes nothing twice and
// notifies nobody twice.
//
// A GitHub failure for one task (5xx, rate limit, network, token) is logged
// and skipped: the task keeps its last known state and is offered again on a
// later run. It is never read as "the branch is gone".
export const maxDuration = 60

const BATCH = 25

type Candidate = {
  task_id: string
  workspace_id: string
  branch_name: string
  branch_detected_at: string | null
  pr_number: number | null
  pr_state: 'open' | 'closed' | 'merged' | null
  installation_id: number | string
  repository_id: number | string
  repository_full_name: string
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET is not configured')
    return NextResponse.json(
      { error: 'Cron endpoint is not configured' },
      { status: 500 },
    )
  }
  if (request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceRoleClient()
  const { data, error } = await service.rpc(
    'list_development_tasks_to_reconcile',
    { p_limit: BATCH },
  )
  if (error) {
    console.error('[development-reconcile] listing failed:', error)
    return NextResponse.json({ error: 'Listing failed' }, { status: 500 })
  }

  const counts = { checked: 0, skipped: 0, unavailable: 0 }
  // A repository found unreachable stops the rest of its batch: the
  // connection is flagged, and its other tasks have nothing to add.
  const unreachable = new Set<string>()

  for (const task of (data ?? []) as Candidate[]) {
    const repositoryKey = `${task.installation_id}:${task.repository_id}`
    if (unreachable.has(repositoryKey)) {
      counts.skipped++
      continue
    }
    const { data: claimed } = await service.rpc('claim_development_reconcile', {
      p_task_id: task.task_id,
    })
    if (!claimed) {
      counts.skipped++
      continue
    }
    try {
      const applied = await reconcileDevelopmentTask(service, {
        installationId: Number(task.installation_id),
        repositoryId: Number(task.repository_id),
        repositoryFullName: task.repository_full_name,
        branchName: task.branch_name,
        branchDetectedAt: task.branch_detected_at,
        prNumber: task.pr_number,
        prState: task.pr_state,
      })
      if (applied.includes('repositories_removed')) {
        unreachable.add(repositoryKey)
      }
      counts.checked++
    } catch (reconcileError) {
      console.error(
        `[development-reconcile] GitHub unavailable for task ${task.task_id}:`,
        reconcileError,
      )
      counts.unavailable++
    }
  }

  return NextResponse.json(counts)
}
