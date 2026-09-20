'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspaceSnapshot } from '@/hooks/useWorkspaceSnapshot'
import { useFetchStatus } from '@/hooks/useFetchStatus'
import { SNAPSHOTS } from '@/lib/cache/workspaceSnapshots'
import type { AuthUser } from '@/hooks/useAuth'
import type { Idea, IdeaType } from '@/types/workspace'

export type IdeaFormInput = {
  title: string
  description?: string
  type: IdeaType
  creditedUserIds: string[]
}

const NO_IDEAS: Idea[] = []

export function useWorkspaceIdeas(workspaceId: string, user: AuthUser | null) {
  const userId = user?.id
  const snapshot = useWorkspaceSnapshot<Idea[]>({
    userId,
    workspaceId,
    descriptor: SNAPSHOTS.ideas,
    initial: NO_IDEAS,
  })
  const { data: ideas, setData: setIdeas, confirm } = snapshot
  const [actionError, setError] = useState<string | null>(null)
  const fetchKey = userId && workspaceId ? `${userId}|${workspaceId}` : null

  const status = useFetchStatus(snapshot, fetchKey, {
    load: "Couldn't load ideas.",
    refresh: "Couldn't refresh ideas — you may be seeing an out-of-date list.",
  })
  const { failed: markFailed, succeeded: markSucceeded } = status

  const fetchIdeas = useCallback(async () => {
    if (!userId || !workspaceId) return
    const supabase = createClient()
    const { data, error: fetchError } = await supabase
      .from('ideas')
      .select(
        `
        *,
        idea_credits ( user_id ),
        workspace_tasks ( id ),
        goals ( id )
      `,
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })

    if (fetchError) {
      markFailed()
      return
    }

    const mapped: Idea[] = ((data as any[]) ?? []).map(row => ({
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      description: row.description,
      type: row.type,
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      creditedUserIds: Array.isArray(row.idea_credits)
        ? row.idea_credits.map((c: { user_id: string }) => c.user_id)
        : [],
      taskCount: Array.isArray(row.workspace_tasks)
        ? row.workspace_tasks.length
        : 0,
      goalCount: Array.isArray(row.goals) ? row.goals.length : 0,
    }))

    confirm(mapped)
    markSucceeded()
  }, [userId, workspaceId, confirm, markFailed, markSucceeded])

  useEffect(() => {
    if (!userId || !workspaceId || !fetchKey) return
    let cancelled = false

    fetchIdeas()

    const handleReconnect = () => {
      if (!cancelled) void fetchIdeas()
    }
    const handleVisibility = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        !cancelled
      ) {
        void fetchIdeas()
      }
    }

    window.addEventListener('online', handleReconnect)
    document.addEventListener('visibilitychange', handleVisibility)

    const supabase = createClient()
    const channel = supabase
      .channel(`workspace-ideas-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ideas',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          if (!cancelled) void fetchIdeas()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'idea_credits',
        },
        () => {
          if (!cancelled) void fetchIdeas()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      window.removeEventListener('online', handleReconnect)
      document.removeEventListener('visibilitychange', handleVisibility)
      void supabase.removeChannel(channel)
    }
  }, [userId, workspaceId, fetchKey, fetchIdeas])

  const createIdea = async (input: IdeaFormInput): Promise<boolean> => {
    if (!userId || !workspaceId) return false
    setError(null)
    const supabase = createClient()

    const { data: newIdea, error: createErr } = await supabase
      .from('ideas')
      .insert({
        workspace_id: workspaceId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        type: input.type,
        created_by: userId,
      })
      .select()
      .single()

    if (createErr || !newIdea) {
      setError(createErr?.message || 'Failed to create idea.')
      return false
    }

    if (input.creditedUserIds.length > 0) {
      const creditsToInsert = input.creditedUserIds.map(uId => ({
        idea_id: newIdea.id,
        user_id: uId,
      }))
      const { error: creditErr } = await supabase
        .from('idea_credits')
        .insert(creditsToInsert)

      if (creditErr) {
        setError(creditErr.message)
      }
    }

    await fetchIdeas()
    return true
  }

  const updateIdea = async (
    ideaId: string,
    input: IdeaFormInput,
  ): Promise<boolean> => {
    if (!userId || !workspaceId) return false
    setError(null)
    const supabase = createClient()

    const { error: updateErr } = await supabase
      .from('ideas')
      .update({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        type: input.type,
      })
      .eq('id', ideaId)
      .eq('workspace_id', workspaceId)

    if (updateErr) {
      setError(updateErr.message)
      return false
    }

    // Sync credits
    await supabase.from('idea_credits').delete().eq('idea_id', ideaId)

    if (input.creditedUserIds.length > 0) {
      const creditsToInsert = input.creditedUserIds.map(uId => ({
        idea_id: ideaId,
        user_id: uId,
      }))
      await supabase.from('idea_credits').insert(creditsToInsert)
    }

    await fetchIdeas()
    return true
  }

  const archiveIdea = async (ideaId: string): Promise<boolean> => {
    if (!userId || !workspaceId) return false
    setError(null)
    const supabase = createClient()

    const { error } = await supabase
      .from('ideas')
      .update({
        archived_at: new Date().toISOString(),
        status: 'archived',
      })
      .eq('id', ideaId)
      .eq('workspace_id', workspaceId)

    if (error) {
      setError(error.message)
      return false
    }

    await fetchIdeas()
    return true
  }

  const unarchiveIdea = async (ideaId: string): Promise<boolean> => {
    if (!userId || !workspaceId) return false
    setError(null)
    const supabase = createClient()

    const { error } = await supabase
      .from('ideas')
      .update({
        archived_at: null,
      })
      .eq('id', ideaId)
      .eq('workspace_id', workspaceId)

    if (error) {
      setError(error.message)
      return false
    }

    await fetchIdeas()
    return true
  }

  const deleteIdea = async (ideaId: string): Promise<boolean> => {
    if (!userId || !workspaceId) return false
    setError(null)
    const supabase = createClient()

    const { error } = await supabase
      .from('ideas')
      .delete()
      .eq('id', ideaId)
      .eq('workspace_id', workspaceId)

    if (error) {
      setError(error.message)
      return false
    }

    await fetchIdeas()
    return true
  }

  return {
    ideas,
    ready: status.ready,
    error: status.error ?? actionError,
    createIdea,
    updateIdea,
    archiveIdea,
    unarchiveIdea,
    deleteIdea,
    refresh: fetchIdeas,
  }
}
