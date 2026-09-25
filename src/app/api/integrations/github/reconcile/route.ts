import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { reconcileEvents } from '@/lib/integrations/github/githubApp'

// A light safety net behind the webhooks: when someone opens a Development
// Task, ask GitHub for that one branch/PR and apply whatever a missed delivery
// would have said. At most once a minute per task (claim_development_reconcile),
// never a poll. GitHub stays the source of truth for GitHub state; if it can't
// be reached nothing changes.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    taskId?: string
  } | null
  if (!body?.taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Read with the caller's session: row-level security is what proves they
  // are a member of the task's workspace.
  const { data: development } = await supabase
    .from('task_development')
    .select('task_id, workspace_id, branch_name, pr_number, pr_state')
    .eq('task_id', body.taskId)
    .maybeSingle()
  if (!development) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const service = createServiceRoleClient()
  const [{ data: workspace }, { data: connection }] = await Promise.all([
    service
      .from('workspaces')
      .select('development_enabled')
      .eq('id', development.workspace_id)
      .maybeSingle(),
    service
      .from('workspace_github_connections')
      .select('installation_id, repository_id, repository_full_name, status')
      .eq('workspace_id', development.workspace_id)
      .maybeSingle(),
  ])
  if (
    !workspace?.development_enabled ||
    connection?.status !== 'connected' ||
    !connection.repository_id
  ) {
    return NextResponse.json({ status: 'not_tracking' })
  }

  const { data: claimed } = await service.rpc('claim_development_reconcile', {
    p_task_id: development.task_id,
  })
  if (!claimed) return NextResponse.json({ status: 'recent' })

  try {
    const events = await reconcileEvents({
      installationId: Number(connection.installation_id),
      repositoryId: Number(connection.repository_id),
      repositoryFullName: connection.repository_full_name,
      branchName: development.branch_name,
      prNumber: development.pr_number,
      prState: development.pr_state,
    })
    for (const event of events) {
      const { error } = await service.rpc('apply_github_development_event', {
        p_delivery_id: null,
        p_event: event,
      })
      if (error) throw error
    }
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('[GitHub] Reconcile failed:', error)
    return NextResponse.json({ status: 'unavailable' }, { status: 502 })
  }
}
