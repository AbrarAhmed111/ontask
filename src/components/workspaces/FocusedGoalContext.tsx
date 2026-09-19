'use client'

import { createContext, useContext, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// A goal the page was asked to bring into view — by a Slack message's "Open
// Goal" button (`/workspaces/<slug>?goal=<id>`). Same shape and same lifetime
// rules as FocusedTaskContext's task focus; `at` makes every request a new
// value, so following the same link twice opens it twice.
export type GoalFocus = { id: string; at: number }

// How long after being asked a card still answers. A Goal card can mount well
// after the request — the workspace's goals are fetched client-side — and past
// this a stale request must not yank the page around.
const FOCUS_WINDOW_MS = 15_000

const FocusedGoalContext = createContext<GoalFocus | null>(null)

export const FocusedGoalProvider = FocusedGoalContext.Provider

// The request, if it is for this goal and still fresh.
export function useGoalFocus(goalId: string): GoalFocus | null {
  const focus = useContext(FocusedGoalContext)
  return focus && focus.id === goalId && Date.now() - focus.at < FOCUS_WINDOW_MS
    ? focus
    : null
}

// Reads `?goal=` and hands it up once, then removes it from the URL — the
// mirror of TaskFocusFromUrl and ReportFocusFromUrl, and mounted the same way,
// under its own <Suspense fallback={null}> because useSearchParams opts its
// nearest boundary out of static rendering.
export function GoalFocusFromUrl({
  onFocus,
}: {
  onFocus: (focus: GoalFocus) => void
}) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const goalId = params.get('goal')

  useEffect(() => {
    if (!goalId) return
    onFocus({ id: goalId, at: Date.now() })
    router.replace(pathname, { scroll: false })
  }, [goalId, onFocus, pathname, router])

  return null
}
