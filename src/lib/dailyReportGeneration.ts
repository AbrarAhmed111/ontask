import {
  buildFallbackNarrative,
  buildUnreachableFallbackMeta,
} from '@/lib/dailyReportFallback'
import {
  buildDailyReportWorkContext,
  emptyWorkContextNarrative,
} from '@/lib/dailyReportWorkContext'
import {
  SummaryGenerationMeta,
  SummaryNarrative,
  WorkspaceStructuredSnapshot,
} from '@/types/workspace'
import { hasReportActivity } from '@/lib/dailyReportMetrics'

const DAILY_REPORT_FORMAT_VERSION = 2

type GeneratedDailyReport = {
  narrative: SummaryNarrative
  meta: SummaryGenerationMeta | unknown
}

function normalizeMemberNarrative(
  value: unknown,
  expected: Map<string, string>,
) {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const userId = record.user_id
  const narrative = record.narrative
  if (typeof userId !== 'string' || !expected.has(userId)) return null
  if (typeof narrative !== 'string' || narrative.trim() === '') return null
  return {
    user_id: userId,
    name: expected.get(userId),
    narrative: narrative.trim(),
  }
}

export function normalizeDailyReportNarrative(
  raw: unknown,
  snapshot: WorkspaceStructuredSnapshot,
): SummaryNarrative | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const expectedMembers = new Map(
    snapshot.members.map(member => [member.user_id, member.display_name]),
  )
  const rawMembers = Array.isArray(record.members) ? record.members : []
  if (
    rawMembers.some(member => {
      if (!member || typeof member !== 'object') return true
      const userId = (member as Record<string, unknown>).user_id
      return typeof userId !== 'string' || !expectedMembers.has(userId)
    })
  ) {
    return null
  }
  const members = rawMembers
    .map(member => normalizeMemberNarrative(member, expectedMembers))
    .filter(member => member !== null)

  const expectedIds = new Set(expectedMembers.keys())
  const seenIds = new Set(members.map(member => member.user_id))
  if (
    members.length !== expectedIds.size ||
    [...expectedIds].some(userId => !seenIds.has(userId))
  ) {
    return null
  }

  const summary = record.summary
  if (typeof summary !== 'string' || summary.trim() === '') return null

  return {
    overall_summary: '',
    members,
    summary: summary.trim(),
    format_version: DAILY_REPORT_FORMAT_VERSION,
    workspace_changes_summary: '',
    highlights: [],
  }
}

export async function generateDailyReportNarrative({
  snapshot,
  serviceUrl,
  timeoutMs = 45_000,
}: {
  snapshot: WorkspaceStructuredSnapshot
  serviceUrl: string
  timeoutMs?: number
}): Promise<GeneratedDailyReport> {
  if (!hasReportActivity(snapshot)) {
    return {
      narrative: emptyWorkContextNarrative(snapshot),
      meta: buildUnreachableFallbackMeta('No meaningful work context'),
    }
  }

  const workContext = buildDailyReportWorkContext(snapshot)
  try {
    const response = await fetch(`${serviceUrl}/api/summary/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_context: workContext }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      throw new Error(`ontask-llm responded ${response.status}`)
    }
    const data = await response.json()
    const narrative = normalizeDailyReportNarrative(data.narrative, snapshot)
    if (!narrative) {
      throw new Error('ontask-llm returned an invalid Daily Report narrative')
    }
    return {
      narrative,
      meta: data.meta,
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'AI summary service unavailable'
    return {
      narrative: buildFallbackNarrative(snapshot),
      meta: buildUnreachableFallbackMeta(message),
    }
  }
}
