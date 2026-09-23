'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AuthUser } from '@/hooks/useAuth'
import type { WorkSession } from '@/types/workspace'
import { onResync } from '@/lib/realtime/onResync'

type WorkSessionRow = {
  id: string
  workspace_id: string
  user_id: string
  status: 'working' | 'break'
  started_at: string
  ended_at: string | null
  current_break_started_at: string | null
  total_break_seconds: number
  created_at: string
  updated_at: string
}

function rowToSession(row: WorkSessionRow): WorkSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    currentBreakStartedAt: row.current_break_started_at,
    totalBreakSeconds: row.total_break_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function useWorkSessions(workspaceId: string, user: AuthUser | null) {
  const userId = user?.id
  const [sessions, setSessions] = useState<WorkSession[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    if (!workspaceId || !userId) return
    const supabase = createClient()
    const { data, error: fetchError } = await supabase
      .from('work_sessions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .is('ended_at', null)
    if (fetchError) {
      setError("Couldn't load work sessions.")
      return
    }
    setSessions(((data ?? []) as WorkSessionRow[]).map(rowToSession))
    setReady(true)
    setError(null)
  }, [workspaceId, userId])

  useEffect(() => {
    if (!workspaceId || !userId) {
      setSessions([])
      setReady(false)
      setError(null)
      return
    }
    let cancelled = false
    const supabase = createClient()
    const load = () => {
      fetchSessions().catch(() => {
        if (!cancelled) setError("Couldn't load work sessions.")
      })
    }
    load()

    const stopResync = onResync(() => load())

    const channel = supabase
      .channel(`work-sessions-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_sessions',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        payload => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string }).id
            if (id) setSessions(current => current.filter(row => row.id !== id))
            return
          }
          const incoming = rowToSession(payload.new as WorkSessionRow)
          setSessions(current => {
            const withoutUser = current.filter(
              row => row.userId !== incoming.userId,
            )
            return incoming.endedAt ? withoutUser : [...withoutUser, incoming]
          })
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      stopResync()
      supabase.removeChannel(channel)
    }
  }, [workspaceId, userId, fetchSessions])

  const runAction = async (
    name:
      | 'start_work_session'
      | 'take_work_break'
      | 'resume_work_session'
      | 'end_work_session',
  ) => {
    if (!workspaceId) return { success: false as const, error: 'Not loaded.' }
    const supabase = createClient()
    const { data, error: actionError } = await supabase
      .rpc(name, { p_workspace_id: workspaceId })
      .single()
    if (actionError || !data) {
      const message = actionError?.message ?? 'Work session update failed.'
      setError(message)
      return { success: false as const, error: message }
    }
    const session = rowToSession(data as WorkSessionRow)
    setSessions(current => {
      const withoutUser = current.filter(row => row.userId !== session.userId)
      return session.endedAt ? withoutUser : [...withoutUser, session]
    })
    setError(null)
    return { success: true as const, session }
  }

  const byUserId = useMemo(
    () => new Map(sessions.map(session => [session.userId, session])),
    [sessions],
  )

  return {
    sessions,
    byUserId,
    ready,
    error,
    startWork: () => runAction('start_work_session'),
    takeBreak: () => runAction('take_work_break'),
    resumeWork: () => runAction('resume_work_session'),
    endWork: () => runAction('end_work_session'),
  }
}
