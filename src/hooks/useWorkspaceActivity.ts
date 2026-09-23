'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspaceSnapshot } from '@/hooks/useWorkspaceSnapshot'
import { useFetchStatus } from '@/hooks/useFetchStatus'
import { SNAPSHOTS } from '@/lib/cache/workspaceSnapshots'
import { mergeById } from '@/lib/realtime/mergeById'
import type { AuthUser } from '@/hooks/useAuth'
import { onResync } from '@/lib/realtime/onResync'

type TaskEventRow = {
  id: string
  task_id: string
  goal_id: string | null
  actor_id: string
  event_type: string
  metadata: Record<string, unknown>
  created_at: string
}

export type ActivityEvent = {
  id: string
  taskId: string
  goalId: string | null
  actorId: string
  eventType: string
  metadata: Record<string, unknown>
  createdAt: string
}

function rowToEvent(row: TaskEventRow): ActivityEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    goalId: row.goal_id,
    actorId: row.actor_id,
    eventType: row.event_type,
    metadata: row.metadata,
    createdAt: row.created_at,
  }
}

const NO_EVENTS: ActivityEvent[] = []

// Recent activity for a workspace — reads task_events (populated by the
// timer RPCs and the paired client-side inserts in useWorkspaceTasks),
// live-updated via the same postgres_changes pattern as the task list.
// Incoming rows are merged by id (mergeById) rather than blindly prepended,
// so a reconnect refetch or a redelivered event can never render a
// duplicate row or replay its entrance animation.
export function useWorkspaceActivity(
  workspaceId: string,
  user: AuthUser | null,
  limit = 30,
) {
  const userId = user?.id
  // Only the recent window is ever cached (`limit` events, the same bound the
  // list itself keeps), never the full history.
  const snapshot = useWorkspaceSnapshot<ActivityEvent[]>({
    userId,
    workspaceId,
    descriptor: SNAPSHOTS.activity,
    initial: NO_EVENTS,
  })
  const { data: events, setData: setEvents, confirm } = snapshot
  const fetchKey = userId && workspaceId ? `${userId}|${workspaceId}` : null
  const status = useFetchStatus(snapshot, fetchKey, {
    load: "Couldn't load activity.",
    refresh: "Couldn't refresh activity — you may be seeing older events.",
  })
  const { failed: markFailed, succeeded: markSucceeded } = status
  const { ready, error } = status

  useEffect(() => {
    if (!userId || !workspaceId || !fetchKey) return
    let cancelled = false
    const supabase = createClient()

    const fetchEvents = () => {
      supabase
        .from('task_events')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(limit)
        .then(({ data, error: fetchError }) => {
          if (cancelled) return
          if (fetchError || !data) {
            markFailed()
            return
          }
          confirm((data as TaskEventRow[]).map(rowToEvent))
          markSucceeded()
        })
    }

    fetchEvents()

    // A dropped websocket (laptop sleep, network blip) can silently miss
    // postgres_changes events — coming back online or back into the tab
    // always re-derives the recent activity list from the database, the
    // same resilience pattern as useWorkspaceTasks.ts.
    const stopResync = onResync(() => fetchEvents())

    const channel = supabase
      .channel(`workspace-activity-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'task_events',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        payload => {
          if (cancelled) return
          const incoming = rowToEvent(payload.new as TaskEventRow)
          setEvents(current =>
            mergeById(
              current,
              [incoming],
              event => new Date(event.createdAt).getTime(),
              limit,
            ),
          )
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
    workspaceId,
    limit,
    fetchKey,
    confirm,
    setEvents,
    markFailed,
    markSucceeded,
  ])

  return { events, ready, error }
}
