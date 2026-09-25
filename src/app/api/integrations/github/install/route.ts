import { NextResponse } from 'next/server'
import {
  GithubConfigError,
  connectStateSecret,
  installUrl,
} from '@/lib/integrations/github/githubApp'
import { encodeConnectState } from '@/lib/integrations/github/signatures'
import { requireWorkspaceOwner } from '@/lib/integrations/github/routeAuth'

// Step 1 of connecting GitHub: send the owner to GitHub to install the OnTask
// app on the account/repositories they choose. GitHub comes back to
// ./callback with the installation id and this signed state.
export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get('workspace_id')
  const owner = await requireWorkspaceOwner(workspaceId)
  if (owner instanceof NextResponse) return owner

  try {
    const state = encodeConnectState(connectStateSecret(), {
      userId: owner.userId,
      workspaceId: owner.workspace.id,
      issuedAt: Date.now(),
    })
    return NextResponse.redirect(installUrl(state))
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
