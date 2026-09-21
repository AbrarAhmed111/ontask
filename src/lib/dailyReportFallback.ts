import { formatHM } from '@/lib/time'
import { hasReportActivity, reportTaskStatus } from '@/lib/dailyReportMetrics'
import {
  StructuredSnapshotMember,
  SummaryGenerationMeta,
  SummaryNarrative,
  WorkspaceStructuredSnapshot,
} from '@/types/workspace'

// A deterministic, non-AI narrative built directly from an already-computed
// StructuredSnapshot -- used ONLY when the call to ontask-llm itself fails
// (network error, timeout, non-2xx response). ontask-llm never raises for a
// provider/validation failure -- it always returns a 200 with its own
// deterministic fallback narrative in that case -- so this is strictly for "we
// couldn't even reach/parse the AI service", not "the AI's narrative failed
// validation".
//
// It reads like a short summary, not a database dump: one sentence per person
// naming what they completed and what they carried on with, by the tasks' real
// titles (never a placeholder), with the exact durations the backend computed.
// Mirrors ontask-llm/src/app/services/report_context.py's
// build_fallback_paragraphs string-for-string (both are tested against the same
// scenario), so a report reads the same whichever side produced the fallback.
// Deliberately never persists a report without a real, already-computed
// snapshot: the whole point is that AI narration can fail without the factual
// report failing.

const NO_ACTIVITY_SUMMARY =
  'No significant workspace activity was recorded during the previous 24 hours.'
const MAX_FALLBACK_MEMBERS = 6
const MAX_FALLBACK_TITLES = 3
const MAX_SIDE_ITEMS = 8

// How each person is written: the first name of their display name when that is
// unambiguous among everyone the report mentions, otherwise the whole display
// name. An email address is shown exactly as it is -- nothing is derived from it.
class PeopleNames {
  private nameByUser = new Map<string, string>()
  private firstNameCounts = new Map<string, number>()

  add(
    userId: string | null | undefined,
    displayName: string | null | undefined,
  ) {
    const name = (displayName ?? '').trim()
    if (!userId || !name || this.nameByUser.has(userId)) return
    this.nameByUser.set(userId, name)
    const first = this.firstName(name).toLowerCase()
    this.firstNameCounts.set(first, (this.firstNameCounts.get(first) ?? 0) + 1)
  }

  private firstName(name: string): string {
    if (name.includes('@')) return name
    return name.split(/\s+/)[0] || name
  }

  display(userId: string, fallback: string): string {
    const name = this.nameByUser.get(userId)
    if (!name) return fallback
    const first = this.firstName(name)
    if (
      name.includes('@') ||
      (this.firstNameCounts.get(first.toLowerCase()) ?? 0) > 1
    )
      return name
    return first
  }
}

function collectPeople(snapshot: WorkspaceStructuredSnapshot): PeopleNames {
  const people = new PeopleNames()
  snapshot.members.forEach(m => people.add(m.user_id, m.display_name))
  for (const blocker of snapshot.blockers ?? []) {
    people.add(blocker.blocked_by_user_id, blocker.blocked_by_name)
    blocker.mentioned.forEach(m => people.add(m.user_id, m.display_name))
    people.add(blocker.resolved_by_user_id, blocker.resolved_by_name)
  }
  const changes = snapshot.workspace_changes
  changes.invitations.forEach(i =>
    people.add(i.invited_by_user_id, i.invited_by_name),
  )
  changes.members_joined.forEach(m => people.add(m.user_id, m.display_name))
  changes.members_removed.forEach(m => people.add(m.user_id, m.display_name))
  return people
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function quotedList(titles: string[]): string {
  const shown = titles.slice(0, MAX_FALLBACK_TITLES).map(t => `"${t}"`)
  const extra = titles.length - shown.length
  if (extra > 0) shown.push(`${extra} more`)
  if (shown.length <= 1) return shown.join('')
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

// A completed task counts as completed BY this report only if a completion is in
// the period (or, on a snapshot with no events at all, if it simply ended
// completed) -- a task completed, reopened and running again is not one, and one
// finished before the period is not this period's.
function completedInPeriod(
  member: StructuredSnapshotMember,
  task: StructuredSnapshotMember['task_activity'][number],
): boolean {
  if (reportTaskStatus(task) !== 'completed') return false
  if (member.events.length === 0) return true
  return member.events.some(
    e => e.task_id === task.task_id && e.type === 'completed',
  )
}

function memberSentence(
  member: StructuredSnapshotMember,
  name: string,
  withPeriod: boolean,
): string {
  const period = withPeriod ? ' during the reporting period' : ''
  const tasks = member.task_activity
  const completed = tasks
    .filter(t => completedInPeriod(member, t))
    .map(t => t.title)
  const skipped = tasks
    .filter(t => reportTaskStatus(t) === 'skipped')
    .map(t => t.title)
  const continuing = [...tasks]
    .sort((a, b) => b.focused_seconds - a.focused_seconds)
    .filter(t => {
      const status = reportTaskStatus(t)
      return status !== 'completed' && status !== 'skipped'
    })
    .map(t => t.title)

  let head: string
  if (member.focused_seconds > 0 && tasks.length > 0) {
    head = `${name} spent ${formatHM(member.focused_seconds)} focused on ${plural(tasks.length, 'task')}${period}`
  } else if (member.focused_seconds > 0) {
    head = `${name} logged ${formatHM(member.focused_seconds)} of focused time${period}`
  } else {
    head = `${name} recorded activity${period} without logging any focused time`
  }

  const tails: string[] = []
  if (completed.length > 0) tails.push(`completing ${quotedList(completed)}`)
  if (continuing.length > 0)
    tails.push(`continuing work on ${quotedList(continuing)}`)
  if (skipped.length > 0) tails.push(`skipping ${quotedList(skipped)}`)
  return `${head}${tails.length > 0 ? `, ${tails.join(' and ')}` : ''}.`
}

function blockerSentences(
  snapshot: WorkspaceStructuredSnapshot,
  people: PeopleNames,
): string[] {
  return (snapshot.blockers ?? []).slice(0, MAX_SIDE_ITEMS).map(blocker => {
    const who = people.display(
      blocker.blocked_by_user_id,
      blocker.blocked_by_name,
    )
    return blocker.still_blocked_at_report_end
      ? `${who} reported "${blocker.task_title}" as blocked, and it was still blocked at the end of the period.`
      : `${who} reported "${blocker.task_title}" as blocked, and the blocker was resolved.`
  })
}

function changesSentence(snapshot: WorkspaceStructuredSnapshot): string {
  const changes = snapshot.workspace_changes
  const bits: string[] = []
  if (changes.members_joined.length > 0)
    bits.push(`${plural(changes.members_joined.length, 'member')} joined`)
  if (changes.members_removed.length > 0)
    bits.push(`${plural(changes.members_removed.length, 'member')} left`)
  if (changes.invitations.length > 0)
    bits.push(
      `${plural(changes.invitations.length, 'invitation')} sent or updated`,
    )
  return bits.length > 0 ? `Workspace changes: ${bits.join(', ')}.` : ''
}

export function buildFallbackParagraphs(
  snapshot: WorkspaceStructuredSnapshot,
): string[] {
  const people = collectPeople(snapshot)
  const isPersonal = snapshot.workspace_type === 'personal'
  const active = snapshot.members.filter(
    m =>
      m.focused_seconds > 0 ||
      m.events.length > 0 ||
      m.task_activity.length > 0,
  )
  const blockers = blockerSentences(snapshot, people)

  if (isPersonal) {
    if (active.length === 0) {
      return [
        [
          'Some activity was recorded during the reporting period.',
          ...blockers,
        ].join(' '),
      ]
    }
    const member = active[0]
    const name = people.display(member.user_id, member.display_name)
    return [[memberSentence(member, name, true), ...blockers].join(' ')]
  }

  const overview =
    snapshot.total_focused_seconds > 0
      ? `The workspace logged ${formatHM(snapshot.total_focused_seconds)} of focused work during the reporting period.`
      : 'The workspace had recorded activity during the reporting period, with no focused time logged.'
  const paragraphs = [overview]

  const shown = active.slice(0, MAX_FALLBACK_MEMBERS)
  const sentences = shown.map(m =>
    memberSentence(m, people.display(m.user_id, m.display_name), false),
  )
  if (active.length > shown.length) {
    sentences.push(
      `${plural(active.length - shown.length, 'other member')} also had activity.`,
    )
  }
  if (sentences.length > 0) paragraphs.push(sentences.join(' '))

  const tail = [...blockers, changesSentence(snapshot)].filter(Boolean)
  if (tail.length > 0) paragraphs.push(tail.join(' '))
  return paragraphs
}

export function buildFallbackNarrative(
  snapshot: WorkspaceStructuredSnapshot,
): SummaryNarrative {
  if (!hasReportActivity(snapshot)) {
    return {
      overall_summary: NO_ACTIVITY_SUMMARY,
      members: snapshot.members.map(member => ({
        user_id: member.user_id,
        name: member.display_name,
        narrative:
          'No meaningful work activity was recorded during this reporting period.',
      })),
      summary: NO_ACTIVITY_SUMMARY,
      format_version: 2,
      workspace_changes_summary: '',
      highlights: [],
    }
  }
  const people = collectPeople(snapshot)
  const isPersonal = snapshot.workspace_type === 'personal'
  const blockers = blockerSentences(snapshot, people)
  const members = snapshot.members.map(member => {
    const name = people.display(member.user_id, member.display_name)
    const hasMemberActivity =
      member.focused_seconds > 0 ||
      member.events.length > 0 ||
      member.task_activity.length > 0
    return {
      user_id: member.user_id,
      name: member.display_name,
      narrative: hasMemberActivity
        ? memberSentence(member, name, isPersonal)
        : 'No meaningful work activity was recorded during this reporting period.',
    }
  })
  const summary = buildFallbackParagraphs(snapshot).join('\n\n')
  return {
    overall_summary: summary,
    members,
    summary,
    format_version: 2,
    workspace_changes_summary: '',
    highlights: blockers,
  }
}

/** `meta` for a report whose narrative was produced by `buildFallbackNarrative` above,
 * because the AI service itself could not be reached -- distinct from ontask-llm's own
 * `used_fallback_template` (AI reachable, narrative rejected by validation). */
export function buildUnreachableFallbackMeta(
  reason: string,
): SummaryGenerationMeta {
  return {
    provider: 'none',
    model: 'rule_based',
    generated_at: new Date().toISOString(),
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    status_events: [],
    used_fallback_template: true,
    validation_warnings: [`AI summary service unreachable: ${reason}`],
  }
}
