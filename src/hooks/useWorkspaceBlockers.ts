'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  BlockerRowState,
  MentionRowState,
  TaskBlockerMentionRow,
  TaskBlockerRow,
  activeBlockers,
  applyBlockerRow,
  applyMentionRow,
  blockerForTask,
  optimisticMentionRow,
  removeById,
} from '@/lib/tasks/blockers'
import type { AuthUser } from '@/hooks/useAuth'
import { onResync } from '@/lib/realtime/onResync'

// The mutation surface the per-list action hooks (useTaskBlockerActions) use to
// keep blocker state in step with what they are about to ask the server to do.
// Every method is a targeted edit — never "replace everything" — so rolling one
// action back can't undo a realtime update that landed while it was in flight.
export type BlockerStore = {
  // Read what's on screen right now (for rolling back one blocker).
  snapshot: (blockerId: string) => {
    blocker: BlockerRowState | undefined
    mentions: MentionRowState[]
  }
  applyBlocker: (row: BlockerRowState) => void
  addOptimistic: (blocker: BlockerRowState, mentions: MentionRowState[]) => void
  removeBlocker: (blockerId: string) => void
  markResolved: (
    blockerId: string,
    resolvedBy: string,
    note: string | null,
  ) => void
  patchReason: (blockerId: string, reason: string) => void
  patchMentions: (
    blockerId: string,
    change: {
      add: readonly string[]
      remove: readonly string[]
      workspaceId: string
      by: string
    },
  ) => void
  restoreBlocker: (
    blockerId: string,
    blocker: BlockerRowState | undefined,
    mentions: MentionRowState[],
  ) => void
}

// Replaces what came from the server with a fresh fetch, but keeps anything
// still waiting on its confirmation — an in-flight action's placeholder must not
// vanish because an unrelated refetch happened to land first.
function reconcile<T extends { id: string; optimistic?: true }>(
  current: readonly T[],
  fetched: readonly T[],
  sameThing: (a: T, b: T) => boolean,
): T[] {
  const pending = current.filter(
    row => row.optimistic && !fetched.some(server => sameThing(row, server)),
  )
  return [...fetched, ...pending]
}

// The active blockers in a workspace, live. Same shape as the other workspace
// hooks: fetch, subscribe to postgres_changes, refetch when the tab comes back
// or the network returns (a dropped websocket can silently miss events). Rows
// are merged by id, so a redelivered or out-of-order event can't duplicate or
// regress anything, and a client-minted id meets its server twin (see
// lib/tasks/blockers.ts). Only active blockers are held: a resolved blocker is
// history and lives in the activity feed and the Daily Report.
export function useWorkspaceBlockers(
  workspaceId: string,
  user: AuthUser | null,
  // Blockers are a shared-workspace feature; a personal workspace opens no
  // subscription at all.
  enabled = true,
) {
  const userId = user?.id
  const [blockerRows, setBlockerRows] = useState<BlockerRowState[]>([])
  const [mentionRows, setMentionRows] = useState<MentionRowState[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // What's committed, readable from event handlers without re-creating them.
  const rowsRef = useRef({ blockers: blockerRows, mentions: mentionRows })
  rowsRef.current = { blockers: blockerRows, mentions: mentionRows }

  useEffect(() => {
    if (!enabled || !userId || !workspaceId) {
      setBlockerRows([])
      setMentionRows([])
      setReady(true)
      return
    }
    let cancelled = false
    const supabase = createClient()

    const fetchAll = (showLoading: boolean) => {
      if (showLoading) setReady(false)
      Promise.all([
        supabase
          .from('task_blockers')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('status', 'active'),
        supabase
          .from('task_blocker_mentions')
          .select('*')
          .eq('workspace_id', workspaceId)
          .is('removed_at', null),
      ]).then(([blockersResult, mentionsResult]) => {
        if (cancelled) return
        if (blockersResult.error || mentionsResult.error) {
          setError("Couldn't load blockers.")
          setReady(true)
          return
        }
        const blockers = (blockersResult.data ?? []) as TaskBlockerRow[]
        const mentions = (mentionsResult.data ?? []) as TaskBlockerMentionRow[]
        setBlockerRows(current =>
          reconcile(current, blockers, (a, b) => a.id === b.id),
        )
        setMentionRows(current =>
          reconcile(
            current,
            mentions,
            (a, b) =>
              a.blocker_id === b.blocker_id &&
              a.mentioned_user_id === b.mentioned_user_id,
          ),
        )
        setError(null)
        setReady(true)
      })
    }

    fetchAll(true)

    const stopResync = onResync(() => fetchAll(false))

    const channel = supabase
      .channel(`workspace-blockers-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_blockers',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        payload => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string }).id
            if (id) setBlockerRows(current => removeById(current, id))
            return
          }
          setBlockerRows(current =>
            applyBlockerRow(current, payload.new as TaskBlockerRow),
          )
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_blocker_mentions',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        payload => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string }).id
            if (id) setMentionRows(current => removeById(current, id))
            return
          }
          setMentionRows(current =>
            applyMentionRow(current, payload.new as TaskBlockerMentionRow),
          )
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      stopResync()
      supabase.removeChannel(channel)
    }
  }, [enabled, userId, workspaceId])

  const blockers = useMemo(
    () => activeBlockers(blockerRows, mentionRows),
    [blockerRows, mentionRows],
  )

  const store = useMemo<BlockerStore>(
    () => ({
      snapshot: blockerId => ({
        blocker: rowsRef.current.blockers.find(row => row.id === blockerId),
        mentions: rowsRef.current.mentions.filter(
          row => row.blocker_id === blockerId,
        ),
      }),
      applyBlocker: row =>
        setBlockerRows(current => applyBlockerRow(current, row)),
      addOptimistic: (blocker, mentions) => {
        setBlockerRows(current => applyBlockerRow(current, blocker))
        setMentionRows(current => mentions.reduce(applyMentionRow, current))
      },
      removeBlocker: blockerId => {
        setBlockerRows(current => removeById(current, blockerId))
        setMentionRows(current =>
          current.filter(row => row.blocker_id !== blockerId),
        )
      },
      markResolved: (blockerId, resolvedBy, note) => {
        const stamp = new Date().toISOString()
        setBlockerRows(current =>
          current.map(row =>
            row.id === blockerId
              ? {
                  ...row,
                  status: 'resolved',
                  resolved_at: stamp,
                  resolved_by: resolvedBy,
                  resolution_note: note,
                  optimistic: true,
                }
              : row,
          ),
        )
      },
      patchReason: (blockerId, reason) =>
        setBlockerRows(current =>
          current.map(row =>
            row.id === blockerId ? { ...row, reason, optimistic: true } : row,
          ),
        ),
      patchMentions: (blockerId, { add, remove, workspaceId: ws, by }) => {
        const stamp = new Date().toISOString()
        setMentionRows(current => {
          const marked = current.map(row =>
            row.blocker_id === blockerId &&
            !row.removed_at &&
            remove.includes(row.mentioned_user_id)
              ? { ...row, removed_at: stamp, optimistic: true as const }
              : row,
          )
          return add.reduce(
            (rows, userId) =>
              applyMentionRow(
                rows,
                optimisticMentionRow({
                  blockerId,
                  workspaceId: ws,
                  userId,
                  addedBy: by,
                  stamp,
                }),
              ),
            marked,
          )
        })
      },
      restoreBlocker: (blockerId, blocker, mentions) => {
        setBlockerRows(current =>
          blocker
            ? current.map(row => (row.id === blockerId ? blocker : row))
            : current,
        )
        setMentionRows(current => [
          ...current.filter(row => row.blocker_id !== blockerId),
          ...mentions,
        ])
      },
    }),
    [],
  )

  return {
    blockers,
    ready,
    error,
    store,
    blockerForTask: (taskId: string) => blockerForTask(blockers, taskId),
  }
}
