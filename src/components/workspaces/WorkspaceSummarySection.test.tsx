import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildDailyReportDigest } from '@/lib/dailyReportDigest'
import { buildSlackEventMessage } from '@/lib/integrations/slack/slackMessageBuilder'
import {
  BlockersSection,
  WorkspaceSummarySection,
} from '@/components/workspaces/WorkspaceSummarySection'
import {
  BOOK,
  EVO,
  abrar,
  blocker as snapshotBlocker,
  event,
  sharedSnapshot,
  snapshot,
  summary,
  task,
} from '@/lib/dailyReportTestData'
import type {
  StructuredSnapshotBlocker,
  WorkspaceDailySummary,
} from '@/types/workspace'

const blocker = (
  overrides: Partial<StructuredSnapshotBlocker> = {},
): StructuredSnapshotBlocker =>
  snapshotBlocker({
    reason: 'Waiting for API credentials from @Araysh.',
    blocked_by_name: 'Abrar Ahmed',
    blocked_at: '2026-09-19T09:00:00Z',
    resolved_at: '2026-09-19T11:00:00Z',
    ...overrides,
  })

const renderBlockers = (blockers: StructuredSnapshotBlocker[]) =>
  renderToStaticMarkup(<BlockersSection blockers={blockers} />)

describe('the Daily Report blockers section', () => {
  it('shows nothing when no blocker overlapped the period', () => {
    expect(renderBlockers([])).toBe('')
  })

  it('records a resolved blocker: the reason as written, who was asked, who resolved it and what changed', () => {
    const html = renderBlockers([blocker()])
    expect(html).toContain('Student API')
    expect(html).toContain('Waiting for API credentials from @Araysh.')
    expect(html).toContain('Reported by Abrar Ahmed')
    expect(html).toContain('asked Araysh Khan')
    expect(html).toContain('Resolved by Araysh Khan')
    expect(html).toContain('API credentials have been provided.')
    expect(html).toContain('Resolved')
    expect(html).not.toContain('Still blocked')
  })

  it('states the time blocked from the recorded seconds', () => {
    expect(renderBlockers([blocker({ blocked_seconds: 7200 })])).toContain(
      'blocked 2h 0m in this period',
    )
  })

  it('reports a blocker still open at the end of the period as still blocked, with no resolution', () => {
    const html = renderBlockers([
      blocker({
        resolved_at: null,
        resolved_by_user_id: null,
        resolved_by_name: null,
        resolution_note: null,
        still_blocked_at_report_end: true,
      }),
    ])
    expect(html).toContain('Still blocked')
    expect(html).not.toContain('Resolved by')
  })

  it('lists every blocker, and keeps a subtask’s parent', () => {
    const html = renderBlockers([
      blocker(),
      blocker({
        blocker_id: 'b-2',
        task_title: 'Auth',
        parent_title: 'School MVP',
        mentioned: [],
      }),
    ])
    expect(html).toContain('Student API')
    expect(html).toContain('Auth (under School MVP)')
  })

  it('does not invent a resolver for a blocker resolved by someone who has left', () => {
    expect(renderBlockers([blocker({ resolved_by_name: null })])).toContain(
      'Resolved by a former member',
    )
  })
})

// ── the report as a whole ────────────────────────────────────────────────────

const PERSONAL_NARRATIVE = `Abrar spent most of the reporting period on "${EVO}", picking it back up several times, completing it, reopening it as the work continued, and finally completing it again. Abrar also spent some time on "${BOOK}".`

const SHARED_NARRATIVE = `Abrar spent most of the reporting period on "${EVO}", completing it after several work sessions.\n\nRachel also started on "Onboarding flow", which is still being worked on.`

// Text as a reader sees it: no markup, no React text-node separators, entities decoded.
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

const render = (
  report: WorkspaceDailySummary | null,
  props: Partial<Parameters<typeof WorkspaceSummarySection>[0]> = {},
) =>
  renderToStaticMarkup(
    <WorkspaceSummarySection
      ready
      summary={report}
      members={[]}
      nextReportLabel="Tomorrow at 12:00 PM"
      reportTimeLabel="12:00 PM"
      generating={false}
      onRegenerate={() => {}}
      {...props}
    />,
  )

describe('the Daily Report: a personal workspace', () => {
  const personal = summary(snapshot(), PERSONAL_NARRATIVE)
  const html = render(personal, { isPersonal: true })

  it('does not lead with generic deterministic figures beside the narrative', () => {
    const t = text(html)
    expect(t).not.toContain('4h 48m focused')
    expect(t).not.toContain('1 task completed')
  })

  it('shows the AI narrative as prose', () => {
    expect(text(html)).toContain(PERSONAL_NARRATIVE)
    expect(html).not.toContain('<li')
  })

  it('never shows a member count', () => {
    const t = text(
      render(personal, { isPersonal: true, defaultExpanded: true }),
    )
    expect(t).not.toMatch(/member/i)
    expect(t).not.toContain('1 user')
    expect(t).not.toContain('active')
  })

  it('does not list raw events, and names the person only in the narrative', () => {
    const detailed = text(
      render(personal, { isPersonal: true, defaultExpanded: true }),
    )
    expect(detailed).not.toContain('Resumed working on')
    expect(detailed).not.toContain('Paused "') // the event line, not the status chip
    expect(detailed).not.toContain('Started working on')
    expect(detailed).not.toContain('Abrar Ahmed') // no "team of one" header
    expect(detailed).toContain('Tasks worked on')
  })

  it('shows each task’s current status, taken from the record', () => {
    const detailed = text(
      render(personal, { isPersonal: true, defaultExpanded: true }),
    )
    expect(detailed).toContain(`${EVO} 3h 0m Completed`)
    expect(detailed).toContain(`${BOOK} 1h 48m Paused`)
  })
})

describe('the Daily Report: a shared workspace', () => {
  const shared = summary(sharedSnapshot(), SHARED_NARRATIVE)

  it('does not lead with workspace activity metrics', () => {
    const t = text(render(shared))
    expect(t).not.toContain('5h 48m focused')
    expect(t).not.toContain('2 members active')
  })

  it('writes a multi-paragraph narrative as separate paragraphs', () => {
    const html = render(shared)
    expect(
      html.match(/<p class="text-sm leading-6 text-ink">/g)?.length,
    ).toBeGreaterThanOrEqual(2)
    expect(text(html)).toContain('Rachel also started on')
  })

  it('breaks the work down per member, by avatar/name, with exact times', () => {
    const html = render(shared)
    const t = text(html)
    expect(t).toContain('Member reports')
    expect(t).toContain('Abrar Ahmed worked on')
    expect(t).toContain('Rachel Smith worked on')
    expect(t).toContain('Abrar Ahmed')
    expect(t).toContain('4h 48m')
    expect(t).toContain('Rachel Smith')
    expect(t).toContain('1h 0m')
    expect(t).toContain('Onboarding flow 1h 0m Working')
    expect(html).toContain('title="Abrar Ahmed"')
    expect(html).toContain('title="Rachel Smith"')
  })

  it('still does not turn the narrative into per-member lines or an event log', () => {
    const t = text(render(shared))
    expect(t).not.toMatch(/Member \d/)
    expect(t).not.toContain('Resumed working on')
  })
})

describe('the Daily Report: deterministic facts stay authoritative', () => {
  it('shows a task’s state at the end of the period, however many times it was completed', () => {
    const running = snapshot({
      members: [
        abrar({
          task_activity: [
            task({
              task_id: 'task-evo',
              title: EVO,
              focused_seconds: 10800,
              status_end: 'in_progress',
              current_status: 'working',
            }),
          ],
        }),
      ],
      metrics: { tasks_worked_on: 1, tasks_completed: 0 },
    })
    const t = text(
      render(summary(running, 'Abrar kept working.'), {
        isPersonal: true,
        defaultExpanded: true,
      }),
    )
    expect(t).toContain(`${EVO} 3h 0m Working`)
    expect(t).not.toContain('Completed')
    expect(t).not.toMatch(/\d task[s]? completed/) // nothing completed at the end
  })

  it('never shows a second, contradictory "completed" count in the details', () => {
    // three completion EVENTS (a task completed, reopened, completed again), one
    // task actually still completed: only the headline figure may say so
    const snap = snapshot({
      workspace_changes: {
        invitations: [],
        members_joined: [],
        members_removed: [],
        tasks_created: 2,
        tasks_completed: 3,
        tasks_skipped: 0,
        tasks_deleted: 0,
      },
    })
    const t = text(
      render(summary(snap, 'Abrar was busy.'), {
        isPersonal: true,
        defaultExpanded: true,
      }),
    )
    expect(t).not.toContain('1 task completed')
    expect(t).not.toContain('3 tasks completed')
    expect(t).toContain('2 tasks created') // the other counts are still useful
  })

  it('does not turn narrative claims into metric chips', () => {
    const t = text(
      render(summary(snapshot(), 'Abrar was busy all day.'), {
        isPersonal: true,
      }),
    )
    expect(t).not.toContain('4h 48m focused')
    expect(t).toContain('Abrar was busy all day.')
  })

  it('shows the report’s own window', () => {
    expect(text(render(summary(snapshot(), PERSONAL_NARRATIVE)))).toContain(
      'Previous 24 hours',
    )
  })

  it('renders a report stored before this change without inventing anything', () => {
    const legacy = snapshot()
    delete legacy.metrics
    delete legacy.workspace_type
    legacy.members[0].task_activity.forEach(t => delete t.current_status)
    const t = text(
      render(summary(legacy, 'A single old paragraph.'), {
        isPersonal: true,
        defaultExpanded: true,
      }),
    )
    expect(t).toContain('A single old paragraph.')
    expect(t).not.toContain('1 task completed')
    expect(t).toContain(`${BOOK} 1h 48m In progress`)
  })
})

describe('the Daily Report never falls back to "a task"', () => {
  it('has no per-event text to put it in, whatever the events look like', () => {
    const snap = snapshot({
      members: [
        abrar({
          events: [
            event('resumed', 5, { task_id: 'task-ghost', task_title: null }),
            event('goal_created', 6, {
              task_id: null,
              task_title: null,
              subject: 'Ship v1',
            }),
            ...abrar().events,
          ],
        }),
      ],
    })
    const t = text(
      render(summary(snap, PERSONAL_NARRATIVE), {
        isPersonal: true,
        defaultExpanded: true,
      }),
    )
    expect(t).not.toMatch(/\ba task\b/)
    expect(t).not.toContain('Deleted task')
  })
})

describe('the Daily Report: other states', () => {
  it('shows the no-activity sentence alone, with no metrics', () => {
    const idle = summary(
      snapshot({ total_focused_seconds: 0, members: [] }),
      'No significant workspace activity was recorded during the previous 24 hours.',
    )
    const t = text(render(idle))
    expect(t).toContain('No significant workspace activity')
    expect(t).not.toContain('focused')
    expect(t).not.toContain('Show details')
  })

  it('shows blockers and details for a window whose only news is a blocker', () => {
    const blockersOnly = summary(
      snapshot({
        total_focused_seconds: 0,
        members: [],
        blockers: [blocker()],
      }),
      '"Student API" was blocked, and the blocker was resolved.',
    )
    const html = render(blockersOnly, { defaultExpanded: true })
    expect(text(html)).toContain('Student API')
    expect(html).toContain('Blockers')
  })

  it('treats a completed fallback row as retryable, not as a finished report', () => {
    const fallback = summary(snapshot(), PERSONAL_NARRATIVE, {
      meta: { ...summary(snapshot(), '').meta, used_fallback_template: true },
    })
    const t = text(render(fallback))
    expect(t).toContain("Daily Report couldn't be generated yet")
    expect(t).toContain('Retry')
    expect(t).not.toContain("AI narration wasn't available")
    expect(t).not.toContain(PERSONAL_NARRATIVE)
  })

  it('offers Regenerate on a finished report, and Retry on a failed one', () => {
    expect(text(render(summary(snapshot(), PERSONAL_NARRATIVE)))).toContain(
      'Regenerate',
    )
    const failed = summary(snapshot(), '', { generationStatus: 'failed' })
    expect(text(render(failed))).toContain('Retry')
  })

  it('says what is coming when there is no report yet', () => {
    expect(text(render(null))).toContain('Next report: Tomorrow at 12:00 PM')
  })
})

describe('the Daily Reports switch', () => {
  it('shows nothing at all when Daily Reports are off, even with reports already stored', () => {
    const stored = summary(snapshot(), PERSONAL_NARRATIVE)
    expect(render(stored, { enabled: false })).toBe('')
  })

  it('shows no empty card and no "no reports yet" placeholder when off', () => {
    expect(render(null, { enabled: false })).toBe('')
    expect(render(null, { enabled: false, ready: false })).toBe('')
  })

  it('brings the section, and the stored report, back when switched on again', () => {
    const stored = summary(snapshot(), PERSONAL_NARRATIVE)
    expect(render(stored, { enabled: false })).toBe('')
    const on = text(render(stored, { enabled: true, isPersonal: true }))
    expect(on).toContain('Daily Report')
    expect(on).toContain(PERSONAL_NARRATIVE)
  })

  it('is on by default for a caller that does not say', () => {
    expect(text(render(null))).toContain('Daily Report')
  })
})

// ── the same report, in the app and in Slack ────────────────────────────────
// Slack's Daily Report message is built from the stored row, through the same
// helpers this card renders it with (narrativeParagraphs, getDailyReportMetrics).
// The risk that creates is drift: two renderings of one report that slowly stop
// agreeing. So this renders the card and builds the Slack message from ONE
// stored report and checks that everything Slack says, the card says too.
describe('the Daily Report in Slack and in the app', () => {
  const stored = summary(sharedSnapshot(), SHARED_NARRATIVE)

  const slackMessage = () =>
    buildSlackEventMessage({
      workspaceName: 'Design Team',
      workspaceSlug: 'design-team',
      eventType: 'daily_report_ready',
      reportId: stored.id,
      report: buildDailyReportDigest(stored),
    })

  // Slack mrkdwn escapes the three characters it reads as markup; undo that to
  // compare the words themselves.
  const unescape = (value: string) =>
    value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/[*`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  const slackBody = () => {
    const section = slackMessage().blocks.find(
      block => (block as { type: string }).type === 'section',
    ) as { text: { text: string } }
    return section.text.text
  }

  it('says nothing in Slack that the card does not show', () => {
    const onScreen = text(render(stored, { isPersonal: false }))

    for (const paragraph of slackBody().split('\n\n')) {
      expect(onScreen).toContain(unescape(paragraph))
    }
  })

  it('keeps deterministic figures out of the card headline', () => {
    const onScreen = text(render(stored, { isPersonal: false }))
    const context = slackMessage().blocks.find(
      block => (block as { type: string }).type === 'context',
    ) as { elements: { text: string }[] }

    // 17280 + 3600 focused seconds and metrics.tasks_completed = 1, both read
    // from the snapshot by getDailyReportMetrics -- the card's own source.
    expect(context.elements[0].text).toContain('5h 48m focused')
    expect(context.elements[0].text).toContain('1 task completed')
    expect(onScreen).not.toContain('5h 48m focused')
    expect(onScreen).not.toContain('1 task completed')
  })

  it('links to the report the card is showing', () => {
    const actions = slackMessage().blocks.find(
      block => (block as { type: string }).type === 'actions',
    ) as { elements: { url: string }[] }

    expect(actions.elements[0].url).toContain(`?report=${stored.id}`)
  })
})
