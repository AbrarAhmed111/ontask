import { formatHM } from '@/lib/time'
import {
  DailyReportNarrativeSection,
  dailyReportNarrativeSections,
  getDailyReportMetrics,
  hasReportActivity,
} from '@/lib/dailyReportMetrics'
import {
  SummaryNarrative,
  WorkspaceDailySummary,
  WorkspaceStructuredSnapshot,
} from '@/types/workspace'

// The short form of a Daily Report that has ALREADY been generated and stored.
//
// Nothing here writes a report, asks for one, or narrates anything: every word
// it returns was read out of workspace_daily_summaries. The narration is the
// stored narrative's own paragraphs, verbatim; the figures come from
// getDailyReportMetrics() and the stored snapshot -- the same two sources
// WorkspaceSummarySection.tsx renders the card from -- so a number that reaches
// Slack is the number the report itself shows, never a second count of the same
// events.
//
// What it does decide is how much of the report to carry: Slack gets the
// opening paragraphs and a line of figures, the app keeps the rest. That is the
// only difference between this and the card.

/** The three columns of a stored report this reads: the same shape the card's
 *  `WorkspaceDailySummary` carries, so both sides describe one report with one
 *  vocabulary. */
export type StoredDailyReport = Pick<
  WorkspaceDailySummary,
  'generationStatus' | 'narrative' | 'structuredSnapshot'
>

export type DailyReportDigest = {
  /** Paragraphs of the stored narration, exactly as written. */
  paragraphs: string[]
  /** Work-context report sections, when the stored narrative has them. */
  sections?: DailyReportNarrativeSection[]
  /** Deterministic figures from the stored snapshot ("4 tasks completed"). */
  facts: string[]
  /** Task titles the backend knows, for deterministic Slack formatting. */
  taskTitles?: string[]
  /** Whether prose was left behind -- i.e. the app has more than Slack got. */
  shortened: boolean
}

/** Why a stored report is not something to announce. Each mirrors a case
 *  slack_payload_for_daily_summary() already refuses in SQL (migration 0048);
 *  they are repeated here because a payload can also arrive from a database
 *  that predates it, and because "the report says nothing" is a decision about
 *  the report, not about the trigger that noticed it. */
export type DailyReportSkipReason =
  'unreadable' | 'not_completed' | 'no_activity'

export type DailyReportDecision =
  | { send: true; digest: DailyReportDigest }
  | { send: false; reason: DailyReportSkipReason }

// Three paragraphs is the outer limit of what anyone reads in a channel, and
// the character budget is what keeps three SHORT ones from becoming a wall.
// Whatever is cut is still one click away.
const MAX_PARAGRAPHS = 3
const MAX_NARRATION_CHARS = 700
const MAX_FACTS = 6

// A snapshot that can actually be read. A report row is JSON from the database,
// so "the column is there" is not the same as "the shape is there" -- an older
// or half-written snapshot would otherwise reach getDailyReportMetrics() and
// throw inside a notification, which is the one place a crash is invisible.
function readableSnapshot(
  report: StoredDailyReport,
): WorkspaceStructuredSnapshot | null {
  const snapshot = report.structuredSnapshot as
    WorkspaceStructuredSnapshot | null | undefined
  if (!snapshot || typeof snapshot !== 'object') return null
  if (!Array.isArray(snapshot.members)) return null
  const changes = snapshot.workspace_changes
  if (!changes || typeof changes !== 'object') return null
  if (
    !Array.isArray(changes.invitations) ||
    !Array.isArray(changes.members_joined) ||
    !Array.isArray(changes.members_removed)
  ) {
    return null
  }
  return snapshot
}

// The stored narration, or nothing. A report whose AI narration never landed
// still has its figures, and those are worth sending on their own -- so a
// missing, null or empty `overall_summary` is an absence, not a failure.
function truncateAtSentence(text: string, limit: number): string {
  if (text.length <= limit) return text
  const head = text.slice(0, limit)
  const lastSentence = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('! '),
    head.lastIndexOf('? '),
  )
  // Only cut at a sentence if enough of the paragraph survives it; otherwise a
  // long opening sentence would leave Slack with almost nothing.
  if (lastSentence > limit * 0.4) return head.slice(0, lastSentence + 1)
  const lastSpace = head.lastIndexOf(' ')
  const clipped = lastSpace > 0 ? head.slice(0, lastSpace) : head
  return `${clipped.replace(/[\s,;:—-]+$/, '')}…`
}

function concise(paragraphs: string[]): {
  paragraphs: string[]
  shortened: boolean
} {
  const kept: string[] = []
  let used = 0
  for (const paragraph of paragraphs) {
    if (kept.length >= MAX_PARAGRAPHS) break
    // The first paragraph is always taken, however long: a report's opening
    // line is the one part of it Slack must not be able to lose.
    if (used > 0 && used + paragraph.length > MAX_NARRATION_CHARS) break
    kept.push(paragraph)
    used += paragraph.length
  }
  if (kept.length === 1)
    kept[0] = truncateAtSentence(kept[0], MAX_NARRATION_CHARS)
  return {
    paragraphs: kept,
    shortened: kept.join('\n\n').length < paragraphs.join('\n\n').length,
  }
}

function conciseSections(sections: DailyReportNarrativeSection[]): {
  sections: DailyReportNarrativeSection[]
  paragraphs: string[]
  shortened: boolean
} {
  const kept: DailyReportNarrativeSection[] = []
  const paragraphs: string[] = []
  let used = 0
  for (const section of sections) {
    const sectionParagraphs: string[] = []
    for (const paragraph of section.paragraphs) {
      if (paragraphs.length >= MAX_PARAGRAPHS) break
      if (used > 0 && used + paragraph.length > MAX_NARRATION_CHARS) break
      sectionParagraphs.push(paragraph)
      paragraphs.push(paragraph)
      used += paragraph.length
    }
    if (sectionParagraphs.length > 0) {
      kept.push({ ...section, paragraphs: sectionParagraphs })
    }
    if (paragraphs.length >= MAX_PARAGRAPHS) break
  }
  if (paragraphs.length === 1) {
    const clipped = truncateAtSentence(paragraphs[0], MAX_NARRATION_CHARS)
    paragraphs[0] = clipped
    kept[0] = { ...kept[0], paragraphs: [clipped] }
  }
  return {
    sections: kept,
    paragraphs,
    shortened:
      sections.flatMap(section => section.paragraphs).join('\n\n') !==
      paragraphs.join('\n\n'),
  }
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`

// The report's own figures, in the order a reader wants them. Every one is read
// from the stored snapshot through the same helper the card uses: focused time,
// distinct tasks completed and active members from getDailyReportMetrics(), the
// rest straight off workspace_changes and blockers, which is exactly where
// WorkspaceChangesSection and BlockersSection read them.
//
// Figures the snapshot does not store (tasks started, goals touched) are not
// derived here. Counting them for Slack alone would put a number in a channel
// that the report itself cannot show.
function factsFor(snapshot: WorkspaceStructuredSnapshot): string[] {
  const { focusedSeconds, tasksCompleted, activeMembers } =
    getDailyReportMetrics(snapshot)
  const changes = snapshot.workspace_changes
  const blockers = snapshot.blockers ?? []
  const resolved = blockers.filter(b => !b.still_blocked_at_report_end).length
  const stillBlocked = blockers.length - resolved

  const facts: string[] = []
  if (focusedSeconds > 0) facts.push(`${formatHM(focusedSeconds)} focused`)
  if (tasksCompleted > 0)
    facts.push(`${plural(tasksCompleted, 'task')} completed`)
  if (changes.tasks_created > 0)
    facts.push(`${plural(changes.tasks_created, 'task')} created`)
  // A personal workspace is one person's own work: "1 member active" is team
  // language for something that is not a team (the card makes the same call).
  if (snapshot.workspace_type !== 'personal' && activeMembers > 0)
    facts.push(`${plural(activeMembers, 'member')} active`)
  if (resolved > 0) facts.push(`${plural(resolved, 'blocker')} resolved`)
  if (stillBlocked > 0) facts.push(`${stillBlocked} still blocked`)
  if (changes.tasks_skipped > 0)
    facts.push(`${plural(changes.tasks_skipped, 'task')} skipped`)
  if (changes.tasks_deleted > 0)
    facts.push(`${plural(changes.tasks_deleted, 'task')} deleted`)
  return facts.slice(0, MAX_FACTS)
}

function taskTitlesFor(snapshot: WorkspaceStructuredSnapshot): string[] {
  const titles = new Set<string>()
  for (const member of snapshot.members) {
    for (const task of member.task_activity) {
      if (task.title.trim()) titles.add(task.title)
    }
  }
  for (const blocker of snapshot.blockers ?? []) {
    if (blocker.task_title.trim()) titles.add(blocker.task_title)
  }
  return [...titles].sort((a, b) => b.length - a.length)
}

export function buildDailyReportDigest(
  report: StoredDailyReport,
): DailyReportDigest {
  const snapshot = readableSnapshot(report)
  const sections = dailyReportNarrativeSections(report.narrative)
  const conciseNarrative = sections.length
    ? conciseSections(sections)
    : { ...concise([]), sections: [] }
  return {
    paragraphs: conciseNarrative.paragraphs,
    sections: conciseNarrative.sections,
    facts: snapshot ? factsFor(snapshot) : [],
    taskTitles: snapshot ? taskTitlesFor(snapshot) : [],
    shortened: conciseNarrative.shortened,
  }
}

/**
 * Whether this stored report is one to announce, and if so, the short form of
 * it. The three refusals are the product's existing ones: a report still being
 * generated has nothing to say yet, a failed one has nothing to say at all, and
 * a day on which nothing happened is still a report but is not news -- the same
 * `hasReportActivity` test the card uses to decide a report is empty.
 */
export function decideDailyReportForSlack(
  report: StoredDailyReport,
): DailyReportDecision {
  const snapshot = readableSnapshot(report)
  if (!snapshot) return { send: false, reason: 'unreadable' }
  if (report.generationStatus !== 'completed')
    return { send: false, reason: 'not_completed' }
  if (!hasReportActivity(snapshot))
    return { send: false, reason: 'no_activity' }
  return { send: true, digest: buildDailyReportDigest(report) }
}
