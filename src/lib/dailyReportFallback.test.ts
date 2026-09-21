import { describe, expect, it } from 'vitest'
import {
  buildFallbackNarrative,
  buildFallbackParagraphs,
  buildUnreachableFallbackMeta,
} from './dailyReportFallback'
import {
  BOOK,
  EVO,
  abrar,
  blocker,
  event,
  rachel,
  sharedSnapshot,
  snapshot,
  task,
} from './dailyReportTestData'

// The deterministic TS-side fallback (used when ontask-llm itself is
// unreachable). It mirrors ontask-llm's report_context.build_fallback_paragraphs
// string-for-string -- the Personal and Shared expectations below are the very
// same strings asserted by ontask-llm/tests/test_report_context.py -- and it must
// never disagree with the backend's own numbers or invent a task name.

describe('buildFallbackNarrative: a personal workspace', () => {
  it('is one concise sentence built from the real facts', () => {
    const narrative = buildFallbackNarrative(snapshot())
    expect(narrative.overall_summary).toBe(
      `Abrar spent 4h 48m focused on 2 tasks during the reporting period, completing "${EVO}" and continuing work on "${BOOK}".`,
    )
    // one legacy paragraph, plus the v2 member narrative shape
    expect(narrative.overall_summary).not.toContain('\n')
    expect(narrative.members).toEqual([
      {
        user_id: 'user-abrar',
        name: 'Abrar Ahmed',
        narrative: `Abrar spent 4h 48m focused on 2 tasks during the reporting period, completing "${EVO}" and continuing work on "${BOOK}".`,
      },
    ])
    expect(narrative.summary).toBe(narrative.overall_summary)
    expect(narrative.format_version).toBe(2)
    expect(narrative.highlights).toEqual([])
    expect(narrative.workspace_changes_summary).toBe('')
  })

  it('never says "member" or "team", or counts the one person', () => {
    const text = buildFallbackNarrative(
      snapshot({ blockers: [blocker({ task_title: EVO })] }),
    ).overall_summary
    expect(text.toLowerCase()).not.toContain('member')
    expect(text.toLowerCase()).not.toContain('team')
  })

  it('names the person by their display name, first name only when unambiguous', () => {
    expect(buildFallbackNarrative(snapshot()).overall_summary).toMatch(
      /^Abrar /,
    )
    const emailOnly = snapshot({
      members: [abrar({ display_name: 'abrar.ahmed@example.com' })],
    })
    // nothing is derived from an email address
    expect(buildFallbackNarrative(emailOnly).overall_summary).toMatch(
      /^abrar\.ahmed@example\.com spent/,
    )
  })

  it('does not claim a completion for a task completed, reopened and running again', () => {
    const running = abrar({
      task_activity: [
        task({
          task_id: 'task-evo',
          title: EVO,
          focused_seconds: 10800,
          status_end: 'in_progress',
          current_status: 'working',
        }),
        abrar().task_activity[1],
      ],
    })
    const text = buildFallbackNarrative(
      snapshot({ members: [running] }),
    ).overall_summary
    expect(text).not.toContain('completing')
    expect(text).toContain(`continuing work on "${EVO}"`)
  })

  it('does not claim a task that was already completed before the period', () => {
    const member = abrar({
      focused_seconds: 600,
      events: [event('progress_changed', 10)],
      task_activity: [
        task({
          task_id: 'task-evo',
          title: EVO,
          focused_seconds: 600,
          status_end: 'completed',
          current_status: 'completed',
        }),
      ],
    })
    expect(
      buildFallbackNarrative(snapshot({ members: [member] })).overall_summary,
    ).toBe('Abrar spent 0h 10m focused on 1 task during the reporting period.')
  })

  it('reads naturally with time recorded but no per-task rows', () => {
    const member = abrar({ task_activity: [], events: [] })
    expect(
      buildFallbackNarrative(snapshot({ members: [member] })).overall_summary,
    ).toBe('Abrar logged 4h 48m of focused time during the reporting period.')
  })
})

describe('buildFallbackNarrative: a shared workspace', () => {
  it('reads as a summary: an overview, then a sentence per person', () => {
    const paragraphs = buildFallbackParagraphs(sharedSnapshot())
    expect(paragraphs[0]).toBe(
      'The workspace logged 5h 48m of focused work during the reporting period.',
    )
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[1]).toContain('Abrar spent 4h 48m focused on 2 tasks')
    expect(paragraphs[1]).toContain(
      'Rachel spent 1h 0m focused on 1 task, continuing work on "Onboarding flow".',
    )
    expect(paragraphs[1]).not.toContain('Abrar Ahmed')
  })

  it('tells two members with the same first name apart by their full names', () => {
    const text = buildFallbackParagraphs(
      sharedSnapshot({
        members: [
          abrar(),
          rachel({ user_id: 'user-abrar-khan', display_name: 'Abrar Khan' }),
        ],
      }),
    )[1]
    expect(text).toContain('Abrar Ahmed spent')
    expect(text).toContain('Abrar Khan spent')
  })

  it('folds a long member list into "N other members"', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      rachel({
        user_id: `u${i}`,
        display_name: `Person${i} Example`,
        focused_seconds: 100 - i,
      }),
    )
    const text = buildFallbackParagraphs(sharedSnapshot({ members: many }))[1]
    expect(text).toContain('2 other members also had activity.')
    expect(text).not.toContain('Person7')
  })

  it('closes with blockers and membership changes', () => {
    const paragraphs = buildFallbackParagraphs(
      sharedSnapshot({
        blockers: [blocker()],
        workspace_changes: {
          invitations: [
            {
              invited_email: 'a@example.com',
              invited_by_user_id: 'user-abrar',
              invited_by_name: 'Abrar Ahmed',
              status: 'pending',
              responded_at: null,
            },
          ],
          members_joined: [{ user_id: 'u9', display_name: 'Newcomer' }],
          members_removed: [],
          tasks_created: 0,
          tasks_completed: 0,
          tasks_skipped: 0,
          tasks_deleted: 0,
        },
      }),
    )
    const last = paragraphs[paragraphs.length - 1]
    expect(last).toContain(
      'Abrar reported "Student API" as blocked, and the blocker was resolved.',
    )
    expect(last).toContain('1 member joined')
    expect(last).toContain('1 invitation sent or updated')
  })

  it('says a blocker was still blocked, and never invents a resolution', () => {
    const open = blocker({
      resolved_at: null,
      resolved_by_user_id: null,
      resolved_by_name: null,
      resolution_note: null,
      still_blocked_at_report_end: true,
    })
    const text = buildFallbackNarrative(
      sharedSnapshot({ blockers: [open] }),
    ).overall_summary
    expect(text).toContain('still blocked at the end of the period')
    expect(text).not.toContain('was resolved')
  })
})

describe('buildFallbackNarrative: task identity', () => {
  it('uses the real titles and never a generic replacement', () => {
    const text = buildFallbackNarrative(sharedSnapshot()).overall_summary
    expect(text).toContain(EVO)
    expect(text).toContain(BOOK)
    expect(text).toContain('Onboarding flow')
    for (const placeholder of [
      'a task',
      'the task',
      'some task',
      'Deleted task',
    ]) {
      expect(text).not.toContain(placeholder)
    }
  })

  it('does not produce a placeholder for events on tasks that could not be resolved', () => {
    const member = abrar({
      events: [
        event('resumed', 3, { task_id: 'task-ghost', task_title: null }),
      ],
    })
    const text = buildFallbackNarrative(
      snapshot({ members: [member] }),
    ).overall_summary
    expect(text).not.toMatch(/a task|null|undefined/)
  })
})

describe('buildFallbackNarrative: nothing to report', () => {
  it('produces the no-activity sentence when nothing happened', () => {
    const narrative = buildFallbackNarrative(
      snapshot({ total_focused_seconds: 0, members: [] }),
    )
    expect(narrative.overall_summary).toBe(
      'No significant workspace activity was recorded during the previous 24 hours.',
    )
    expect(narrative.members).toEqual([])
  })

  it('still reports on an invitation-only window with zero focused time', () => {
    const narrative = buildFallbackNarrative(
      sharedSnapshot({
        total_focused_seconds: 0,
        members: [],
        workspace_changes: {
          invitations: [
            {
              invited_email: 'ali@example.com',
              invited_by_user_id: 'abrar',
              invited_by_name: 'Abrar Ahmed',
              status: 'pending',
              responded_at: null,
            },
          ],
          members_joined: [],
          members_removed: [],
          tasks_created: 0,
          tasks_completed: 0,
          tasks_skipped: 0,
          tasks_deleted: 0,
        },
      }),
    )
    expect(narrative.overall_summary).not.toContain(
      'No significant workspace activity',
    )
    expect(narrative.overall_summary).toContain('1 invitation sent or updated')
  })

  it('treats a blockers-only window as activity, not an idle one', () => {
    const narrative = buildFallbackNarrative(
      sharedSnapshot({
        total_focused_seconds: 0,
        members: [],
        blockers: [blocker()],
      }),
    )
    expect(narrative.overall_summary).not.toContain(
      'No significant workspace activity',
    )
    expect(narrative.overall_summary).toContain('"Student API"')
  })

  it('leaves reports from before blockers existed exactly as they were', () => {
    // No `blockers` key at all, as on a stored pre-feature snapshot.
    const legacy = sharedSnapshot()
    delete legacy.blockers
    expect(() => buildFallbackNarrative(legacy)).not.toThrow()
    expect(buildFallbackNarrative(legacy).overall_summary).not.toContain(
      'blocked',
    )
  })
})

describe('buildUnreachableFallbackMeta', () => {
  it('flags the report as a fallback with the failure reason recorded', () => {
    const meta = buildUnreachableFallbackMeta('fetch failed: ECONNREFUSED')
    expect(meta.used_fallback_template).toBe(true)
    expect(meta.provider).toBe('none')
    expect(meta.validation_warnings[0]).toContain('ECONNREFUSED')
  })
})
