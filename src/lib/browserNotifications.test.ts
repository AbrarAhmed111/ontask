import { describe, expect, it } from 'vitest'
import { shouldShowBrowserNotification } from '@/lib/browserNotifications'

describe('desktop notifications', () => {
  const now = Date.parse('2026-10-01T09:00:00Z')
  const base = {
    enabled: true,
    permission: 'granted' as const,
    pageFocused: false,
    createdAt: '2026-10-01T08:59:30Z',
    readAt: null,
    now,
  }

  it('pop up for a new notification while OnTask is in the background', () => {
    expect(shouldShowBrowserNotification(base)).toBe(true)
  })

  it('stay quiet when the user or the browser says no, or they are looking', () => {
    expect(shouldShowBrowserNotification({ ...base, enabled: false })).toBe(
      false,
    )
    expect(
      shouldShowBrowserNotification({ ...base, permission: 'default' }),
    ).toBe(false)
    expect(
      shouldShowBrowserNotification({ ...base, permission: 'denied' }),
    ).toBe(false)
    expect(shouldShowBrowserNotification({ ...base, pageFocused: true })).toBe(
      false,
    )
  })

  it('never replay old or already-read notifications', () => {
    expect(
      shouldShowBrowserNotification({
        ...base,
        createdAt: '2026-10-01T08:50:00Z',
      }),
    ).toBe(false)
    expect(
      shouldShowBrowserNotification({
        ...base,
        readAt: '2026-10-01T08:59:40Z',
      }),
    ).toBe(false)
  })
})
