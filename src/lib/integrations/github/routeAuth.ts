import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type OwnerContext = {
  userId: string
  workspace: { id: string; slug: string; type: string }
}

// The GitHub connection is configured only by the workspace owner, and only
// for a shared workspace (the Development module doesn't exist in a personal
// one). Checked with the caller's own session, so row-level security decides
// what they can see before the role is even read.
export async function requireWorkspaceOwner(
  workspaceId: string | null | undefined,
): Promise<OwnerContext | NextResponse> {
  if (!workspaceId) {
    return NextResponse.json(
      { error: 'workspace_id is required' },
      { status: 400 },
    )
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [{ data: member }, { data: workspace }] = await Promise.all([
    supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('workspaces')
      .select('id, slug, type')
      .eq('id', workspaceId)
      .maybeSingle(),
  ])

  if (!workspace || member?.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the workspace owner can manage the GitHub connection.' },
      { status: 403 },
    )
  }
  if (workspace.type !== 'shared') {
    return NextResponse.json(
      { error: 'GitHub tracking is available in shared workspaces only.' },
      { status: 400 },
    )
  }
  return { userId: user.id, workspace }
}
