'use client'

import { useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspaceSnapshot } from '@/hooks/useWorkspaceSnapshot'
import { useFetchStatus } from '@/hooks/useFetchStatus'
import { SNAPSHOTS } from '@/lib/cache/workspaceSnapshots'
import { onResync } from '@/lib/realtime/onResync'
import {
  EventFormValues,
  EventRow,
  formToRpcArgs,
  rowToEvent,
} from '@/lib/events'
import type { AuthUser } from '@/hooks/useAuth'
import type { WorkspaceEvent } from '@/types/workspace'

const NO_EVENTS: WorkspaceEvent[] = []

// setTimeout's ceiling (~24.8 days); anything later is re-armed by a refetch.
const MAX_TIMEOUT_MS = 2_147_000_000

export type EventActionResult =
  { ok: true; id?: string } | { ok: false; error: string }

// Postgres errors raised on purpose carry a sentence meant for people; a bare
// permission failure does not.
function actionError(message: string | undefined, fallback: string): string {
  if (
    !message ||
    /not allowed|not authenticated|permission denied/i.test(message)
  )
    return fallback
  return message
}

// The events one workspace's Events page and Overview show (see
// list_workspace_events): a shared workspace's events plus the caller's own
// personal events there; for the Personal Workspace, all of the caller's
// personal events wherever they were created.
//
// Occurrences come from the server, a few at a time. A recurring event whose
// known occurrences have all passed (a tab left open for days) triggers one
// refetch at that moment; otherwise nothing polls -- realtime and the usual
// resync on focus keep it current.
export function useWorkspaceEvents(
  workspaceId: string,
  user: AuthUser | null,
  { isPersonal, enabled = true }: { isPersonal: boolean; enabled?: boolean },
) {
  const userId = user?.id
  const active = Boolean(userId && workspaceId && enabled)
  const snapshot = useWorkspaceSnapshot<WorkspaceEvent[]>({
    userId: active ? userId : null,
    workspaceId: active ? workspaceId : null,
    descriptor: SNAPSHOTS.events,
    initial: NO_EVENTS,
  })
  const { data: events, confirm } = snapshot
  const fetchKey = active ? `${userId}|${workspaceId}` : null
  const status = useFetchStatus(snapshot, fetchKey, {
    load: "Couldn't load events.",
    refresh: "Couldn't refresh events — you may be seeing an out-of-date list.",
  })
  const { failed: markFailed, succeeded: markSucceeded } = status

  const fetchEvents = useCallback(async () => {
    if (!active) return
    const supabase = createClient()
    const { data, error } = await supabase.rpc('list_workspace_events', {
      p_workspace_id: workspaceId,
    })
    if (error) {
      markFailed()
      return
    }
    confirm(((data ?? []) as EventRow[]).map(rowToEvent))
    markSucceeded()
  }, [active, workspaceId, confirm, markFailed, markSucceeded])

  useEffect(() => {
    if (!active || !fetchKey) return
    let cancelled = false
    void fetchEvents()

    const stopResync = onResync(() => {
      if (!cancelled) void fetchEvents()
    })

    // A shared workspace follows its own events; the Personal Workspace
    // follows the caller's personal events, in whichever workspace they live.
    const supabase = createClient()
    const channel = supabase
      .channel(`workspace-events-${workspaceId}-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_events',
          filter: isPersonal
            ? `created_by=eq.${userId}`
            : `workspace_id=eq.${workspaceId}`,
        },
        () => {
          if (!cancelled) void fetchEvents()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      stopResync()
      void supabase.removeChannel(channel)
    }
  }, [active, fetchKey, fetchEvents, isPersonal, workspaceId, userId])

  // Refetch when the first recurring event runs out of known occurrences.
  useEffect(() => {
    if (!active) return
    const exhaustAt = events
      .filter(e => e.status === 'scheduled' && e.recurrence !== 'none')
      .map(e => e.upcomingOccurrences[e.upcomingOccurrences.length - 1])
      .filter((o): o is string => Boolean(o))
      .map(o => Date.parse(o))
      .filter(t => t > Date.now())
    if (exhaustAt.length === 0) return
    const delay = Math.min(
      Math.min(...exhaustAt) - Date.now() + 1000,
      MAX_TIMEOUT_MS,
    )
    const id = window.setTimeout(() => void fetchEvents(), delay)
    return () => window.clearTimeout(id)
  }, [active, events, fetchEvents])

  const createEvent = async (
    values: EventFormValues,
    targetWorkspaceId: string = workspaceId,
  ): Promise<EventActionResult> => {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('create_workspace_event', {
      p_workspace_id: targetWorkspaceId,
      p_scope: values.scope,
      ...formToRpcArgs(values),
    })
    if (error)
      return {
        ok: false,
        error: actionError(error.message, "Couldn't create the event."),
      }
    void fetchEvents()
    return { ok: true, id: data as string }
  }

  const updateEvent = async (
    eventId: string,
    values: EventFormValues,
  ): Promise<EventActionResult> => {
    const supabase = createClient()
    const { error } = await supabase.rpc('update_workspace_event', {
      p_event_id: eventId,
      ...formToRpcArgs(values),
    })
    if (error)
      return {
        ok: false,
        error: actionError(error.message, "Couldn't save the event."),
      }
    void fetchEvents()
    return { ok: true }
  }

  const cancelEvent = async (eventId: string): Promise<EventActionResult> => {
    const supabase = createClient()
    const { error } = await supabase.rpc('cancel_workspace_event', {
      p_event_id: eventId,
    })
    if (error)
      return {
        ok: false,
        error: actionError(error.message, "Couldn't cancel the event."),
      }
    void fetchEvents()
    return { ok: true }
  }

  const deleteEvent = async (eventId: string): Promise<EventActionResult> => {
    const supabase = createClient()
    const { error } = await supabase.rpc('delete_workspace_event', {
      p_event_id: eventId,
    })
    if (error)
      return {
        ok: false,
        error: actionError(error.message, "Couldn't delete the event."),
      }
    void fetchEvents()
    return { ok: true }
  }

  return {
    events: active ? events : NO_EVENTS,
    ready: active ? status.ready : true,
    error: status.error,
    createEvent,
    updateEvent,
    cancelEvent,
    deleteEvent,
    refetch: fetchEvents,
  }
}
