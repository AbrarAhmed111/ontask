import { describe, expect, it } from 'vitest'
import {
  buildDailyReportDigest,
  decideDailyReportForSlack,
  type StoredDailyReport,
} from '@/lib/dailyReportDigest'
import { narrativeParagraphs } from '@/lib/dailyReportMetrics'
import {
  abrar,
  blocker,
  rachel,
  sharedSnapshot,
  snapshot,
  summary,
} from '@/lib/dailyReportTestData'
import type { WorkspaceStructuredSnapshot } from '@/types/workspace'

/**
 * The short form of a report that has already been generated.
 *
 * Every assertion here is about the same thing from a different angle: what
 * reaches Slack was READ, not written. The narration is compared against the
 * stored string, the figures against the stored snapshot, and the cases where
 * there is nothing worth sending are the product's own (pending, failed, a day
 * with nothing on it) rather than new ones invented for Slack.
 */

const stored = (
  narrative: string,
  snap: WorkspaceStructuredSnapshot = snapshot(),
): StoredDailyReport => {
  const full = summary(snap, narrative)
  return {
    generationStatus: full.generationStatus,
    narrative: full.narrative,
    structuredSnapshot: full.structuredSnapshot,
  }
}

const NARRATION = [
  'Abrar spent 4h 48m focused on two tasks over the previous 24 hours, finishing "Working on OnTask Evolution" and carrying "Finishing Chapters of 2nd Book" forward.',
  'The Evolution work was completed, reopened once and completed again, which is what the repeated resume events describe rather than a second piece of work.',
  'Nothing was blocked during the period and no one else recorded activity.',
].join('\n\n')

describe('buildDailyReportDigest — the narration', () => {
  it('carries the stored paragraphs word for word', () => {
    const digest = buildDailyReportDigest(stored(NARRATION))

    expect(digest.paragraphs).toEqual(
      narrativeParagraphs({ overall_summary: NARRATION }),
    )
    // Not a rewrite of the report: every paragraph is a substring of what the
    // app itself renders.
    for (const paragraph of digest.paragraphs) {
      expect(NARRATION).toContain(paragraph)
    }
  })

  it('is shorter than the full report when the report is long', () => {
    const long = Array.from(
      { length: 7 },
      (_, i) =>
        `Paragraph ${i + 1}. ${'The workspace kept working through the afternoon on the integration. '.repeat(3)}`,
    ).join('\n\n')

    const digest = buildDailyReportDigest(stored(long))

    expect(digest.paragraphs.length).toBeLessThanOrEqual(3)
    expect(digest.paragraphs.join('\n\n').length).toBeLessThan(long.length)
    expect(digest.shortened).toBe(true)
  })

  it('keeps a short report whole, and says so', () => {
    const digest = buildDailyReportDigest(stored(NARRATION))

    expect(digest.paragraphs).toHaveLength(3)
    expect(digest.shortened).toBe(false)
  })

  it('cuts a single runaway paragraph at a sentence rather than mid-word', () => {
    const runaway = `${'A complete sentence about the day. '.repeat(40)}`
    const digest = buildDailyReportDigest(stored(runaway))

    expect(digest.paragraphs).toHaveLength(1)
    expect(digest.paragraphs[0].length).toBeLessThan(runaway.length)
    expect(digest.paragraphs[0].endsWith('day.')).toBe(true)
    expect(digest.shortened).toBe(true)
  })

  it('survives a report whose narration never landed', () => {
    const withoutNarration: StoredDailyReport = {
      ...stored(''),
      narrative: null as unknown as StoredDailyReport['narrative'],
    }

    const digest = buildDailyReportDigest(withoutNarration)

    expect(digest.paragraphs).toEqual([])
    // The figures are still real, so there is still something true to send.
    expect(digest.facts.length).toBeGreaterThan(0)
  })

  it('survives a narrative object with no summary in it', () => {
    const empty = stored('')
    empty.narrative = {
      overall_summary: null as unknown as string,
      members: [],
      workspace_changes_summary: '',
      highlights: [],
    }

    expect(() => buildDailyReportDigest(empty)).not.toThrow()
    expect(buildDailyReportDigest(empty).paragraphs).toEqual([])
  })
})

describe('buildDailyReportDigest — the figures', () => {
  it('reports the figures the report itself stores, not a recount of its events', () => {
    const snap = sharedSnapshot({ blockers: [blocker()] })
    const digest = buildDailyReportDigest(stored(NARRATION, snap))

    // 17280 + 3600 seconds focused, metrics.tasks_completed = 1, two members
    // with activity, one blocker that ended resolved.
    expect(digest.facts).toContain('5h 48m focused')
    expect(digest.facts).toContain('1 task completed')
    expect(digest.facts).toContain('2 members active')
    expect(digest.facts).toContain('1 blocker resolved')
  })

  it('counts a blocker that outlived the period as still blocked', () => {
    const snap = sharedSnapshot({
      blockers: [
        blocker({
          still_blocked_at_report_end: true,
          resolved_at: null,
          resolved_by_user_id: null,
          resolved_by_name: null,
          resolution_note: null,
        }),
      ],
    })

    expect(buildDailyReportDigest(stored(NARRATION, snap)).facts).toContain(
      '1 still blocked',
    )
  })

  it('never counts members in a personal workspace', () => {
    const digest = buildDailyReportDigest(stored(NARRATION, snapshot()))

    expect(digest.facts.join(' · ')).not.toContain('member')
  })

  it('takes workspace changes from the stored counts', () => {
    const snap = snapshot({
      workspace_changes: {
        invitations: [],
        members_joined: [],
        members_removed: [],
        tasks_created: 4,
        tasks_completed: 9,
        tasks_skipped: 1,
        tasks_deleted: 0,
      },
    })

    const facts = buildDailyReportDigest(stored(NARRATION, snap)).facts
    expect(facts).toContain('4 tasks created')
    expect(facts).toContain('1 task skipped')
    // workspace_changes.tasks_completed counts completion EVENTS; the headline
    // figure is metrics.tasks_completed, the one the card shows. Slack must not
    // publish the other one.
    expect(facts).not.toContain('9 tasks completed')
    expect(facts).toContain('1 task completed')
  })

  it('leaves out every figure a quiet report has none of', () => {
    const quiet = snapshot({
      members: [abrar({ focused_seconds: 0, events: [], task_activity: [] })],
      metrics: { tasks_worked_on: 0, tasks_completed: 0 },
    })

    expect(buildDailyReportDigest(stored(NARRATION, quiet)).facts).toEqual([])
  })
})

describe('decideDailyReportForSlack', () => {
  it('sends a completed report that has something in it', () => {
    const decision = decideDailyReportForSlack(stored(NARRATION))

    expect(decision.send).toBe(true)
    if (decision.send) expect(decision.digest.paragraphs).toHaveLength(3)
  })

  it('stays quiet while a report is still being generated', () => {
    const pending = {
      ...stored(NARRATION),
      generationStatus: 'pending' as const,
    }

    expect(decideDailyReportForSlack(pending)).toEqual({
      send: false,
      reason: 'not_completed',
    })
  })

  it('stays quiet about a report that failed', () => {
    const failed = { ...stored(NARRATION), generationStatus: 'failed' as const }

    expect(decideDailyReportForSlack(failed)).toEqual({
      send: false,
      reason: 'not_completed',
    })
  })

  // The existing product decision, in the app (hasReportActivity) and in SQL
  // (slack_payload_for_daily_summary): a day on which nothing happened is still
  // a report and still readable, it is just not news.
  it('stays quiet about a day on which nothing happened', () => {
    const empty = stored(
      'No significant workspace activity was recorded during the previous 24 hours.',
      snapshot({
        members: [abrar({ focused_seconds: 0, events: [], task_activity: [] })],
      }),
    )

    expect(decideDailyReportForSlack(empty)).toEqual({
      send: false,
      reason: 'no_activity',
    })
  })

  it('sends a report whose only activity is someone else’s', () => {
    const shared = sharedSnapshot({
      members: [
        abrar({ focused_seconds: 0, events: [], task_activity: [] }),
        rachel(),
      ],
    })

    expect(decideDailyReportForSlack(stored(NARRATION, shared)).send).toBe(true)
  })

  it('refuses a row whose snapshot cannot be read instead of throwing', () => {
    const broken: StoredDailyReport = {
      ...stored(NARRATION),
      structuredSnapshot:
        null as unknown as StoredDailyReport['structuredSnapshot'],
    }

    expect(decideDailyReportForSlack(broken)).toEqual({
      send: false,
      reason: 'unreadable',
    })
  })

  it('refuses a snapshot missing the parts every report has', () => {
    const halfWritten = {
      ...stored(NARRATION),
      structuredSnapshot: {
        workspace_id: 'ws-1',
        members: [],
      } as unknown as StoredDailyReport['structuredSnapshot'],
    }

    expect(decideDailyReportForSlack(halfWritten)).toEqual({
      send: false,
      reason: 'unreadable',
    })
  })
})
