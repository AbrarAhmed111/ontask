'use client'

import { useEffect, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  BrowserPermission,
  browserPermission,
} from '@/lib/browserNotifications'
import { playEventChime, unlockEventSound } from '@/lib/eventAlerts'
import { requestNotificationPermission } from '@/lib/notifications'

const DISMISSED_KEY = 'ontask:event-alerts-banner'

// The view, given the browser's answer so far -- separate so it renders the
// same in tests. Only while the browser hasn't been asked yet.
export function EventAlertsBannerView({
  permission,
  onEnable,
  onDismiss,
}: {
  permission: BrowserPermission
  onEnable: () => void
  onDismiss: () => void
}) {
  if (permission !== 'default') return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white/70 px-4 py-3">
      <p className="flex min-w-0 items-start gap-2 text-xs leading-5 text-muted">
        <BellRing
          size={15}
          className="mt-0.5 shrink-0 text-[var(--ws-accent,#375b4b)]"
        />
        <span>
          <span className="font-semibold text-ink">
            Get alerted when an event starts.
          </span>{' '}
          OnTask can ring and show a desktop notification while a tab is open.
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="secondary" onClick={onEnable}>
          Turn on alerts
        </Button>
        <button
          type="button"
          aria-label="Not now"
          onClick={onDismiss}
          className="rounded-lg p-2 text-muted transition hover:bg-slate-100 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

// Browsers never show a site's notifications until the person allows them,
// and the "Browser notifications" preference is on by default -- so without
// asking here, most people would never see an event's desktop alert. Asked on
// a click (Safari requires one), which also unlocks the chime.
export function EventAlertsBanner() {
  const [permission, setPermission] = useState<BrowserPermission>('granted')
  useEffect(() => {
    let dismissed = false
    try {
      dismissed = window.localStorage.getItem(DISMISSED_KEY) === 'dismissed'
    } catch {
      // Storage blocked: ask each visit.
    }
    setPermission(dismissed ? 'granted' : browserPermission())
  }, [])

  return (
    <EventAlertsBannerView
      permission={permission}
      onEnable={() => {
        unlockEventSound()
        void requestNotificationPermission().then(answer => {
          setPermission(answer)
          if (answer === 'granted') playEventChime('reminder')
        })
      }}
      onDismiss={() => {
        try {
          window.localStorage.setItem(DISMISSED_KEY, 'dismissed')
        } catch {
          // Storage blocked: hidden for this visit only.
        }
        setPermission('granted')
      }}
    />
  )
}
