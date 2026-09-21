import {
  SummaryCurrentStatus,
  SummaryNarrative,
  WorkspaceStructuredSnapshot,
} from '@/types/workspace'

// The exact numbers a Daily Report shows, taken straight from the snapshot the
// backend computed -- never from the AI narrative, which is asked to describe
// what happened in words and to state none of them.
export type DailyReportMetrics = {
  focusedSeconds: number
  // Distinct tasks completed in the period that are still completed at its end.
  tasksCompleted: number
  // Members with any recorded activity (only meaningful for a shared workspace).
  activeMembers: number
}

// A task's state at the end of the period. `current_status` is authoritative;
// a snapshot from before migration 0042 only has the coarser `status_end`, so
// the two are folded into one vocabulary here (its "in progress" stays a
// distinct, honest "in_progress" rather than being guessed as working/paused).
export type ReportTaskStatus = SummaryCurrentStatus | 'in_progress'

export function reportTaskStatus(task: {
  current_status?: SummaryCurrentStatus | null
  status_end: 'completed' | 'in_progress' | 'skipped'
}): ReportTaskStatus {
  return task.current_status ?? task.status_end
}

export function getDailyReportMetrics(
  snapshot: WorkspaceStructuredSnapshot,
): DailyReportMetrics {
  let tasksCompleted = snapshot.metrics?.tasks_completed
  if (tasksCompleted === undefined) {
    // An older snapshot: count distinct tasks that ended completed.
    const completed = new Set<string>()
    for (const member of snapshot.members) {
      for (const task of member.task_activity) {
        if (reportTaskStatus(task) === 'completed') completed.add(task.task_id)
      }
    }
    tasksCompleted = completed.size
  }
  return {
    focusedSeconds: snapshot.total_focused_seconds,
    tasksCompleted,
    activeMembers: snapshot.members.filter(
      member =>
        member.focused_seconds > 0 ||
        (member.work_sessions?.length ?? 0) > 0 ||
        member.events.length > 0 ||
        member.task_activity.length > 0,
    ).length,
  }
}

export function hasReportActivity(
  snapshot: WorkspaceStructuredSnapshot,
): boolean {
  const changes = snapshot.workspace_changes
  return (
    snapshot.total_focused_seconds > 0 ||
    snapshot.members.some(
      member =>
        member.events.length > 0 ||
        member.task_activity.length > 0 ||
        (member.work_sessions?.length ?? 0) > 0,
    ) ||
    (snapshot.blockers?.length ?? 0) > 0 ||
    changes.invitations.length > 0 ||
    changes.members_joined.length > 0 ||
    changes.members_removed.length > 0 ||
    changes.tasks_created > 0 ||
    changes.tasks_completed > 0 ||
    changes.tasks_skipped > 0 ||
    changes.tasks_deleted > 0
  )
}

// The narrative as the paragraphs it was written in. New reports carry all of
// their prose in `overall_summary`, paragraphs separated by a blank line; an
// older one is a single paragraph, and its per-member notes and bullet
// highlights are deliberately not shown (the report is a narrative, not a list).
export function narrativeParagraphs(narrative: {
  overall_summary: string
}): string[] {
  return narrative.overall_summary
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
}

export type DailyReportNarrativeSection = {
  kind: 'member' | 'summary'
  userId?: string
  name: string
  paragraphs: string[]
}

function textParagraphs(text: unknown): string[] {
  if (typeof text !== 'string') return []
  return text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
}

function memberNarrativeText(member: unknown): string | null {
  if (!member || typeof member !== 'object') return null
  const record = member as Record<string, unknown>
  if (typeof record.narrative === 'string') return record.narrative
  if (typeof record.note === 'string') return record.note
  return null
}

export function dailyReportNarrativeSections(
  narrative: SummaryNarrative | null,
): DailyReportNarrativeSection[] {
  if (!narrative || typeof narrative !== 'object') return []

  const members = Array.isArray(narrative.members) ? narrative.members : []
  const memberSections = members.flatMap(member => {
    if (!member || typeof member !== 'object') return []
    const record = member as Record<string, unknown>
    const paragraphs = textParagraphs(memberNarrativeText(member))
    if (paragraphs.length === 0) return []
    const name =
      typeof record.name === 'string' && record.name.trim()
        ? record.name.trim()
        : typeof record.user_id === 'string'
          ? record.user_id
          : 'Member'
    return [
      {
        kind: 'member' as const,
        userId: typeof record.user_id === 'string' ? record.user_id : undefined,
        name,
        paragraphs,
      },
    ]
  })

  const summaryParagraphs = textParagraphs(narrative.summary)
  if (memberSections.length > 0 || summaryParagraphs.length > 0) {
    return [
      ...memberSections,
      ...(summaryParagraphs.length > 0
        ? [
            {
              kind: 'summary' as const,
              name: 'Summary',
              paragraphs: summaryParagraphs,
            },
          ]
        : []),
    ]
  }

  return textParagraphs(narrative.overall_summary).length
    ? [
        {
          kind: 'summary',
          name: 'Summary',
          paragraphs: narrativeParagraphs(narrative),
        },
      ]
    : []
}
