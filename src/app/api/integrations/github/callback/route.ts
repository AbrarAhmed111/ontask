import { NextRequest, NextResponse } from 'next/server'
import {
  authorizeUrl,
  connectStateSecret,
  installUrl,
  listUserInstallations,
} from '@/lib/integrations/github/githubApp'
import {
  decodeConnectState,
  encodeInstallationChoice,
} from '@/lib/integrations/github/signatures'
import { requireWorkspaceOwner } from '@/lib/integrations/github/routeAuth'
import {
  STATE_COOKIE,
  STATE_COOKIE_OPTIONS,
  connectWorkspaceInstallation,
} from '@/lib/integrations/github/connectWorkspace'
import { getBaseUrl } from '@/lib/integrations/slack/slackUrl'

// Step 2: GitHub returns here -- the app's Callback URL -- in two situations,
// both with `code` and (normally) `state`:
//   a) after the OAuth authorize screen (every connection starts there), with
//      no installation id;
//   b) after installing the app ("Request user authorization (OAuth) during
//      installation" is on), with `installation_id` and `setup_action`.
//
// Nothing in the URL is trusted on its own:
//   - `state` must be ours (signed, recent), started by this same OnTask user,
//     who must still own the workspace. The workspace in `state` is the only
//     one ever written.
//   - `code` is exchanged for a one-off user token that asks GitHub which
//     installations of this app THIS GitHub user can access; the token is then
//     dropped. An installation id from the URL is used only if it is in that
//     list.
//
// Then: one accessible installation -> connected; several -> the owner picks
// one (signed list, api/integrations/github/installation); none -> on to
// installing the app.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const base = getBaseUrl()
  const secret = connectStateSecret()
  const rawState = params.get('state')
  const urlState = decodeConnectState(secret, rawState)
  const cookieValue = request.cookies.get(STATE_COOKIE)?.value ?? null
  const cookieState = decodeConnectState(secret, cookieValue)

  // GitHub came back without our state (the install hop can): start the
  // authorize step again with the state this browser was given, and ignore
  // this `code` -- a code is only ever used together with a valid state from
  // the URL, or a crafted link could attach someone else's installation.
  if (rawState === null && cookieValue && cookieState) {
    return NextResponse.redirect(
      authorizeUrl(cookieValue, `${base}/api/integrations/github/callback`),
    )
  }
  if (!urlState || rawState === null) {
    return NextResponse.redirect(`${base}/workspaces?github_error=expired`)
  }

  const owner = await requireWorkspaceOwner(urlState.workspaceId)
  if (owner instanceof NextResponse) return owner
  const settingsUrl = `${base}/workspaces/${owner.workspace.slug}/settings`
  const done = (query: string) => {
    const response = NextResponse.redirect(`${settingsUrl}?${query}`)
    response.cookies.set(STATE_COOKIE, '', {
      ...STATE_COOKIE_OPTIONS,
      maxAge: 0,
    })
    return response
  }
  const fail = (reason: string) =>
    done(`github_error=${encodeURIComponent(reason)}`)

  if (owner.userId !== urlState.userId) return fail('different_user')
  const workspaceId = owner.workspace.id
  const userId = urlState.userId
  const state = rawState
  const finish = async (id: number) => {
    const result = await connectWorkspaceInstallation({
      workspaceId,
      userId,
      installationId: id,
    })
    return result.ok ? done('github=connected') : fail(result.error)
  }

  // The user said no on GitHub's authorize screen.
  if (params.get('error')) return fail('authorization_cancelled')
  // An organisation member without admin rights can only *request* the app.
  if (params.get('setup_action') === 'request') return fail('approval_pending')

  const code = params.get('code')
  if (!code) return fail('authorization_required')
  const rawInstallationId = params.get('installation_id')
  const installationId =
    rawInstallationId === null ? null : Number(rawInstallationId)
  if (
    installationId !== null &&
    (!Number.isSafeInteger(installationId) || installationId <= 0)
  ) {
    return fail('missing_installation')
  }

  try {
    const installations = await listUserInstallations(code)
    if (!installations) return fail('authorization_failed')

    // Just installed: it must be one this GitHub user can access.
    if (installationId !== null) {
      if (!installations.some(item => item.id === installationId)) {
        return fail('installation_not_yours')
      }
      return finish(installationId)
    }

    if (installations.length === 1) return finish(installations[0].id)

    if (installations.length > 1) {
      const token = encodeInstallationChoice(secret, {
        userId,
        workspaceId,
        issuedAt: Date.now(),
        installations: installations.map(item => ({
          id: item.id,
          account: item.account,
        })),
      })
      return done(`github_choose=${encodeURIComponent(token)}`)
    }

    // No installation this user can access yet: install the app. GitHub
    // returns here afterwards (case b).
    const response = NextResponse.redirect(installUrl(state))
    response.cookies.set(STATE_COOKIE, state, STATE_COOKIE_OPTIONS)
    return response
  } catch (error) {
    console.error('[GitHub] Connect callback failed:', error)
    return fail('github_unavailable')
  }
}
