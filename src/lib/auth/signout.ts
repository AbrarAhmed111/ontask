'use client'

import { clearAllCache } from '@/lib/cache/cacheStore'

type PauseClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        is: (
          column: string,
          value: unknown,
        ) => PromiseLike<{
          data: { task_id: string | null; task_kind: string | null }[] | null
          error: unknown
        }>
      }
    }
  }
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ error: unknown }>
}

// Clear browser storage (localStorage, sessionStorage, cookies)
async function clearBrowserStorage(): Promise<void> {
  if (typeof window !== 'undefined') {
    try {
      const authKeys = [
        'sb-access-token',
        'supabase.auth.token',
        'supabase.auth.user',
        'sb-refresh-token',
        'sb-user-data',
        'sb-provider-token',
        'sb:token',
        'sb-auth-token',
        'sb:provider_token',
        'sb:refresh_token',
        'sb:session',
        'sb:user',
      ]
      authKeys.forEach(key => {
        try {
          localStorage.removeItem(key)
          sessionStorage.removeItem(key)
        } catch (e) {
          console.warn(`Failed to remove ${key}:`, e)
        }
      })
      document.cookie.split(';').forEach(cookie => {
        const [name] = cookie.trim().split('=')
        if (name.startsWith('sb-') || name.startsWith('sb:')) {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
        }
      })
    } catch (error) {
      console.error('Error clearing browser storage:', error)
    }
  }
}

async function pauseRunningWorkspaceTasks(supabase: unknown): Promise<void> {
  const client = supabase as PauseClient
  const { data, error } = await client
    .from('task_time_entries')
    .select('task_id, task_kind')
    .eq('task_kind', 'workspace')
    .is('ended_at', null)

  if (error || !data) {
    console.warn('Could not find running tasks before sign-out:', error)
    return
  }

  const taskIds = [
    ...new Set(
      data
        .filter(entry => entry.task_kind === 'workspace' && entry.task_id)
        .map(entry => entry.task_id as string),
    ),
  ]

  const results = await Promise.all(
    taskIds.map(taskId =>
      client.rpc('pause_workspace_task', { p_task_id: taskId }),
    ),
  )
  const failed = results.filter(result => result.error)
  if (failed.length > 0) {
    console.warn(
      `Could not pause ${failed.length} running task(s) before sign-out.`,
      failed.map(result => result.error),
    )
  }
}

export async function clientSignout() {
  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    await pauseRunningWorkspaceTasks(supabase)
    await clearBrowserStorage()
    // The signed-in user's cached workspaces/tasks are theirs alone: they don't
    // outlive the session on a device someone else may sign in on next.
    await clearAllCache()
    // Prevent Google One Tap from silently re-selecting the same account on
    // the next page load right after an explicit sign-out.
    window.google?.accounts.id.disableAutoSelect()
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('Error signing out from Supabase:', error)
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (error) {
    console.error('Error in clientSignout:', error)
    return { success: false, error: 'Failed to sign out' }
  }
}
