'use client'

import { clearAllCache } from '@/lib/cache/cacheStore'

type PauseClient = {
  from: (table: string) => unknown
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ error: unknown }>
}

type PersonalTaskRow = {
  id: string
  started_at: string | null
  actual_seconds: number | null
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

function isQueryBuilder(value: unknown): value is {
  select: (columns: string) => {
    eq: (
      column: string,
      value: unknown,
    ) => {
      eq: (
        column: string,
        value: unknown,
      ) => PromiseLike<{ data: PersonalTaskRow[] | null; error: unknown }>
    }
  }
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: unknown) => PromiseLike<{ error: unknown }>
  }
} {
  return Boolean(value && typeof value === 'object')
}

async function pauseRunningPersonalTasks(supabase: unknown): Promise<void> {
  const client = supabase as PauseClient
  const personalTasks = client.from('personal_tasks')
  if (!isQueryBuilder(personalTasks)) return

  const { data, error } = await personalTasks
    .select('id, started_at, actual_seconds')
    .eq('status', 'working')
    .eq('completed', false)

  if (error || !data) {
    console.warn(
      'Could not find running personal tasks before sign-out:',
      error,
    )
    return
  }

  const now = Date.now()
  const results = await Promise.all(
    data.map(task => {
      const startedAt = task.started_at
        ? new Date(task.started_at).getTime()
        : now
      const elapsedSeconds = Math.max(0, Math.round((now - startedAt) / 1000))
      return personalTasks
        .update({
          status: 'paused',
          started_at: null,
          actual_seconds: (task.actual_seconds ?? 0) + elapsedSeconds,
        })
        .eq('id', task.id)
    }),
  )
  const failed = results.filter(result => result.error)
  if (failed.length > 0) {
    console.warn(
      `Could not pause ${failed.length} running personal task(s) before sign-out.`,
      failed.map(result => result.error),
    )
  }
}

async function pauseRunningWorkspaceTasks(supabase: unknown): Promise<void> {
  const client = supabase as PauseClient
  const { error } = await client.rpc('pause_my_running_workspace_tasks', {})
  if (error) {
    console.warn(
      'Could not pause running workspace tasks before sign-out:',
      error,
    )
  }
}

export async function clientSignout() {
  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    await Promise.all([
      pauseRunningPersonalTasks(supabase),
      pauseRunningWorkspaceTasks(supabase),
    ])
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
