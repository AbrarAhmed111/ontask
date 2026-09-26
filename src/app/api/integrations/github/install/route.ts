import { NextResponse } from 'next/server'
import {
  GithubConfigError,
  authorizeUrl,
  connectStateSecret,
  installUrl,
} from '@/lib/integrations/github/githubApp'
import { encodeConnectState } from '@/lib/integrations/github/signatures'
import { requireWorkspaceOwner } from '@/lib/integrations/github/routeAuth'
import {
  STATE_COOKIE,
  STATE_COOKIE_OPTIONS,
} from '@/lib/integrations/github/connectWorkspace'
import { getBaseUrl } from '@/lib/integrations/slack/slackUrl'

// Step 1 of connecting GitHub to THIS workspace (workspace_id, owner only).
// The signed state names the workspace; everything after trusts only that.
//
// Default: GitHub's OAuth authorize screen. It works whether or not the app is
// already installed -- the callback then asks GitHub which installations this
// GitHub user can access and connects, offers a choice, or sends them on to
// install the app. `?mode=install` goes straight to installing the app on
// another account or organisation.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const owner = await requireWorkspaceOwner(params.get('workspace_id'))
  if (owner instanceof NextResponse) return owner

  try {
    const state = encodeConnectState(connectStateSecret(), {
      userId: owner.userId,
      workspaceId: owner.workspace.id,
      issuedAt: Date.now(),
    })
    const destination =
      params.get('mode') === 'install'
        ? installUrl(state)
        : authorizeUrl(
            state,
            `${getBaseUrl()}/api/integrations/github/callback`,
          )
    const response = NextResponse.redirect(destination)
    response.cookies.set(STATE_COOKIE, state, STATE_COOKIE_OPTIONS)
    return response
  } catch (error) {
    if (error instanceof GithubConfigError) {
      console.error('[GitHub] Not configured:', error.message)
      return NextResponse.json(
        { error: 'GitHub is not configured on this server.' },
        { status: 500 },
      )
    }
    throw error
  }
}
