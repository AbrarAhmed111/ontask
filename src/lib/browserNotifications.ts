// Desktop (browser) notifications: a copy of an in-app notification raised by
// an open OnTask tab when the notification arrives over realtime. It is a
// delivery channel only -- what gets written to the notification center is
// decided server-side, and nothing here is scheduled: with no tab open there
// is no desktop popup (the notification still waits in the bell).
//
// The user's 'browser' preference is read once per session and remembered
// here, so the realtime handler can check it synchronously; the settings card
// updates it when the user flips the switch.

let remembered: { userId: string; enabled: boolean } | null = null
const shown = new Set<string>()

export function rememberBrowserPreference(userId: string, enabled: boolean) {
  remembered = { userId, enabled }
}

export function browserPreferenceFor(userId: string): boolean | null {
  return remembered?.userId === userId ? remembered.enabled : null
}

export type BrowserPermission = NotificationPermission | 'unsupported'

export function browserPermission(): BrowserPermission {
  if (typeof window === 'undefined' || !('Notification' in window))
    return 'unsupported'
  return Notification.permission
}

// Whether a just-arrived notification should also pop up on the desktop: the
// user allows it, the browser allows it, OnTask isn't the window they're
// looking at, and it is new (a reconnect replaying old rows never pops up).
export function shouldShowBrowserNotification({
  enabled,
  permission,
  pageFocused,
  createdAt,
  readAt,
  now = Date.now(),
}: {
  enabled: boolean
  permission: BrowserPermission
  pageFocused: boolean
  createdAt: string
  readAt: string | null
  now?: number
}): boolean {
  if (!enabled || permission !== 'granted' || pageFocused || readAt)
    return false
  const age = now - Date.parse(createdAt)
  return Number.isFinite(age) && age < 2 * 60_000
}

export function showBrowserNotification(row: {
  id: string
  title: string
  body: string | null
  created_at: string
  read_at: string | null
  user_id: string
}) {
  if (typeof window === 'undefined' || shown.has(row.id)) return
  const enabled = browserPreferenceFor(row.user_id)
  if (
    !shouldShowBrowserNotification({
      // Not loaded yet counts as the default, which is on.
      enabled: enabled !== false,
      permission: browserPermission(),
      pageFocused:
        document.visibilityState === 'visible' && document.hasFocus(),
      createdAt: row.created_at,
      readAt: row.read_at,
    })
  )
    return
  shown.add(row.id)
  try {
    const popup = new Notification('OnTask', {
      body: row.body ? `${row.title}\n${row.body}` : row.title,
      icon: '/favicon.ico',
      // Several tabs raise the same notification once.
      tag: row.id,
    })
    popup.onclick = () => {
      window.focus()
      popup.close()
    }
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}
