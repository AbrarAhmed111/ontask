'use client'

import { clearAllCache } from '@/lib/cache/cacheStore'

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

export async function clientSignout() {
  try {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('Error signing out from Supabase:', error)
      return { success: false, error: error.message }
    }
    await clearBrowserStorage()
    // The signed-in user's cached workspaces/tasks are theirs alone: they don't
    // outlive the session on a device someone else may sign in on next.
    await clearAllCache()
    // Prevent Google One Tap from silently re-selecting the same account on
    // the next page load right after an explicit sign-out.
    window.google?.accounts.id.disableAutoSelect()
    return { success: true }
  } catch (error) {
    console.error('Error in clientSignout:', error)
    return { success: false, error: 'Failed to sign out' }
  }
}
