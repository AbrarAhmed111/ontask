import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  getInstallation,
  listInstallationRepositories,
} from '@/lib/integrations/github/githubApp'
import { requireWorkspaceOwner } from '@/lib/integrations/github/routeAuth'

async function installationFor(workspaceId: string) {
  const { data } = await createServiceRoleClient()
    .from('workspace_github_connections')
    .select('installation_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return data ? Number(data.installation_id) : null
}

// The repositories the owner granted the OnTask app, to pick the one this
// workspace tracks -- plus the installation's page on GitHub (`manageUrl`),
// where they grant or remove repositories. GitHub doesn't send people back
// from that page, so the card links to it in a new tab and re-reads this list
// afterwards.
export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get('workspace_id')
  const owner = await requireWorkspaceOwner(workspaceId)
  if (owner instanceof NextResponse) return owner

  const installationId = await installationFor(owner.workspace.id)
  if (!installationId) {
    return NextResponse.json(
      { error: 'GitHub is not connected.' },
      { status: 404 },
    )
  }
  try {
    const [list, installation] = await Promise.all([
      listInstallationRepositories(installationId),
      getInstallation(installationId),
    ])
    return NextResponse.json({ ...list, manageUrl: installation.manageUrl })
  } catch (error) {
    console.error('[GitHub] Listing repositories failed:', error)
    return NextResponse.json(
      { error: "Couldn't reach GitHub. Try again in a moment." },
      { status: 502 },
    )
  }
}

// Choose the repository. It must be one the installation actually covers --
// the id comes from the browser, so it is checked against GitHub, not trusted.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string
    repositoryId?: number
  } | null
  const owner = await requireWorkspaceOwner(body?.workspaceId)
  if (owner instanceof NextResponse) return owner

  const installationId = await installationFor(owner.workspace.id)
  if (!installationId) {
    return NextResponse.json(
      { error: 'GitHub is not connected.' },
      { status: 404 },
    )
  }
  try {
    const { repositories } = await listInstallationRepositories(installationId)
    const repository = repositories.find(repo => repo.id === body?.repositoryId)
    if (!repository) {
      return NextResponse.json(
        { error: 'That repository is not available to OnTask.' },
        { status: 400 },
      )
    }
    const { error } = await createServiceRoleClient()
      .from('workspace_github_connections')
      .update({
        repository_id: repository.id,
        repository_full_name: repository.fullName,
        repository_url: repository.htmlUrl,
        status: 'connected',
      })
      .eq('workspace_id', owner.workspace.id)
    if (error) {
      console.error('[GitHub] Saving the repository failed:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[GitHub] Choosing a repository failed:', error)
    return NextResponse.json(
      { error: "Couldn't reach GitHub. Try again in a moment." },
      { status: 502 },
    )
  }
}
