import { describe, expect, it } from 'vitest'
import {
  claimAlert,
  isEventReminder,
  isEventStartAlert,
} from '@/lib/eventAlerts'

describe('event alerts', () => {
  it('ring for event reminders only', () => {
    expect(isEventReminder('event_reminder')).toBe(true)
    expect(isEventReminder('personal_event_reminder')).toBe(true)
    expect(isEventReminder('event_updated')).toBe(false)
    expect(isEventReminder('assigned')).toBe(false)
    expect(isEventReminder(null)).toBe(false)
  })

  it('tell the start (offset 0) from a reminder before it', () => {
    const start = {
      notification_type: 'event_reminder',
      metadata: { offsetMinutes: 0 },
    }
    expect(isEventStartAlert(start)).toBe(true)
    expect(
      isEventStartAlert({ ...start, metadata: { offsetMinutes: 15 } }),
    ).toBe(false)
    expect(isEventStartAlert({ ...start, metadata: null })).toBe(false)
    expect(
      isEventStartAlert({ ...start, notification_type: 'event_cancelled' }),
    ).toBe(false)
  })

  it('ring once across tabs', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    }
    expect(claimAlert('n1', storage)).toBe(true)
    expect(claimAlert('n1', storage)).toBe(false)
    expect(claimAlert('n2', storage)).toBe(true)
    // No storage at all: ring rather than stay silent.
    expect(claimAlert('n1', null)).toBe(true)
  })
})
