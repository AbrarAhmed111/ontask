'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  GithubConnectionRow,
  rowToGithubConnection,
} from '@/lib/development/tracking'
import type { GithubConnection } from '@/types/workspace'

export type GithubRepositoryOption = {
  id: number
  fullName: string
  htmlUrl: string
  private: boolean
}

type Result = { success: true } | { success: false; error: string }

async function postJson(url: string, body: unknown): Promise<Result> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return { success: true }
    const data = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    return { success: false, error: data?.error ?? 'Something went wrong.' }
  } catch {
    return { success: false, error: "Couldn't reach the server." }
  }
}

// The workspace's GitHub connection (readable by every member -- it holds no
// credential) and, for the owner, the actions that configure it. Connecting is
// a full-page redirect to GitHub (connectUrl); everything after that goes
// through the server routes, which re-check that the caller is the owner.
export function useWorkspaceGithub(workspaceId: string, enabled: boolean) {
  const [connection, setConnection] = useState<GithubConnection | null>(null)
  const [ready, setReady] = useState(false)

  const load = useCallback(async () => {
    if (!workspaceId) return
    const { data, error } = await createClient()
      .from('workspace_github_connections')
      .select(
        'workspace_id, account_login, repository_full_name, repository_url, status, updated_at',
      )
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!error) {
      setConnection(
        data ? rowToGithubConnection(data as GithubConnectionRow) : null,
      )
    }
    setReady(true)
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || !enabled) return
    const supabase = createClient()
    void load()
    const channel = supabase
      .channel(`github-connection-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_github_connections',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => void load(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [workspaceId, enabled, load])

  const listRepositories = async (): Promise<
    | { success: true; repositories: GithubRepositoryOption[]; total: number }
    | { success: false; error: string }
  > => {
    try {
      const response = await fetch(
        `/api/integrations/github/repositories?workspace_id=${encodeURIComponent(workspaceId)}`,
      )
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        return {
          success: false,
          error: data?.error ?? "Couldn't load repositories.",
        }
      }
      return {
        success: true,
        repositories: data.repositories ?? [],
        total: data.total ?? 0,
      }
    } catch {
      return { success: false, error: "Couldn't reach the server." }
    }
  }

  const chooseRepository = async (repositoryId: number) => {
    const result = await postJson('/api/integrations/github/repositories', {
      workspaceId,
      repositoryId,
    })
    if (result.success) await load()
    return result
  }

  const disconnect = async () => {
    const result = await postJson('/api/integrations/github/disconnect', {
      workspaceId,
    })
    if (result.success) setConnection(null)
    return result
  }

  return {
    connection,
    ready: ready || !enabled,
    connectUrl: `/api/integrations/github/install?workspace_id=${encodeURIComponent(workspaceId)}`,
    listRepositories,
    chooseRepository,
    disconnect,
  }
}
