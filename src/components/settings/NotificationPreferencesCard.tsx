'use client'

import { useState } from 'react'
import { Bell, BellRing, Inbox, ShieldCheck } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { PreferenceToggle } from '@/components/ui/PreferenceToggle'
import { Skeleton } from '@/components/ui/Skeleton'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences'
import {
  NOTIFICATION_PREFERENCE_GROUPS,
  NotificationPreferenceKey,
  NotificationPreferences,
  isPreferenceEnabled,
} from '@/lib/notificationPreferences'
import {
  BrowserPermission,
  browserPermission,
  rememberBrowserPreference,
} from '@/lib/browserNotifications'
import { requestNotificationPermission } from '@/lib/notifications'

function browserNote(permission: BrowserPermission, enabled: boolean): string {
  if (permission === 'unsupported')
    return 'This browser can’t show desktop notifications.'
  if (permission === 'denied')
    return 'Blocked in your browser’s site settings — allow notifications for OnTask there to use this.'
  if (enabled && permission === 'default')
    return 'Your browser will ask for permission the first time.'
  return 'Shown while an OnTask tab is open, when you’re looking at another window.'
}

// The view, given preferences -- separate from the data so it renders the same
// in tests.
export function NotificationPreferencesView({
  ready,
  error,
  preferences,
  permission,
  onChange,
}: {
  ready: boolean
  error: string | null
  preferences: NotificationPreferences
  permission: BrowserPermission
  onChange: (key: NotificationPreferenceKey, enabled: boolean) => void
}) {
  const browserOn = isPreferenceEnabled(preferences, 'browser')
  return (
    <SettingsCard icon={Bell} title="Your notifications">
      {error && <ErrorBanner variant="flush">{error}</ErrorBanner>}
      {!ready ? (
        <div className="space-y-3 px-5 py-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <div className="space-y-6 px-5 py-4">
          <p className="text-xs leading-5 text-muted">
            What you personally receive, in every workspace. Workspace owners
            decide what a workspace sends; you decide what reaches you.
          </p>

          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
              Delivery
            </h3>
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              <div className="flex items-start gap-3 rounded-xl border border-line p-3">
                <Inbox
                  size={14}
                  className="mt-0.5 text-[var(--ws-accent,#375b4b)]"
                />
                <span>
                  <span className="block text-xs font-semibold text-ink">
                    In-app notifications
                  </span>
                  <span className="mt-1 block text-[11px] leading-5 text-muted">
                    Always on — the bell keeps everything you receive.
                  </span>
                </span>
              </div>
              <PreferenceToggle
                icon={BellRing}
                title="Browser notifications"
                description={browserNote(permission, browserOn)}
                checked={browserOn && permission !== 'denied'}
                disabled={
                  permission === 'unsupported' || permission === 'denied'
                }
                onChange={enabled => onChange('browser', enabled)}
              />
            </div>
          </section>

          {NOTIFICATION_PREFERENCE_GROUPS.map(group => (
            <section key={group.title}>
              <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                {group.title}
              </h3>
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                {group.items.map(item => (
                  <PreferenceToggle
                    key={item.key}
                    icon={Bell}
                    title={item.title}
                    description={item.description}
                    checked={isPreferenceEnabled(preferences, item.key)}
                    onChange={enabled => onChange(item.key, enabled)}
                  />
                ))}
              </div>
            </section>
          ))}

          <p className="flex items-start gap-2 text-[11px] leading-5 text-muted">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            Some notifications are always delivered: losing access to a
            workspace, and workspace invitations.
          </p>
        </div>
      )}
    </SettingsCard>
  )
}

export function NotificationPreferencesCard({ userId }: { userId: string }) {
  const { preferences, ready, error, setPreference } =
    useNotificationPreferences(userId)
  const [permission, setPermission] = useState<BrowserPermission>(() =>
    browserPermission(),
  )

  const handleChange = async (
    key: NotificationPreferenceKey,
    enabled: boolean,
  ) => {
    if (key === 'browser' && enabled && permission === 'default') {
      const answer = await requestNotificationPermission()
      setPermission(answer)
      if (answer !== 'granted') return
    }
    const saved = await setPreference(key, enabled)
    if (saved && key === 'browser') rememberBrowserPreference(userId, enabled)
  }

  return (
    <NotificationPreferencesView
      ready={ready}
      error={error}
      preferences={preferences}
      permission={permission}
      onChange={(key, enabled) => void handleChange(key, enabled)}
    />
  )
}
