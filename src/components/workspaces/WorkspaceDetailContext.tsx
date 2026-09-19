'use client'

import { createContext, useContext } from 'react'
import type { AuthUser } from '@/hooks/useAuth'
import type { useWorkspace } from '@/hooks/useWorkspace'
import type { useWorkspaceInvitations } from '@/hooks/useWorkspaceInvitations'
import type { useWorkspaceSlack } from '@/hooks/useWorkspaceSlack'
import type { SlackChannel } from '@/lib/integrations/slack/slackClient'
import type {
  SlackStatusData,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '@/types/workspace'

// Shared, layout-level workspace state (workspace/members/role/invitations/
// presence/slack) that every nested page (overview, members, settings) needs —
// fetched once in the layout so switching between them doesn't re-fetch it.
export type WorkspaceDetailContextValue = {
  workspaceId: string
  user: AuthUser
  workspace: Workspace | null
  members: WorkspaceMember[]
  role: WorkspaceRole | null
  isOwner: boolean
  // True for the user's Personal Workspace: private, owner-only, no members
  // or invitations, no assigning tasks to anyone else. Components that only
  // make sense with collaborators check this instead of guessing from the
  // member count (a shared workspace can also have just one member).
  isPersonal: boolean
  ready: boolean
  error: string | null
  updateWorkspace: ReturnType<typeof useWorkspace>['updateWorkspace']
  removeMember: ReturnType<typeof useWorkspace>['removeMember']
  onlineUserIds: Set<string>
  invitations: ReturnType<typeof useWorkspaceInvitations>['invitations']
  invitationsReady: boolean
  inviteByEmail: ReturnType<typeof useWorkspaceInvitations>['inviteByEmail']
  cancelInvitation: ReturnType<
    typeof useWorkspaceInvitations
  >['cancelInvitation']
  deleteInvitation: ReturnType<
    typeof useWorkspaceInvitations
  >['deleteInvitation']
  openInvite: () => void
  onLogout: () => void

  // Workspace-scoped Slack Integration
  slackStatus: SlackStatusData | null
  slackLoading: boolean
  slackError: string | null
  slackChannels: SlackChannel[]
  slackChannelsLoading: boolean
  refetchSlackStatus: ReturnType<typeof useWorkspaceSlack>['refetchSlackStatus']
  refetchSlackChannels: ReturnType<typeof useWorkspaceSlack>['refetchChannels']
  updateSlackStatus: ReturnType<typeof useWorkspaceSlack>['updateSlackStatus']
  saveSlackSettings: ReturnType<typeof useWorkspaceSlack>['saveSlackSettings']
  disconnectSlack: ReturnType<typeof useWorkspaceSlack>['disconnectSlack']
}

export const WorkspaceDetailContext =
  createContext<WorkspaceDetailContextValue | null>(null)

// For components that render both inside a workspace layout and, in principle,
// outside one — returns null instead of throwing.
export function useOptionalWorkspaceDetail() {
  return useContext(WorkspaceDetailContext)
}

export function useWorkspaceDetail() {
  const ctx = useContext(WorkspaceDetailContext)
  if (!ctx) {
    throw new Error(
      'useWorkspaceDetail must be used within the workspace detail layout',
    )
  }
  return ctx
}
