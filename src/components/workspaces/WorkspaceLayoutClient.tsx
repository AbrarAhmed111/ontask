'use client'

import { ReactNode, Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useAuthGuard } from '@/hooks/useAuthGuard'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useWorkspaceInvitations } from '@/hooks/useWorkspaceInvitations'
import { useWorkspacePresence } from '@/hooks/useWorkspacePresence'
import { usePersonalWelcome } from '@/hooks/usePersonalWelcome'
import { useWorkspaceSlack } from '@/hooks/useWorkspaceSlack'
import { InviteMemberModal } from '@/components/workspaces/InviteMemberModal'
import { PersonalWelcomeModal } from '@/components/workspaces/PersonalWelcomeModal'
import { GuestWorkPrompt } from '@/components/auth/GuestWorkPrompt'
import { SlackToastFromUrl } from '@/components/workspaces/SlackToastFromUrl'
import { TourProvider } from '@/components/tour/TourProvider'
import {
  WorkspaceShell,
  WorkspaceSection,
} from '@/components/workspaces/WorkspaceShell'
import { WorkspaceThemeScope } from '@/components/workspaces/WorkspaceThemeScope'
import {
  WorkspaceDetailContext,
  WorkspaceDetailContextValue,
} from '@/components/workspaces/WorkspaceDetailContext'
import type { AuthUser } from '@/hooks/useAuth'
import { useAppSelector } from '@/lib/redux/hooks'
import {
  CachedWorkspaceIdentity,
  selectCachedWorkspaceIdentity,
} from '@/lib/redux/workspaceCacheSlice'
import { saveTourOutcome } from '@/lib/tour/progress'
import { showErrorToast } from '@/lib/toast'
import type { TourId, TourOutcome } from '@/lib/tour/types'
import { PERSONAL_WORKSPACE_SLUG } from '@/lib/workspaces'

// The section a pathname like /workspaces/[slug], /workspaces/[slug]/members
// or /workspaces/[slug]/settings maps to — derived from the URL (instead of
// component state) so the sidebar, the URL bar, and a page refresh all agree
// on which page is open.
function sectionFromPathname(pathname: string): WorkspaceSection {
  if (pathname.endsWith('/members')) return 'members'
  if (pathname.endsWith('/settings')) return 'settings'
  return 'overview'
}

export function WorkspaceLayoutClient({
  workspaceSlug,
  initialIdentity,
  children,
}: {
  workspaceSlug: string
  // The workspace's identity as the server read it for this request (see
  // app/workspaces/[workspaceSlug]/layout.tsx), if it could.
  initialIdentity?: CachedWorkspaceIdentity
  children: ReactNode
}) {
  const { user, ready: authReady, handleLogout } = useAuthGuard()

  if (!authReady || !user) {
    return <main className="min-h-screen bg-paper" />
  }

  return (
    <WorkspaceLayout
      workspaceSlug={workspaceSlug}
      initialIdentity={initialIdentity}
      user={user}
      onLogout={handleLogout}
    >
      {children}
    </WorkspaceLayout>
  )
}

// Exported for tests only -- the app renders it through WorkspaceLayoutClient,
// which is what waits for the signed-in user.
export function WorkspaceLayout({
  workspaceSlug,
  initialIdentity,
  user,
  onLogout,
  children,
}: {
  workspaceSlug: string
  initialIdentity?: CachedWorkspaceIdentity
  user: AuthUser
  onLogout: () => void
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const section = sectionFromPathname(pathname)
  const {
    workspace,
    members,
    role,
    ready,
    error,
    syncError,
    updateWorkspace,
    removeMember,
  } = useWorkspace(workspaceSlug, user)
  // A failed refresh leaves the last copy on screen (it never replaces the page,
  // unlike `error`); say so once, so an out-of-date view isn't mistaken for a
  // current one.
  useEffect(() => {
    if (syncError) showErrorToast(syncError)
  }, [syncError])
  // The real workspace uuid, once resolved -- every downstream hook below
  // (and everything handed down via context) keys off this, never the URL
  // slug, since that's what workspace_id FKs and realtime filters expect.
  const workspaceId = workspace?.id ?? ''
  // What to paint the workspace's name, timezone AND accent from before its row
  // has loaded (that needs a network round trip), so the first paint already
  // has the real ones instead of the default followed by a switch. Two sources,
  // in order of trust:
  //   1. what the server read for this very request (initialIdentity) -- always
  //      current, and there even on a browser that has never opened the
  //      workspace;
  //   2. the localStorage cache of an earlier visit -- instant, but empty on a
  //      new browser and stale if the accent was changed from another device,
  //      so it only fills in when the server couldn't read the workspace.
  // A personal workspace is found in the cache by who is signed in rather than
  // by its URL alias (see selectCachedWorkspaceIdentity), so it never paints
  // another account's.
  const localIdentity = useAppSelector(state =>
    selectCachedWorkspaceIdentity(state.workspaceCache, {
      workspaceId,
      workspaceSlug: workspace?.slug ?? workspaceSlug,
      userId: user.id,
    }),
  )
  const paintIdentity = initialIdentity ?? localIdentity
  // Known from the URL alone before the workspace row has loaded, so the
  // shell can render the personal header (and skip collaboration-only work)
  // from the very first paint.
  const isPersonal = workspace
    ? workspace.type === 'personal'
    : workspaceSlug === PERSONAL_WORKSPACE_SLUG
  // A personal workspace has no invitations and only ever one member (you),
  // so its invitation list and presence channel are never even opened.
  const collaborationWorkspaceId = isPersonal ? '' : workspaceId
  const {
    invitations,
    ready: invitationsReady,
    inviteByEmail,
    cancelInvitation,
    deleteInvitation,
  } = useWorkspaceInvitations(collaborationWorkspaceId, user)
  const onlineUserIds = useWorkspacePresence(collaborationWorkspaceId, user)
  const [inviting, setInviting] = useState(false)
  const welcome = usePersonalWelcome({ user, workspace, updateWorkspace })
  const slack = useWorkspaceSlack(workspaceId, user, isPersonal)

  // Skipping or finishing a tour is remembered per user and workspace so it
  // doesn't come back on its own. The tour is already gone from the screen by
  // now, so a failed save is only logged -- worst case it is offered again.
  const userId = user.id
  const recordTourOutcome = useCallback(
    (tourId: TourId, outcome: TourOutcome) => {
      if (!workspaceId) return
      saveTourOutcome(userId, workspaceId, tourId, outcome).catch(error =>
        console.error('Could not save tour progress:', error),
      )
    },
    [userId, workspaceId],
  )

  // A personal workspace has exactly one URL. Reaching it through its stored
  // slug (an old link, a notification) or through the members page — which a
  // personal workspace doesn't have — lands back on the canonical page.
  useEffect(() => {
    if (!workspace || workspace.type !== 'personal') return
    if (workspaceSlug !== PERSONAL_WORKSPACE_SLUG) {
      router.replace(`/workspaces/${PERSONAL_WORKSPACE_SLUG}`)
    } else if (section === 'members') {
      router.replace(`/workspaces/${PERSONAL_WORKSPACE_SLUG}`)
    }
  }, [workspace, workspaceSlug, section, router])

  if (ready && (error || !workspace)) {
    return (
      <main className="min-h-screen bg-paper">
        <div className="mx-auto flex min-h-screen w-[min(560px,calc(100%-32px))] flex-col items-center justify-center text-center">
          <div className="rounded-2xl border border-coral/20 bg-coral/5 p-6">
            <p className="text-sm font-semibold text-coral">
              {error || 'Workspace not found.'}
            </p>
            <Link
              href="/workspaces"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-forest hover:text-coral"
            >
              <ArrowLeft size={14} /> Back to Workspaces
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const isOwner = role === 'owner'

  const handleSectionChange = (next: WorkspaceSection) => {
    const base = `/workspaces/${workspace?.slug ?? workspaceSlug}`
    router.push(next === 'overview' ? base : `${base}/${next}`)
  }

  const contextValue: WorkspaceDetailContextValue = {
    workspaceId,
    user,
    workspace,
    members,
    role,
    isOwner,
    isPersonal,
    ready,
    error,
    updateWorkspace,
    removeMember,
    onlineUserIds,
    invitations,
    invitationsReady,
    inviteByEmail,
    cancelInvitation,
    deleteInvitation,
    openInvite: () => setInviting(true),
    onLogout,
    slackStatus: slack.slackStatus,
    slackLoading: slack.slackLoading,
    slackError: slack.slackError,
    slackChannels: slack.channels,
    slackChannelsLoading: slack.loadingChannels,
    refetchSlackStatus: slack.refetchSlackStatus,
    refetchSlackChannels: slack.refetchChannels,
    updateSlackStatus: slack.updateSlackStatus,
    saveSlackSettings: slack.saveSlackSettings,
    disconnectSlack: slack.disconnectSlack,
  }

  return (
    <WorkspaceDetailContext.Provider value={contextValue}>
      {/* The live workspace's accent, else the remembered one. It wraps the
          shell and every dialog below so they all inherit the same accent. */}
      <WorkspaceThemeScope accent={workspace?.accent ?? paintIdentity?.accent}>
        {/* The first-visit welcome comes first: the personal tour opens once
            it has been shown and dismissed, not while it is still being
            decided. */}
        <TourProvider
          paused={isPersonal && (!welcome.checked || welcome.open)}
          onOutcome={recordTourOutcome}
        >
          <WorkspaceShell
            workspaceId={workspaceId}
            workspace={workspace}
            paintIdentity={paintIdentity}
            members={members}
            role={role}
            ready={ready}
            user={user}
            onlineUserIds={onlineUserIds}
            section={section}
            onSectionChange={handleSectionChange}
            isPersonal={isPersonal}
            onInvite={
              isOwner && !isPersonal ? () => setInviting(true) : undefined
            }
            onLogout={onLogout}
          >
            {children}
          </WorkspaceShell>

          {inviting && !isPersonal && (
            <InviteMemberModal
              onInvite={inviteByEmail}
              onClose={() => setInviting(false)}
            />
          )}
          {isPersonal && welcome.open && (
            <PersonalWelcomeModal onClose={welcome.close} />
          )}
          {isPersonal && ready && (
            <GuestWorkPrompt suppressed={!welcome.checked || welcome.open} />
          )}
          <Suspense fallback={null}>
            <SlackToastFromUrl onSlackConnected={slack.refetchSlackStatus} />
          </Suspense>
        </TourProvider>
      </WorkspaceThemeScope>
    </WorkspaceDetailContext.Provider>
  )
}
