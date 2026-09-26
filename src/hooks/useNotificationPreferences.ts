'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  NotificationPreferenceKey,
  NotificationPreferences,
  rowsToPreferences,
} from '@/lib/notificationPreferences'

// The signed-in user's notification preferences, read from and saved to the
// database (they follow the person across devices, unlike the completion
// sound). A change is shown at once and rolled back if saving fails.
export function useNotificationPreferences(userId: string | undefined) {
  const [preferences, setPreferences] = useState<NotificationPreferences>({})
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setReady(false)
    const supabase = createClient()
    void supabase
      .from('user_notification_preferences')
      .select('preference_key, enabled')
      .eq('user_id', userId)
      .then(({ data, error: fetchError }) => {
        if (cancelled) return
        if (fetchError) setError("Couldn't load your notification settings.")
        else setPreferences(rowsToPreferences(data ?? []))
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const setPreference = useCallback(
    async (key: NotificationPreferenceKey, enabled: boolean) => {
      if (!userId) return false
      let previous: boolean | undefined
      setPreferences(current => {
        previous = current[key]
        return { ...current, [key]: enabled }
      })
      setError(null)
      const supabase = createClient()
      const { error: saveError } = await supabase
        .from('user_notification_preferences')
        .upsert(
          { user_id: userId, preference_key: key, enabled },
          { onConflict: 'user_id,preference_key' },
        )
      if (saveError) {
        setPreferences(current => ({ ...current, [key]: previous }))
        setError("Couldn't save that setting.")
        return false
      }
      return true
    },
    [userId],
  )

  return { preferences, ready, error, setPreference }
}
