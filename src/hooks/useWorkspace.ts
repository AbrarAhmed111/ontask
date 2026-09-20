'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AuthUser } from '@/hooks/useAuth'
import type {
  MemberAvailabilityPatch,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '@/types/workspace'
import { useAppDispatch } from '@/lib/redux/hooks'
import {
  toCachedWorkspaceIdentity,
  upsertPersonalWorkspaceIdentity,
  upsertWorkspaceIdentity,
} from '@/lib/redux/workspaceCacheSlice'
import {
  PERSONAL_WORKSPACE_SLUG,
  WorkspacePatch,
  WorkspaceRow,
  rowToWorkspace,
  workspacePatchToRow,
} from '@/lib/workspaces'
import { useWorkspaceSnapshot } from '@/hooks/useWorkspaceSnapshot'
import { useFetchStatus } from '@/hooks/useFetchStatus'
import { SNAPSHOTS, WorkspaceDetail } from '@/lib/cache/workspaceSnapshots'
import {
  clearWorkspaceCache,
  deleteCache,
  readCache,
} from '@/lib/cache/cacheStore'

type WorkspaceMemberRow = {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  joined_at: string
  working_hours_start: string | null
  working_hours_end: string | null
  working_timezone: string | null
  working_days: number[] | null
  standup_availability_start: string | null
  standup_availability_end: string | null
  standup_availability_days: number[] | null
  minimum_working_minutes: number | null
  profiles: {
    full_name: string | null
    email: string | null
    avatar_url: string | null
  } | null
}

function rowToMember(row: WorkspaceMemberRow): WorkspaceMember {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: row.joined_at,
    fullName: row.profiles?.full_name ?? null,
    email: row.profiles?.email ?? null,
    avatarUrl: row.profiles?.avatar_url ?? null,
    workingHoursStart: row.working_hours_start ?? null,
    workingHoursEnd: row.working_hours_end ?? null,
    workingTimezone: row.working_timezone ?? null,
    workingDays: row.working_days ?? [],
    standupAvailabilityStart: row.standup_availability_start ?? null,
    standupAvailabilityEnd: row.standup_availability_end ?? null,
    standupAvailabilityDays: row.standup_availability_days ?? [],
    minimumWorkingMinutes: row.minimum_working_minutes ?? null,
  }
}

const NO_DETAIL: WorkspaceDetail = { workspace: null, members: [] }
const LOAD_MESSAGE =
  "Couldn't load this workspace — it may not exist, or you may not be a member."
const REFRESH_MESSAGE =
  "Couldn't refresh this workspace — you may be seeing an out-of-date copy."

// The server's own "you can't have this": PGRST116 is "no rows" (deleted, or
// row-level security hides it from the caller), 42501 is "permission denied". A
// failed request (offline, server down) is NOT one of these -- it says nothing
// about access, so it must never remove what is cached.
function isNoAccess(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST116' || error?.code === '42501'
}

// Single-workspace detail: the workspace row, its member list (with profile
// info embedded via the profiles FK — see 0004's migration comment), and the
// caller's own role, so pages can show owner-only controls contextually.
//
// `workspaceSlug` is the URL-facing identifier (0019) -- resolved to the
// workspace's real uuid below before anything else (members, invitations,
// presence, tasks, the Daily Report) queries by workspace_id, since every
// other table's FK -- and every realtime filter -- is keyed by that uuid,
// never the slug.
//
// `personal-workspace` is the one slug that isn't a lookup key: it's the same
// URL for every user and means "MY personal workspace", resolved by owner
// rather than by slug -- so it can only ever resolve to the signed-in user's
// own row, never someone else's.
//
// The row and its members are cached on this device (keyed by user + slug, the
// only thing known before the row loads) and shown while they are fetched. That
// is for rendering only:
//   - `role` -- what the caller may do -- comes solely from a member list the
//     server has confirmed this session, never from the cache. (The database
//     enforces permissions regardless; this only avoids offering controls it
//     would refuse.)
//   - a refresh that fails leaves the cached copy on screen and is reported as
//     `syncError`; `error` (which replaces the page) is only for "there is
//     nothing to show" or a real "no access" answer.
//   - a "no access" answer, or a member list that no longer includes the caller,
//     deletes everything cached for that workspace, so it can't reappear from
//     disk once access is gone.
export function useWorkspace(workspaceSlug: string, user: AuthUser | null) {
  const userId = user?.id
  const dispatch = useAppDispatch()
  const snapshot = useWorkspaceSnapshot<WorkspaceDetail>({
    userId,
    scope: workspaceSlug,
    descriptor: SNAPSHOTS.workspaceDetail,
    initial: NO_DETAIL,
    // "No access" is an answer, not something to remember.
    shouldPersist: detail => detail.workspace !== null,
    workspaceIdOf: detail => detail.workspace?.id ?? null,
  })
  const { data: detail, setData: setDetail, confirm } = snapshot
  const { workspace, members } = detail

  const fetchKey = userId && workspaceSlug ? `${userId}|${workspaceSlug}` : null
  const status = useFetchStatus(snapshot, fetchKey, {
    load: LOAD_MESSAGE,
    refresh: REFRESH_MESSAGE,
  })
  const { failed: markFailed, succeeded: markSucceeded } = status
  // The key for which the server refused access; and for which a member list
  // has been read from the server (so `role` can be trusted).
  const [deniedKey, setDeniedKey] = useState<string | null>(null)
  const [membersConfirmedKey, setMembersConfirmedKey] = useState<string | null>(
    null,
  )
  const membersRef = useRef(members)
  membersRef.current = members
  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace
  // The workspace this hook had on screen when access was refused. Once it is
  // refused there is no workspace left to read the id from.
  const refusedRef = useRef<{ key: string; workspaceId: string } | null>(null)

  // Remember the workspace's near-static identity (name, accent, timezone) so
  // the next visit — a refresh, or coming back to it — paints its real
  // accent immediately instead of flashing the default until the network
  // answers. A personal workspace is cached under its owner, not its slug: its
  // URL alias is identical for every user, so a slug key would let one
  // account's accent paint for the next account on this browser.
  const cacheIdentity = useCallback(
    (ws: Workspace) => {
      const identity = toCachedWorkspaceIdentity(ws)
      if (ws.type !== 'personal') dispatch(upsertWorkspaceIdentity(identity))
      else if (userId)
        dispatch(upsertPersonalWorkspaceIdentity({ ownerId: userId, identity }))
    },
    [dispatch, userId],
  )

  const denied = fetchKey !== null && deniedKey === fetchKey

  // Access was refused: drop everything cached for this workspace. Its id is
  // what the hook had on screen (a workspace loaded a moment ago has not been
  // written to disk yet), else what the cached entry says -- the slug alone is
  // all that is otherwise known.
  useEffect(() => {
    if (!denied || !userId || !fetchKey) return
    void (async () => {
      const entity = SNAPSHOTS.workspaceDetail.entity
      const cached = await readCache<Partial<WorkspaceDetail>>(
        userId,
        entity,
        workspaceSlug,
      )
      await deleteCache(userId, entity, workspaceSlug)
      const shown =
        refusedRef.current?.key === fetchKey
          ? refusedRef.current.workspaceId
          : undefined
      const workspaceId = shown ?? cached?.data?.workspace?.id
      if (typeof workspaceId === 'string') {
        await clearWorkspaceCache(userId, workspaceId)
      }
    })()
  }, [denied, userId, fetchKey, workspaceSlug])

  useEffect(() => {
    if (!userId || !workspaceSlug || !fetchKey) return
    let cancelled = false
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let handleReconnect: (() => void) | null = null
    let handleVisibility: (() => void) | null = null

    // A fresh start for this key: an earlier refusal (say, before accepting an
    // invitation) must not outlive it.
    setDeniedKey(current => (current === fetchKey ? null : current))

    // The server has said the caller can't have this workspace. What is shown
    // and what is cached both go.
    const accessLost = () => {
      const shown = workspaceRef.current
      if (shown) refusedRef.current = { key: fetchKey, workspaceId: shown.id }
      setDeniedKey(fetchKey)
      setMembersConfirmedKey(null)
      confirm(NO_DETAIL)
    }

    // null when the member list could not be read (offline, server error).
    const readMembers = async (workspaceId: string) => {
      const { data, error } = await supabase
        .from('workspace_members')
        .select('*, profiles(full_name, email, avatar_url)')
        .eq('workspace_id', workspaceId)
        .order('joined_at', { ascending: true })
      if (error || !data) return null
      return (data as WorkspaceMemberRow[]).map(rowToMember)
    }

    // Realtime payloads carry only the raw row (no embedded profiles
    // join), so a member-joined/removed event just triggers a fresh
    // fetch of the full list rather than trying to merge a partial row.
    const refreshMembers = async (workspaceId: string) => {
      const list = await readMembers(workspaceId)
      if (cancelled || !list) return
      // Once removed, row-level security hides the list from the caller: a
      // confirmed list that no longer includes them means access is gone.
      if (!list.some(member => member.userId === userId)) {
        accessLost()
        return
      }
      setDetail(current => ({ ...current, members: list }))
      setMembersConfirmedKey(fetchKey)
    }

    const loadWorkspaceRow = async () => {
      if (workspaceSlug !== PERSONAL_WORKSPACE_SLUG) {
        return supabase
          .from('workspaces')
          .select('*')
          .eq('slug', workspaceSlug)
          .single()
      }
      const personal = await supabase
        .from('workspaces')
        .select('*')
        .eq('type', 'personal')
        .eq('owner_id', userId)
        .maybeSingle()
      if (personal.data || personal.error) return personal
      // Every account gets one at signup; this only fills the gap for an
      // account whose signup-time provisioning didn't run. Idempotent.
      return supabase.rpc('ensure_personal_workspace').single()
    }

    loadWorkspaceRow().then(async workspaceResult => {
      if (cancelled) return
      if (workspaceResult.error || !workspaceResult.data) {
        if (isNoAccess(workspaceResult.error)) accessLost()
        else markFailed()
        return
      }
      const loaded = rowToWorkspace(workspaceResult.data as WorkspaceRow)
      // Show the row as soon as it is known, so the sections below can start
      // loading from its id. It is not "confirmed" until the members are in.
      setDetail(current => ({ ...current, workspace: loaded }))
      cacheIdentity(loaded)

      const list = await readMembers(loaded.id)
      if (cancelled) return
      if (list) setMembersConfirmedKey(fetchKey)
      // A member list that could not be read keeps what was shown (cached, or
      // nothing) rather than blocking the page on it; `role` stays unknown
      // until one has been read.
      confirm({ workspace: loaded, members: list ?? membersRef.current })
      markSucceeded()

      channel = supabase
        .channel(`workspace-members-${loaded.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'workspace_members',
            filter: `workspace_id=eq.${loaded.id}`,
          },
          () => {
            if (!cancelled) void refreshMembers(loaded.id)
          },
        )
        .subscribe()

      handleReconnect = () => void refreshMembers(loaded.id)
      handleVisibility = () => {
        if (
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible' &&
          handleReconnect
        )
          handleReconnect()
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('online', handleReconnect)
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibility)
      }
    })

    return () => {
      cancelled = true
      if (typeof window !== 'undefined' && handleReconnect) {
        window.removeEventListener('online', handleReconnect)
      }
      if (typeof document !== 'undefined' && handleVisibility) {
        document.removeEventListener('visibilitychange', handleVisibility)
      }
      if (channel) supabase.removeChannel(channel)
    }
  }, [
    userId,
    workspaceSlug,
    fetchKey,
    cacheIdentity,
    confirm,
    setDetail,
    markFailed,
    markSucceeded,
  ])

  const membersConfirmed = fetchKey !== null && membersConfirmedKey === fetchKey
  const role = membersConfirmed
    ? (members.find(member => member.userId === userId)?.role ?? null)
    : null

  // `error` replaces the page: a refused access, or a failure with nothing to
  // show. A failed refresh with a cached copy on screen is only `syncError`.
  const error = denied
    ? LOAD_MESSAGE
    : status.error !== null && snapshot.origin === 'empty'
      ? status.error
      : null
  const syncError =
    !denied && status.error !== null && snapshot.origin !== 'empty'
      ? status.error
      : null

  const updateWorkspace = async (patch: WorkspacePatch) => {
    if (!workspace) return { success: false as const, error: 'Not loaded.' }
    const supabase = createClient()
    const { error: updateError } = await supabase
      .from('workspaces')
      .update(workspacePatchToRow(patch))
      .eq('id', workspace.id)
    if (updateError) {
      return { success: false as const, error: updateError.message }
    }
    const updated = { ...workspace, ...patch }
    setDetail(current => ({ ...current, workspace: updated }))
    cacheIdentity(updated)
    return { success: true as const }
  }

  const removeMember = async (memberUserId: string) => {
    if (!workspace) return { success: false as const, error: 'Not loaded.' }
    const supabase = createClient()
    const { error: deleteError } = await supabase
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspace.id)
      .eq('user_id', memberUserId)
    if (deleteError) {
      return { success: false as const, error: deleteError.message }
    }
    setDetail(current => ({
      ...current,
      members: current.members.filter(m => m.userId !== memberUserId),
    }))
    return { success: true as const }
  }

  const updateMemberAvailability = async (
    memberId: string,
    patch: MemberAvailabilityPatch,
  ) => {
    if (!workspace) return { success: false as const, error: 'Not loaded.' }
    const supabase = createClient()
    const { error: updateError } = await supabase
      .from('workspace_members')
      .update({
        working_hours_start: patch.workingHoursStart,
        working_hours_end: patch.workingHoursEnd,
        working_timezone: patch.workingTimezone,
        working_days: patch.workingDays,
        standup_availability_start: patch.standupAvailabilityStart,
        standup_availability_end: patch.standupAvailabilityEnd,
        standup_availability_days: patch.standupAvailabilityDays,
        minimum_working_minutes: patch.minimumWorkingMinutes,
      })
      .eq('workspace_id', workspace.id)
      .eq('id', memberId)
    if (updateError) {
      return { success: false as const, error: updateError.message }
    }
    setDetail(current => ({
      ...current,
      members: current.members.map(member =>
        member.id === memberId ? { ...member, ...patch } : member,
      ),
    }))
    return { success: true as const }
  }

  return {
    workspace,
    members,
    role,
    ready: status.ready,
    error,
    syncError,
    updateWorkspace,
    removeMember,
    updateMemberAvailability,
  }
}
