import { NextResponse } from 'next/server'
import { connectStateSecret } from '@/lib/integrations/github/githubApp'
import { decodeInstallationChoice } from '@/lib/integrations/github/signatures'
import { requireWorkspaceOwner } from '@/lib/integrations/github/routeAuth'
import { connectWorkspaceInstallation } from '@/lib/integrations/github/connectWorkspace'

// The owner picks which GitHub account's installation this workspace uses,
// when their GitHub user can access more than one (the callback sent them to
// Settings with a signed list). The installation id from the browser is only
// accepted if it is in that list, and the list only for the same OnTask user
// and the same workspace it was issued for, while still fresh.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string
    installationId?: number
    token?: string
  } | null
  const owner = await requireWorkspaceOwner(body?.workspaceId)
  if (owner instanceof NextResponse) return owner

  const choice = decodeInstallationChoice(
    connectStateSecret(),
    body?.token ?? null,
  )
  if (
    !choice ||
    choice.userId !== owner.userId ||
    choice.workspaceId !== owner.workspace.id
  ) {
    return NextResponse.json(
      { error: 'This choice has expired. Connect GitHub again.' },
      { status: 400 },
    )
  }
  if (!choice.installations.some(item => item.id === body?.installationId)) {
    return NextResponse.json(
      { error: 'That GitHub account is not available to you.' },
      { status: 400 },
    )
  }

  try {
    const result = await connectWorkspaceInstallation({
      workspaceId: owner.workspace.id,
      userId: owner.userId,
      installationId: body!.installationId!,
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: "Couldn't save the GitHub connection." },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[GitHub] Choosing an installation failed:', error)
    return NextResponse.json(
      { error: "Couldn't reach GitHub. Try again in a moment." },
      { status: 502 },
    )
  }
}
