'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { WorkspaceMembersSection } from '@/components/workspaces/WorkspaceMembersSection'
import { MemberAvailabilityModal } from '@/components/workspaces/MemberAvailabilityModal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import { WorkspaceMember } from '@/types/workspace'

type PendingAction =
  { type: 'remove'; member: WorkspaceMember } | { type: 'leave' }

export function WorkspaceMembersClient() {
  const router = useRouter()
  const {
    user,
    members,
    ready,
    isOwner,
    isPersonal,
    onlineUserIds,
    removeMember,
    invitations,
    invitationsReady,
    cancelInvitation,
    deleteInvitation,
    openInvite,
    updateMemberAvailability,
    workSessionsByUserId,
    activeTasksByUserId,
  } = useWorkspaceDetail()
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [editingAvailability, setEditingAvailability] =
    useState<WorkspaceMember | null>(null)
  const [memberActionError, setMemberActionError] = useState<string | null>(
    null,
  )

  const openMemberAction = (action: PendingAction) => {
    setMemberActionError(null)
    setPendingAction(action)
  }

  const confirmRemove = async () => {
    if (pendingAction?.type !== 'remove') return
    const result = await removeMember(pendingAction.member.userId)
    setPendingAction(null)
    if (result.success) {
      setMemberActionError(null)
      showSuccessToast(
        `${pendingAction.member.fullName || pendingAction.member.email || 'Member'} removed from the workspace.`,
      )
    } else {
      const message = result.error || 'Failed to remove member.'
      setMemberActionError(message)
      showErrorToast(message)
    }
  }

  const confirmLeave = async () => {
    const result = await removeMember(user.id)
    setPendingAction(null)
    if (result.success) {
      router.push('/workspaces')
      return
    }
    const message = result.error || 'Failed to leave workspace.'
    setMemberActionError(message)
    showErrorToast(message)
  }

  const handleCancelInvitation = async (id: string) => {
    const result = await cancelInvitation(id)
    if (result.success) {
      showSuccessToast('Invitation cancelled.')
    } else {
      showErrorToast(result.error || 'Failed to cancel invitation.')
    }
  }

  const handleDeleteInvitation = async (id: string) => {
    const result = await deleteInvitation(id)
    if (result.success) {
      showSuccessToast('Invitation record deleted.')
    } else {
      showErrorToast(result.error || 'Failed to delete invitation record.')
    }
  }

  const handleUpdateAvailability: typeof updateMemberAvailability = async (
    memberId,
    patch,
  ) => {
    const result = await updateMemberAvailability(memberId, patch)
    if (result.success) {
      showSuccessToast('Availability updated.')
    } else {
      showErrorToast(result.error || 'Failed to update availability.')
    }
    return result
  }

  // A personal workspace has no members page (the layout also redirects away
  // from it) — never render member/invitation controls for one.
  if (isPersonal) return null

  return (
    <>
      <WorkspaceMembersSection
        ready={ready}
        error={memberActionError}
        members={members}
        currentUserId={user.id}
        onlineUserIds={onlineUserIds}
        workSessionsByUserId={workSessionsByUserId}
        activeTasksByUserId={activeTasksByUserId}
        isOwner={isOwner}
        onRemoveMember={member => openMemberAction({ type: 'remove', member })}
        onEditAvailability={setEditingAvailability}
        invitationsReady={invitationsReady}
        invitations={invitations}
        onInvite={openInvite}
        onCancelInvitation={handleCancelInvitation}
        onDeleteInvitation={handleDeleteInvitation}
        onLeave={() => openMemberAction({ type: 'leave' })}
      />

      {editingAvailability && (
        <MemberAvailabilityModal
          member={editingAvailability}
          onSave={handleUpdateAvailability}
          onClose={() => setEditingAvailability(null)}
        />
      )}

      {pendingAction?.type === 'remove' && (
        <ConfirmModal
          title="Remove this member?"
          message={`${pendingAction.member.fullName || pendingAction.member.email || 'This member'} will lose access to this workspace immediately.`}
          confirmLabel="Remove member"
          onConfirm={confirmRemove}
          onClose={() => setPendingAction(null)}
        />
      )}
      {pendingAction?.type === 'leave' && (
        <ConfirmModal
          title="Leave this workspace?"
          message="You'll lose access to its tasks and activity. An owner can invite you back later."
          confirmLabel="Leave workspace"
          onConfirm={confirmLeave}
          onClose={() => setPendingAction(null)}
        />
      )}
    </>
  )
}
