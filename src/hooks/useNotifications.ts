import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspaceSnapshot } from '@/hooks/useWorkspaceSnapshot'
import { useFetchStatus } from '@/hooks/useFetchStatus'
import { SNAPSHOTS } from '@/lib/cache/workspaceSnapshots'
import type { AuthUser } from '@/hooks/useAuth'
import { NotificationWithWorkspace } from '@/types/workspace'
import {
  NotificationRow,
  NotificationScope,
  isInScope,
  rowsToNotifications,
} from '@/lib/workspaceNotifications'
import { onResync } from '@/lib/realtime/onResync'

const LIMIT = 50
const NO_NOTIFICATIONS: NotificationWithWorkspace[] = []

// One hook for both kinds of workspace -- `scope` is the only difference
// (see NotificationScope). A shared workspace's bell reads just that
// workspace; the Personal Workspace's reads everything the user can see.
// Filtering happens in the query (so a busy workspace can't push another's
// notifications out of the LIMIT) and again on the way out (so switching
// workspaces can never flash the previous one's notifications while the new
// fetch is in flight). RLS (0034) is what actually guarantees a user never
// receives a workspace they aren't a member of.
//
// Mounted where the bell is -- inside a workspace -- not at the app root: the
// guest page and the workspaces hub have no bell, so they shouldn't hold a
// realtime subscription. Same postgres_changes pattern as the rest of the
// app; a realtime event triggers a refetch rather than an incremental merge,
// since the embedded workspace isn't in the payload.
export function useNotifications(
  user: AuthUser | null,
  scope: NotificationScope | null,
) {
  const userId = user?.id
  const hasScope = scope !== null
  const sharedWorkspaceId = scope?.kind === 'shared' ? scope.workspaceId : null
  // The most recent notifications (LIMIT) are cached per user and scope -- one
  // workspace's, or the Personal Workspace's combined set -- and shown while the
  // real list is fetched. Read/unread comes from the server on every refresh.
  const snapshot = useWorkspaceSnapshot<NotificationWithWorkspace[]>({
    userId: hasScope ? userId : null,
    workspaceId: sharedWorkspaceId,
    scope: sharedWorkspaceId ? undefined : 'personal',
    descriptor: SNAPSHOTS.notifications,
    initial: NO_NOTIFICATIONS,
  })
  const { data: loaded, setData: setLoaded, confirm } = snapshot
  const [actionError, setError] = useState<string | null>(null)
  const fetchKey =
    userId && hasScope ? `${userId}|${sharedWorkspaceId ?? 'personal'}` : null
  const status = useFetchStatus(snapshot, fetchKey, {
    load: "Couldn't load notifications.",
    refresh: "Couldn't refresh notifications — you may be seeing older ones.",
  })
  const { failed: markFailed, succeeded: markSucceeded } = status
  // Nothing to load without a user; with one, not ready until there is a scope.
  const ready = !userId ? true : hasScope ? status.ready : false
  const error = status.error ?? actionError

  useEffect(() => {
    if (!userId || !hasScope || !fetchKey) return
    let cancelled = false
    const supabase = createClient()

    const fetchNotifications = () => {
      let query = supabase
        .from('notifications')
        .select('*, workspaces(slug, type, name, accent)')
        .eq('user_id', userId)
      if (sharedWorkspaceId) query = query.eq('workspace_id', sharedWorkspaceId)
      query
        .order('created_at', { ascending: false })
        .limit(LIMIT)
        .then(({ data, error: fetchError }) => {
          if (cancelled) return
          if (fetchError) {
            markFailed()
            return
          }
          confirm(rowsToNotifications((data ?? []) as NotificationRow[]))
          markSucceeded()
        })
    }

    fetchNotifications()

    const stopResync = onResync(() => fetchNotifications())

    // The scope is in the channel name so a workspace switch never reuses --
    // or tears down -- the previous workspace's channel.
    const channel = supabase
      .channel(`notifications-${userId}-${sharedWorkspaceId ?? 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        payload => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string }).id
            if (deletedId)
              setLoaded(current => current.filter(n => n.id !== deletedId))
            return
          }
          // Realtime can only filter on one column, so a shared workspace's
          // bell skips other workspaces' changes here rather than refetching
          // for something it won't display.
          const changedWorkspaceId = (payload.new as { workspace_id?: string })
            .workspace_id
          if (
            sharedWorkspaceId &&
            changedWorkspaceId &&
            changedWorkspaceId !== sharedWorkspaceId
          )
            return
          fetchNotifications()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      stopResync()
      supabase.removeChannel(channel)
    }
  }, [
    userId,
    hasScope,
    sharedWorkspaceId,
    fetchKey,
    confirm,
    setLoaded,
    markFailed,
    markSucceeded,
  ])

  const notifications = useMemo(
    () => (scope ? loaded.filter(n => isInScope(n, scope)) : []),
    [loaded, scope],
  )

  const markRead = (id: string) => {
    setLoaded(current =>
      current.map(n =>
        n.id === id && !n.readAt
          ? { ...n, readAt: new Date().toISOString() }
          : n,
      ),
    )
    const supabase = createClient()
    void supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .then(({ error: updateError }) => {
        if (updateError) setError("Couldn't update the notification.")
      })
  }

  // Marks only what THIS bell shows. In a shared workspace that's just its own
  // notifications -- clearing the others would silently dismiss things the
  // user hasn't seen (they're in the Personal Workspace's panel).
  const markAllRead = () => {
    if (!userId || !scope) return
    const now = new Date().toISOString()
    setLoaded(current =>
      current.map(n =>
        isInScope(n, scope) && !n.readAt ? { ...n, readAt: now } : n,
      ),
    )
    const supabase = createClient()
    let query = supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('user_id', userId)
      .is('read_at', null)
    if (sharedWorkspaceId) query = query.eq('workspace_id', sharedWorkspaceId)
    void query.then(({ error: updateError }) => {
      if (updateError) setError("Couldn't update notifications.")
    })
  }

  const unreadCount = notifications.filter(n => !n.readAt).length

  return { notifications, ready, error, unreadCount, markRead, markAllRead }
}
