import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { requireWorkspaceOwner } from '@/lib/integrations/github/routeAuth'

// Stop tracking GitHub in this workspace. Development Tasks and what was
// already tracked stay as they are. The app stays installed on GitHub (the
// owner can uninstall it there); OnTask simply forgets the installation.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string
  } | null
  const owner = await requireWorkspaceOwner(body?.workspaceId)
  if (owner instanceof NextResponse) return owner

  const { error } = await createServiceRoleClient()
    .from('workspace_github_connections')
    .delete()
    .eq('workspace_id', owner.workspace.id)
  if (error) {
    console.error('[GitHub] Disconnect failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
