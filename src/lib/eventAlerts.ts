// Event alerts in an open OnTask tab: a chime (and, through
// lib/browserNotifications.ts, a desktop popup even while OnTask is the window
// in front) when an event reminder arrives -- above all "<event> is starting
// now.", which every event sends at its start
// (supabase/migrations/20260927140000_event_start_alert.sql).
//
// Like the desktop popup, this is delivery only: the reminder itself is
// written server-side and waits in the bell whether or not a tab rang.

export const EVENT_REMINDER_TYPES = [
  'event_reminder',
  'personal_event_reminder',
] as const

export function isEventReminder(type: string | null | undefined): boolean {
  return (EVENT_REMINDER_TYPES as readonly string[]).includes(type ?? '')
}

// The reminder sent at the event's start (offset 0), as opposed to one before.
export function isEventStartAlert(row: {
  notification_type?: string | null
  metadata?: unknown
}): boolean {
  if (!isEventReminder(row.notification_type)) return false
  const metadata = row.metadata as { offsetMinutes?: unknown } | null
  return Number(metadata?.offsetMinutes) === 0
}

// ── the per-device sound switch ─────────────────────────────────────────────
// A property of this browser (speakers, a shared office), not of the account,
// so it lives in localStorage. On unless turned off.
const SOUND_KEY = 'ontask:event-sound'

export function eventSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setEventSoundEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off')
  } catch {
    // Storage blocked: the switch just doesn't stick.
  }
}

// ── one ring across tabs ────────────────────────────────────────────────────
// Every open tab receives the same notification; only the first to claim it
// rings. localStorage isn't a lock, but two tabs reading within the same
// millisecond is the worst case (a double ring), never a missed one.
export function claimAlert(
  id: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage(),
): boolean {
  if (!storage) return true
  const key = `ontask:alerted:${id}`
  try {
    if (storage.getItem(key)) return false
    storage.setItem(key, String(Date.now()))
  } catch {
    return true
  }
  return true
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

// ── the chime ───────────────────────────────────────────────────────────────
// Browsers only let a page make sound after the person has interacted with
// it, so the audio context is created (or resumed) on the first click or key
// press and kept. Until then a chime is skipped; the desktop popup still
// shows, and the OS usually plays its own sound for it.
let context: AudioContext | null = null
let primed = false

function audioContextClass(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ||
    null
  )
}

// Call from inside a click handler to make sound possible right away.
export function unlockEventSound() {
  unlock()
}

function unlock() {
  const AudioContextClass = audioContextClass()
  if (!AudioContextClass) return
  try {
    context ??= new AudioContextClass()
    if (context.state === 'suspended') void context.resume()
  } catch {
    context = null
  }
}

export function primeEventSound() {
  if (primed || typeof window === 'undefined') return
  primed = true
  const events = ['pointerdown', 'keydown', 'touchstart'] as const
  const handler = () => {
    unlock()
    if (context?.state === 'running')
      events.forEach(name => window.removeEventListener(name, handler))
  }
  events.forEach(name =>
    window.addEventListener(name, handler, { passive: true }),
  )
}

// Two rising notes for a reminder; the start rings three, twice.
export function playEventChime(kind: 'start' | 'reminder') {
  if (!context || context.state !== 'running') return
  const notes = kind === 'start' ? [660, 880, 1175] : [660, 880]
  const rounds = kind === 'start' ? 2 : 1
  const step = 0.18
  let at = context.currentTime + 0.02
  for (let round = 0; round < rounds; round++) {
    for (const frequency of notes) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, at)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.42)
      at += step
    }
    at += 0.35
  }
}

// A just-arrived notification row: ring for an event reminder that is new
// and unread, once across tabs, while this device's sound is on.
export function ringForNotification(row: {
  id: string
  notification_type?: string | null
  metadata?: unknown
  created_at: string
  read_at: string | null
}) {
  if (typeof window === 'undefined') return
  if (!isEventReminder(row.notification_type) || row.read_at) return
  const age = Date.now() - Date.parse(row.created_at)
  if (!Number.isFinite(age) || age > 2 * 60_000) return
  if (!eventSoundEnabled() || !claimAlert(`sound:${row.id}`)) return
  playEventChime(isEventStartAlert(row) ? 'start' : 'reminder')
}
