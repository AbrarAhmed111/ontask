'use client'

import { createContext, useContext, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// The Daily Report a page was asked to bring into view — by the Slack
// message's "View Daily Report" button (`/workspaces/<slug>?report=<id>`).
// Same shape and same lifetime rules as FocusedTaskContext's task focus; `at`
// makes every request a new value, so following the same link twice scrolls
// twice.
export type ReportFocus = { id: string; at: number }

// How long after being asked the report card still answers. The card renders
// as soon as the workspace's summary loads, which can be well after the link
// was followed on a slow connection.
const FOCUS_WINDOW_MS = 15_000

const FocusedReportContext = createContext<ReportFocus | null>(null)

export const FocusedReportProvider = FocusedReportContext.Provider

// The current request, if it is still fresh. The report's id is deliberately
// NOT matched against the card's: the Daily Report section only ever renders
// the newest report, and a Slack link is sent the moment that report is
// generated — so by the time anyone clicks it, "the report this links to" and
// "the report on screen" are the same one. Matching ids would mean a link
// followed after the next night's report silently did nothing.
export function useReportFocus(): ReportFocus | null {
  const focus = useContext(FocusedReportContext)
  return focus && Date.now() - focus.at < FOCUS_WINDOW_MS ? focus : null
}

// Reads `?report=` and hands it up once, then removes it from the URL — the
// mirror of TaskFocusFromUrl, and mounted the same way, under its own
// <Suspense fallback={null}> because useSearchParams opts its nearest
// boundary out of static rendering.
export function ReportFocusFromUrl({
  onFocus,
}: {
  onFocus: (focus: ReportFocus) => void
}) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const reportId = params.get('report')

  useEffect(() => {
    if (!reportId) return
    onFocus({ id: reportId, at: Date.now() })
    router.replace(pathname, { scroll: false })
  }, [reportId, onFocus, pathname, router])

  return null
}
