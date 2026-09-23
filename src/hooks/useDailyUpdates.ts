'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  SubmitItem,
  TaskCandidate,
  readCandidates,
  readUpdates,
} from '@/lib/dailyUpdates'
import type { AuthUser } from '@/hooks/useAuth'
import type { DailyUpdate, DailyUpdateItemType } from '@/types/workspace'
import { onResync } from '@/lib/realtime/onResync'

// A burst of realtime events (an edit rewrites the update and its items) becomes
// one read.
const REFETCH_DELAY_MS = 150

export type SubmitResult = { success: true } | { success: false; error: string }

// One day's Daily Updates for a workspace, live. Every member's update for that
// day comes from one RPC (get_daily_updates, which resolves each item's task and
// mentions on the server), and is read again when the database says an update
// was submitted or changed -- so "Not Reported" turns into "Reported" for
// everyone watching without a refresh -- and when the tab comes back online or
// into view, the same recovery the other workspace lists use.
//
// The workspace id and the day both key the read: switching either shows a
// loading state instead of the previous day's cards.
export function useDailyUpdates(
  workspaceId: string,
  user: AuthUser | null,
  day: string,
  enabled: boolean,
) {
  const userId = user?.id
  const key = enabled && userId && workspaceId ? `${workspaceId}|${day}` : null
  const [loaded, setLoaded] = useState<{
    key: string
    updates: DailyUpdate[]
    failed: boolean
  } | null>(null)
  // Only the newest read may land: an older one that finishes late (a slow
  // response for the day the member has since left) is dropped.
  const requestId = useRef(0)
  const fetchRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!key || !userId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const supabase = createClient()

    const fetchUpdates = () => {
      const id = ++requestId.current
      supabase
        .rpc('get_daily_updates', {
          p_workspace_id: workspaceId,
          p_report_date: day,
        })
        .then(({ data, error }) => {
          if (cancelled || id !== requestId.current) return
          if (error) {
            // Keep what is on screen for this key; only say the read failed.
            setLoaded(current => ({
              key,
              updates: current?.key === key ? current.updates : [],
              failed: true,
            }))
            return
          }
          setLoaded({ key, updates: readUpdates(data), failed: false })
        })
    }
    fetchRef.current = fetchUpdates
    fetchUpdates()

    const scheduleFetch = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(fetchUpdates, REFETCH_DELAY_MS)
    }
    const stopResync = onResync(() => fetchUpdates())

    // The realtime filter can only name a column of the table itself, which is
    // why both tables carry workspace_id. An event for another day's update is
    // ignored; a delete carries no date, so it is always worth a read.
    const touchesThisDay = (payload: {
      new?: Record<string, unknown>
      old?: Record<string, unknown>
    }) => {
      const dates = [payload.new?.report_date, payload.old?.report_date].filter(
        (value): value is string => typeof value === 'string',
      )
      return dates.length === 0 || dates.includes(day)
    }

    const channel = supabase
      .channel(`workspace-daily-updates-${workspaceId}-${day}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_updates',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        payload => {
          if (!cancelled && touchesThisDay(payload)) scheduleFetch()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'daily_update_items',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          if (!cancelled) scheduleFetch()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      stopResync()
      supabase.removeChannel(channel)
    }
  }, [key, userId, workspaceId, day])

  const submit = useCallback(
    async (items: SubmitItem[]): Promise<SubmitResult> => {
      if (!userId || !workspaceId) {
        return { success: false, error: 'You need to be signed in.' }
      }
      const { error } = await createClient().rpc('submit_daily_update', {
        p_workspace_id: workspaceId,
        p_report_date: day,
        p_items: items,
      })
      if (error) {
        return { success: false, error: error.message || 'Could not submit.' }
      }
      // Show the result from the server's own answer, not a guess at it.
      fetchRef.current()
      return { success: true }
    },
    [userId, workspaceId, day],
  )

  const current = loaded && loaded.key === key ? loaded : null
  return {
    updates: current?.updates ?? [],
    ready: !key || current !== null,
    error: current?.failed
      ? "Couldn't load Daily Updates — what you see may be out of date."
      : null,
    submit,
  }
}

export type TaskCandidatesState = {
  candidates: TaskCandidate[]
  loading: boolean
  error: string | null
}

const SEARCH_DELAY_MS = 200

// The tasks worth offering as a reference for one section (see
// daily_update_task_candidates): a short, ranked list for the member -- never
// the workspace's whole task list -- and, once they type, the search results.
// Reads only while the picker is open.
export function useTaskCandidates(
  workspaceId: string,
  itemType: DailyUpdateItemType,
  query: string,
  open: boolean,
): TaskCandidatesState {
  const [state, setState] = useState<{
    key: string
    candidates: TaskCandidate[]
    failed: boolean
  } | null>(null)
  const trimmed = query.trim()
  const key =
    open && workspaceId ? `${workspaceId}|${itemType}|${trimmed}` : null

  useEffect(() => {
    if (!key) return
    let cancelled = false
    // The first read (no search text) goes straight out; typing waits for a pause.
    const timer = setTimeout(
      () => {
        createClient()
          .rpc('daily_update_task_candidates', {
            p_workspace_id: workspaceId,
            p_item_type: itemType,
            p_query: trimmed,
            p_limit: 12,
          })
          .then(({ data, error }) => {
            if (cancelled) return
            setState({
              key,
              candidates: error ? [] : readCandidates(data),
              failed: Boolean(error),
            })
          })
      },
      trimmed ? SEARCH_DELAY_MS : 0,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, workspaceId, itemType, trimmed])

  const current = state && state.key === key ? state : null
  return {
    candidates: current?.candidates ?? [],
    loading: key !== null && current === null,
    error: current?.failed ? "Couldn't load tasks." : null,
  }
}
