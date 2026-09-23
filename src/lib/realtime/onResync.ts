// When a live list should re-read its data from the database, because realtime
// may have missed changes: a dropped websocket (laptop sleep, network blip) can
// silently lose postgres_changes events.
//
//  - The network coming back ('online') always re-reads.
//  - The tab coming back into view re-reads only after it was hidden long
//    enough for the socket to plausibly have dropped. A background tab's
//    timers are throttled, so its heartbeat can lapse and the server closes the
//    socket -- but a quick glance at another tab keeps it connected, and there
//    re-reading every list on the page (a dozen at once on the overview) only
//    repeats what realtime already delivered.
//
// A 'visible' event without an observed 'hidden' before it is treated as a long
// absence -- when in doubt, re-read.
//
// Returns the function that stops listening.
export const RESYNC_AFTER_HIDDEN_MS = 30_000

export function onResync(resync: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }
  let hiddenSince: number | null =
    document.visibilityState === 'hidden' ? Date.now() : null

  const handleOnline = () => resync()
  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince ??= Date.now()
      return
    }
    if (document.visibilityState !== 'visible') return
    const away = hiddenSince === null ? Infinity : Date.now() - hiddenSince
    hiddenSince = null
    if (away >= RESYNC_AFTER_HIDDEN_MS) resync()
  }

  window.addEventListener('online', handleOnline)
  document.addEventListener('visibilitychange', handleVisibility)
  return () => {
    window.removeEventListener('online', handleOnline)
    document.removeEventListener('visibilitychange', handleVisibility)
  }
}
