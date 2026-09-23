import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESYNC_AFTER_HIDDEN_MS, onResync } from './onResync'

function stubPage() {
  const listeners = new Map<string, Set<() => void>>()
  const target = {
    addEventListener: (type: string, handler: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(handler)
    },
    removeEventListener: (type: string, handler: () => void) =>
      void listeners.get(type)?.delete(handler),
  }
  const doc = { ...target, visibilityState: 'visible' }
  vi.stubGlobal('window', target)
  vi.stubGlobal('document', doc)
  const fire = (type: string) => {
    for (const handler of listeners.get(type) ?? []) handler()
  }
  return {
    listenerCount: () =>
      [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    online: () => fire('online'),
    hide: () => {
      doc.visibilityState = 'hidden'
      fire('visibilitychange')
    },
    show: () => {
      doc.visibilityState = 'visible'
      fire('visibilitychange')
    },
  }
}

describe('onResync', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('re-reads whenever the network comes back', () => {
    const page = stubPage()
    const resync = vi.fn()
    onResync(resync)
    page.online()
    page.online()
    expect(resync).toHaveBeenCalledTimes(2)
  })

  it('does not re-read after a quick look at another tab', () => {
    const page = stubPage()
    const resync = vi.fn()
    onResync(resync)
    page.hide()
    vi.advanceTimersByTime(RESYNC_AFTER_HIDDEN_MS - 1)
    page.show()
    expect(resync).not.toHaveBeenCalled()
  })

  it('re-reads after the tab was hidden long enough for the socket to drop', () => {
    const page = stubPage()
    const resync = vi.fn()
    onResync(resync)
    page.hide()
    vi.advanceTimersByTime(RESYNC_AFTER_HIDDEN_MS)
    page.show()
    expect(resync).toHaveBeenCalledTimes(1)
  })

  it('measures each absence on its own', () => {
    const page = stubPage()
    const resync = vi.fn()
    onResync(resync)
    page.hide()
    vi.advanceTimersByTime(RESYNC_AFTER_HIDDEN_MS)
    page.show()
    page.hide()
    vi.advanceTimersByTime(1000)
    page.show()
    expect(resync).toHaveBeenCalledTimes(1)
  })

  it('counts from when the tab was first hidden, if it was hidden at mount', () => {
    const page = stubPage()
    page.hide()
    const resync = vi.fn()
    onResync(resync)
    vi.advanceTimersByTime(RESYNC_AFTER_HIDDEN_MS)
    page.show()
    expect(resync).toHaveBeenCalledTimes(1)
  })

  it('re-reads when it becomes visible without having seen it hidden', () => {
    const page = stubPage()
    const resync = vi.fn()
    onResync(resync)
    page.show()
    expect(resync).toHaveBeenCalledTimes(1)
  })

  it('stops listening', () => {
    const page = stubPage()
    const resync = vi.fn()
    const stop = onResync(resync)
    stop()
    page.online()
    page.show()
    expect(resync).not.toHaveBeenCalled()
    expect(page.listenerCount()).toBe(0)
  })
})
