'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
//
// Strictly per workspace: what was loaded is kept together with the workspace
// it belongs to and only shown while that is still the workspace on screen, and
// an answer that arrives after switching workspaces is dropped. So workspace B
// never shows workspace A's connection, not even for a moment.
export function useWorkspaceGithub(workspaceId: string, enabled: boolean) {
  const [loaded, setLoaded] = useState<{
    workspaceId: string
    connection: GithubConnection | null
  } | null>(null)
  const currentRef = useRef(workspaceId)
  currentRef.current = workspaceId
  const isCurrent = loaded !== null && loaded.workspaceId === workspaceId
  const connection = isCurrent ? loaded.connection : null
  const ready = isCurrent

  const load = useCallback(async () => {
    if (!workspaceId) return
    const { data, error } = await createClient()
      .from('workspace_github_connections')
      .select(
        'workspace_id, account_login, repository_full_name, repository_url, status, updated_at',
      )
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (currentRef.current !== workspaceId) return
    setLoaded(current =>
      error
        ? // A failed read keeps this workspace's last answer, never another's.
          current?.workspaceId === workspaceId
          ? current
          : { workspaceId, connection: null }
        : {
            workspaceId,
            connection: data
              ? rowToGithubConnection(data as GithubConnectionRow)
              : null,
          },
    )
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
    | {
        success: true
        repositories: GithubRepositoryOption[]
        total: number
        manageUrl: string | null
      }
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
        manageUrl: data.manageUrl ?? null,
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

  // Use one of the GitHub accounts offered after authorizing (the signed list
  // from the callback is checked again by the server).
  const chooseInstallation = async (token: string, installationId: number) => {
    const result = await postJson('/api/integrations/github/installation', {
      workspaceId,
      token,
      installationId,
    })
    if (result.success) await load()
    return result
  }

  const disconnect = async () => {
    const result = await postJson('/api/integrations/github/disconnect', {
      workspaceId,
    })
    if (result.success) setLoaded({ workspaceId, connection: null })
    return result
  }

  return {
    connection,
    ready: ready || !enabled,
    connectUrl: `/api/integrations/github/install?workspace_id=${encodeURIComponent(workspaceId)}`,
    // Install the app on another GitHub account or organisation.
    installUrl: `/api/integrations/github/install?workspace_id=${encodeURIComponent(workspaceId)}&mode=install`,
    listRepositories,
    chooseRepository,
    chooseInstallation,
    disconnect,
  }
}
