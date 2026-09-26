import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  getInstallation,
  listInstallationRepositories,
} from '@/lib/integrations/github/githubApp'

// The httpOnly cookie that carries the signed connect state alongside the URL,
// for the one hop where GitHub might not hand `state` back (installing the app
// with OAuth-during-installation). Same signed value, so same trust; scoped to
// these routes and short-lived.
export const STATE_COOKIE = 'ontask_github_state'
export const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/integrations/github',
  maxAge: 15 * 60,
}

// Attach a verified installation to ONE workspace -- the one from the signed
// state, which the caller has already checked the user owns. Only that
// workspace's row is written (the table's key is workspace_id), so connecting
// workspace B never touches workspace A, even when both use the same GitHub
// installation.
//
// The repository:
//   - reconnecting the same installation keeps the repository already chosen,
//     if the installation can still see it;
//   - otherwise exactly one granted repository is chosen automatically;
//   - otherwise (none, or several) the owner picks one in Settings
//     (status repository_required) -- never an arbitrary one.
export async function connectWorkspaceInstallation({
  workspaceId,
  userId,
  installationId,
}: {
  workspaceId: string
  userId: string
  installationId: number
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = createServiceRoleClient()
  const [installation, { repositories }, existingResult] = await Promise.all([
    getInstallation(installationId),
    listInstallationRepositories(installationId),
    service
      .from('workspace_github_connections')
      .select('installation_id, repository_id')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ])

  const existing = existingResult.data
  const kept =
    existing &&
    Number(existing.installation_id) === installationId &&
    existing.repository_id !== null
      ? repositories.find(repo => repo.id === Number(existing.repository_id))
      : undefined
  const repository =
    kept ?? (repositories.length === 1 ? repositories[0] : null)

  const { error } = await service.from('workspace_github_connections').upsert(
    {
      workspace_id: workspaceId,
      installation_id: installationId,
      account_login: installation.account,
      repository_id: repository?.id ?? null,
      repository_full_name: repository?.fullName ?? null,
      repository_url: repository?.htmlUrl ?? null,
      status: repository ? 'connected' : 'repository_required',
      connected_by: userId,
    },
    { onConflict: 'workspace_id' },
  )
  if (error) {
    console.error('[GitHub] Saving the connection failed:', error)
    return { ok: false, error: 'save_failed' }
  }
  return { ok: true }
}
