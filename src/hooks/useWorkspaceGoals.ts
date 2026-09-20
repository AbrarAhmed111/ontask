import { FormEvent, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspaceSnapshot } from '@/hooks/useWorkspaceSnapshot'
import { useFetchStatus } from '@/hooks/useFetchStatus'
import { SNAPSHOTS } from '@/lib/cache/workspaceSnapshots'
import type { AuthUser } from '@/hooks/useAuth'
import { Goal, GoalStatus } from '@/types/workspace'

type GoalRow = {
  id: string
  workspace_id: string
  idea_id?: string | null
  name: string
  description: string | null
  status: GoalStatus
  created_by: string
  target_date: string | null
  position: number
  created_at: string
  updated_at: string
  completed_at: string | null
  archived_at: string | null
}

function rowToGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ideaId: row.idea_id ?? null,
    name: row.name,
    description: row.description,
    status: row.status,
    createdBy: row.created_by,
    targetDate: row.target_date,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
  }
}

export type GoalFormValues = {
  name: string
  description: string
  targetDate: string
  ideaId?: string
}

const NO_GOALS: Goal[] = []

// List + realtime for a workspace's Goals — same postgres_changes pattern as
// useWorkspaceTasks.ts/useWorkspaceActivity.ts. A single Goal's own tasks/
// subtasks are fetched separately by useGoalDetail.ts.
export function useWorkspaceGoals(workspaceId: string, user: AuthUser | null) {
  const userId = user?.id
  // Cached on this device per user AND workspace, shown while the real list is
  // fetched; see useWorkspaceSnapshot.
  const snapshot = useWorkspaceSnapshot<Goal[]>({
    userId,
    workspaceId,
    descriptor: SNAPSHOTS.goals,
    initial: NO_GOALS,
  })
  const { data: goals, setData: setGoals, confirm } = snapshot
  const [actionError, setError] = useState<string | null>(null)
  const fetchKey = userId && workspaceId ? `${userId}|${workspaceId}` : null
  const status = useFetchStatus(snapshot, fetchKey, {
    load: "Couldn't load goals.",
    refresh: "Couldn't refresh goals — you may be seeing an out-of-date list.",
  })
  const { failed: markFailed, succeeded: markSucceeded } = status
  const { ready } = status
  const error = status.error ?? actionError

  useEffect(() => {
    if (!userId || !workspaceId || !fetchKey) return
    let cancelled = false
    const supabase = createClient()

    const fetchGoals = () => {
      supabase
        .from('goals')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('position', { ascending: true })
        .then(({ data, error: fetchError }) => {
          if (cancelled) return
          if (fetchError) {
            markFailed()
            return
          }
          confirm(((data ?? []) as GoalRow[]).map(rowToGoal))
          markSucceeded()
        })
    }

    fetchGoals()

    const handleReconnect = () => fetchGoals()
    const handleVisibility = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      )
        handleReconnect()
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleReconnect)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility)
    }

    const channel = supabase
      .channel(`workspace-goals-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'goals',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        payload => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string }).id
            if (deletedId)
              setGoals(current => current.filter(g => g.id !== deletedId))
            return
          }
          const incoming = rowToGoal(payload.new as GoalRow)
          setGoals(current => {
            const exists = current.some(g => g.id === incoming.id)
            return exists
              ? current.map(g => (g.id === incoming.id ? incoming : g))
              : [...current, incoming]
          })
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleReconnect)
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility)
      }
      supabase.removeChannel(channel)
    }
  }, [
    userId,
    workspaceId,
    fetchKey,
    confirm,
    setGoals,
    markFailed,
    markSucceeded,
  ])

  const createGoal = (event: FormEvent, form: GoalFormValues) => {
    event.preventDefault()
    if (!userId || !form.name.trim()) return false
    const id = crypto.randomUUID()
    const name = form.name.trim()
    const description = form.description.trim() || null
    const targetDate = form.targetDate || null
    const ideaId = form.ideaId || null

    setGoals(current => [
      ...current,
      {
        id,
        workspaceId,
        ideaId,
        name,
        description,
        status: 'active',
        createdBy: userId,
        targetDate,
        position: (current[current.length - 1]?.position ?? 0) + 1000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
        archivedAt: null,
      },
    ])

    const supabase = createClient()
    void supabase
      .from('goals')
      .insert({
        id,
        workspace_id: workspaceId,
        idea_id: ideaId,
        name,
        description,
        created_by: userId,
        target_date: targetDate,
      })
      .then(({ error: insertError }) => {
        if (insertError) {
          setError("Couldn't create the goal.")
          setGoals(current => current.filter(goal => goal.id !== id))
        }
      })

    return true
  }

  const updateGoal = (
    id: string,
    update: Partial<
      Pick<Goal, 'name' | 'description' | 'targetDate' | 'status' | 'ideaId'>
    >,
  ) => {
    if (!userId) return
    setGoals(current =>
      current.map(goal => (goal.id === id ? { ...goal, ...update } : goal)),
    )
    const row: Record<string, unknown> = {}
    if (update.name !== undefined) row.name = update.name
    if (update.description !== undefined) row.description = update.description
    if (update.targetDate !== undefined) row.target_date = update.targetDate
    if (update.status !== undefined) row.status = update.status
    if (update.ideaId !== undefined) row.idea_id = update.ideaId
    if (Object.keys(row).length === 0) return
    const supabase = createClient()
    void supabase
      .from('goals')
      .update(row)
      .eq('id', id)
      .then(({ error: updateError }) => {
        if (updateError) setError("Couldn't save the goal.")
      })
  }

  const setGoalStatus = (id: string, status: GoalStatus) =>
    updateGoal(id, { status })

  const deleteGoal = (id: string) => {
    if (!userId) return
    const removed = goals.find(goal => goal.id === id)
    setGoals(current => current.filter(goal => goal.id !== id))
    const supabase = createClient()
    void supabase
      .from('goals')
      .delete()
      .eq('id', id)
      .then(({ error: deleteError }) => {
        if (deleteError) {
          setError("Couldn't delete the goal.")
          if (removed) setGoals(current => [...current, removed])
        }
      })
  }

  return {
    goals,
    ready,
    error,
    createGoal,
    updateGoal,
    setGoalStatus,
    deleteGoal,
  }
}
