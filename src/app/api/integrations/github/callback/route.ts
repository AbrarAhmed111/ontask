import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  connectStateSecret,
  getInstallationAccount,
  listInstallationRepositories,
  userCanAccessInstallation,
} from '@/lib/integrations/github/githubApp'
import { decodeConnectState } from '@/lib/integrations/github/signatures'
import { requireWorkspaceOwner } from '@/lib/integrations/github/routeAuth'
import { getBaseUrl } from '@/lib/integrations/slack/slackUrl'

// Step 2: GitHub returns here after the app was installed (the app's Callback
// URL, with "Request user authorization (OAuth) during installation" on so a
// `code` comes back with the installation id). Nothing is trusted from the URL
// alone:
//   - `state` must be ours (signed, recent) and started by this same user;
//   - they must still be the workspace owner;
//   - `code` proves, via GitHub, that this user can see the installation --
//     so nobody can attach another account's installation by editing the URL.
// Only then is the installation id stored (no token -- see githubApp.ts).
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const base = getBaseUrl()
  const state = decodeConnectState(connectStateSecret(), params.get('state'))
  if (!state) {
    return NextResponse.redirect(`${base}/workspaces?github_error=expired`)
  }

  const owner = await requireWorkspaceOwner(state.workspaceId)
  if (owner instanceof NextResponse) return owner
  const settingsUrl = `${base}/workspaces/${owner.workspace.slug}/settings`
  const fail = (reason: string) =>
    NextResponse.redirect(
      `${settingsUrl}?github_error=${encodeURIComponent(reason)}`,
    )

  if (owner.userId !== state.userId) return fail('different_user')
  // An organisation member without admin rights can only *request* the app.
  if (params.get('setup_action') === 'request') return fail('approval_pending')

  const installationId = Number(params.get('installation_id'))
  const code = params.get('code')
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    return fail('missing_installation')
  }
  if (!code) return fail('authorization_required')

  try {
    if (!(await userCanAccessInstallation(code, installationId))) {
      return fail('installation_not_yours')
    }

    const [accountLogin, { repositories }] = await Promise.all([
      getInstallationAccount(installationId),
      listInstallationRepositories(installationId),
    ])
    // One repository granted: nothing to choose, so use it.
    const only = repositories.length === 1 ? repositories[0] : null

    const { error } = await createServiceRoleClient()
      .from('workspace_github_connections')
      .upsert(
        {
          workspace_id: owner.workspace.id,
          installation_id: installationId,
          account_login: accountLogin,
          repository_id: only?.id ?? null,
          repository_full_name: only?.fullName ?? null,
          repository_url: only?.htmlUrl ?? null,
          status: only ? 'connected' : 'repository_required',
          connected_by: owner.userId,
        },
        { onConflict: 'workspace_id' },
      )
    if (error) {
      console.error('[GitHub] Saving the connection failed:', error)
      return fail('save_failed')
    }
    return NextResponse.redirect(`${settingsUrl}?github=connected`)
  } catch (error) {
    console.error('[GitHub] Connect callback failed:', error)
    return fail('github_unavailable')
  }
}
