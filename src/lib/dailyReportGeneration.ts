import {
  SummaryGenerationMeta,
  SummaryNarrative,
  WorkspaceStructuredSnapshot,
} from '@/types/workspace'

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
  const narrative =
    typeof record.narrative === 'string' ? record.narrative : record.note
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

  const overallSummary = record.overall_summary
  if (typeof overallSummary === 'string' && overallSummary.trim() !== '') {
    const workspaceChangesSummary = record.workspace_changes_summary
    const highlights = Array.isArray(record.highlights)
      ? record.highlights.filter(
          (highlight): highlight is string =>
            typeof highlight === 'string' && highlight.trim() !== '',
        )
      : []
    return {
      overall_summary: overallSummary.trim(),
      members,
      workspace_changes_summary:
        typeof workspaceChangesSummary === 'string'
          ? workspaceChangesSummary.trim()
          : '',
      highlights: highlights.map(highlight => highlight.trim()),
    }
  }

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

function compactDetails(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 300)
}

function fallbackFailureReason(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  const record = meta as Record<string, unknown>
  if (record.used_fallback_template !== true) return null
  const warnings = Array.isArray(record.validation_warnings)
    ? record.validation_warnings.filter(
        (warning): warning is string =>
          typeof warning === 'string' && warning.trim() !== '',
      )
    : []
  return (
    warnings[0]?.trim() || 'AI summary service returned deterministic fallback'
  )
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
  let response: Response
  try {
    response = await fetch(`${serviceUrl}/api/summary/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'AI summary service unavailable'
    throw new Error(`AI summary service unreachable: ${message}`)
  }

  if (!response.ok) {
    const details = compactDetails(await response.text().catch(() => ''))
    throw new Error(
      `AI summary service unreachable: ontask-llm responded ${response.status}` +
        (details ? `: ${details}` : ''),
    )
  }

  const data = await response.json().catch(() => null)
  if (!data || typeof data !== 'object') {
    throw new Error('ontask-llm returned an invalid Daily Report response')
  }

  const meta = (data as { meta?: unknown }).meta
  const fallbackReason = fallbackFailureReason(meta)
  if (fallbackReason) throw new Error(fallbackReason)

  const narrative = normalizeDailyReportNarrative(
    (data as { narrative?: unknown }).narrative,
    snapshot,
  )
  if (!narrative) {
    throw new Error('ontask-llm returned an invalid Daily Report narrative')
  }

  return {
    narrative,
    meta,
  }
}
