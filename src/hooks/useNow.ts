'use client'

import { useEffect, useState } from 'react'

// The current time, re-read every `intervalMs` while `active`. For clocks that
// run entirely in the browser (the Overview's event countdown): nothing here
// asks the server anything.
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs, active])
  return now
}
