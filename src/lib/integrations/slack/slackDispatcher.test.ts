import { beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in for the service-role client, narrow enough to be readable and
// wide enough to exercise the order the dispatcher does things in: the
// idempotency insert, then the connection, then the workspace, then profiles.
const postSlackMessage = vi.fn()
const createServiceRoleClient = vi.fn()

vi.mock('./slackClient', () => ({
  postSlackMessage: (...args: unknown[]) => postSlackMessage(...args),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => createServiceRoleClient(),
}))

const { dispatchSlackNotification } = await import('./slackDispatcher')

type Row = Record<string, unknown>

interface FakeDb {
  connections: Row[]
  workspaces: Row[]
  profiles: Row[]
  summaries: Row[]
  deliveries: { workspace_id: string; event_id: string; event_type: string }[]
  updates: Row[]
  /** Every table the dispatcher wrote to, so a test can show it only READ the
   *  report it announced. */
  writes: string[]
}

function fakeClient(db: FakeDb) {
  return {
    from(table: string) {
      const filters: Row = {}
      const rowsOf = () =>
        table === 'workspace_slack_connections'
          ? db.connections
          : table === 'workspaces'
            ? db.workspaces
            : table === 'workspace_daily_summaries'
              ? db.summaries
              : db.profiles
      const match = () =>
        rowsOf().find(candidate =>
          Object.entries(filters).every(
            ([key, value]) => candidate[key] === value,
          ),
        )
      const builder: Record<string, unknown> = {
        insert(row: Row) {
          db.writes.push(table)
          if (table === 'workspace_slack_deliveries') {
            const clash = db.deliveries.some(
              d =>
                d.workspace_id === row.workspace_id &&
                d.event_id === row.event_id &&
                d.event_type === row.event_type,
            )
            if (clash) return Promise.resolve({ error: { code: '23505' } })
            db.deliveries.push(row as (typeof db.deliveries)[number])
          }
          return Promise.resolve({ error: null })
        },
        update(row: Row) {
          db.writes.push(table)
          db.updates.push(row)
          return {
            eq: () => Promise.resolve({ error: null }),
          }
        },
        select() {
          return builder
        },
        eq(column: string, value: unknown) {
          filters[column] = value
          return builder
        },
        single() {
          const found = match()
          return Promise.resolve(
            found
              ? { data: found, error: null }
              : { data: null, error: { code: 'PGRST116' } },
          )
        },
        maybeSingle() {
          return Promise.resolve({ data: match() ?? null, error: null })
        },
      }
      return builder
    },
  }
}

// A report row as workspace_daily_summaries really holds one: snake_case
// columns, the snapshot and the narrative as stored JSON. The narration is the
// string the Daily Report card would render.
const REPORT_NARRATION = [
  'Abrar spent 5h 20m focused on the Slack integration and completed 4 tasks, finishing the authentication work.',
  'Two blockers were raised during the period and both were resolved before it ended.',
].join('\n\n')

function storedReport(overrides: Row = {}): Row {
  return {
    id: 'report-1',
    workspace_id: 'ws-a',
    generation_status: 'completed',
    narrative: {
      overall_summary: REPORT_NARRATION,
      members: [],
      workspace_changes_summary: '',
      highlights: [],
    },
    structured_snapshot: {
      workspace_id: 'ws-a',
      workspace_name: 'DevAbby',
      workspace_type: 'shared',
      report_start: '2026-09-19T12:00:00Z',
      report_end: '2026-09-20T12:00:00Z',
      timezone: 'UTC',
      total_focused_seconds: 19200,
      metrics: { tasks_worked_on: 6, tasks_completed: 4 },
      members: [
        {
          user_id: 'user-1',
          display_name: 'Abrar',
          focused_seconds: 19200,
          events: [],
          task_activity: [],
        },
      ],
      blockers: [],
      workspace_changes: {
        invitations: [],
        members_joined: [],
        members_removed: [],
        tasks_created: 2,
        tasks_completed: 5,
        tasks_skipped: 0,
        tasks_deleted: 0,
      },
    },
    ...overrides,
  }
}

const CONNECTED = {
  id: 'conn-a',
  workspace_id: 'ws-a',
  bot_access_token: 'xoxb-a',
  channel_id: 'C-A',
  connection_status: 'connected',
  notification_settings: {},
}

let db: FakeDb

beforeEach(() => {
  postSlackMessage.mockReset()
  postSlackMessage.mockResolvedValue({ ok: true })
  db = {
    connections: [
      { ...CONNECTED },
      {
        id: 'conn-b',
        workspace_id: 'ws-b',
        bot_access_token: 'xoxb-b',
        channel_id: 'C-B',
        connection_status: 'connected',
        notification_settings: {},
      },
    ],
    workspaces: [
      { id: 'ws-a', name: 'DevAbby', slug: 'devabby' },
      { id: 'ws-b', name: 'Other Co', slug: 'other-co' },
    ],
    profiles: [
      { id: 'user-1', full_name: 'Abrar', email: 'abrar@example.com' },
      { id: 'user-2', full_name: 'Araysh', email: 'araysh@example.com' },
      { id: 'user-3', full_name: 'Iqra', email: 'iqra@example.com' },
    ],
    summaries: [storedReport()],
    deliveries: [],
    updates: [],
    writes: [],
  }
  createServiceRoleClient.mockReset()
  createServiceRoleClient.mockImplementation(() => fakeClient(db))
})

describe('dispatchSlackNotification', () => {
  it('delivers a newly covered event end to end', async () => {
    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'note_added',
      eventId: 'event-1',
      taskId: 'task-1',
      taskTitle: 'Student CRUD API',
      actorId: 'user-1',
    })

    expect(result).toEqual({ success: true, outcome: 'delivered' })
    expect(postSlackMessage).toHaveBeenCalledTimes(1)
    const [token, channel, fallback] = postSlackMessage.mock.calls[0]
    expect(token).toBe('xoxb-a')
    expect(channel).toBe('C-A')
    expect(fallback).toBe('[DevAbby] Abrar added a note to "Student CRUD API"')
  })

  // The bug 0046 meant to fix and did not: the trigger sent eventId, the API
  // route dropped it, so this insert never ran and a repeated http_post was a
  // repeated Slack message.
  it('sends an event once, however many times the same event id arrives', async () => {
    const params = {
      workspaceId: 'ws-a',
      eventType: 'completed',
      eventId: 'event-7',
      taskId: 'task-1',
      taskTitle: 'Student CRUD API',
      actorId: 'user-1',
    }

    const first = await dispatchSlackNotification(params)
    const second = await dispatchSlackNotification(params)

    expect(first.outcome).toBe('delivered')
    expect(second.outcome).toBe('duplicate_event_skipped')
    expect(postSlackMessage).toHaveBeenCalledTimes(1)
  })

  it('names collaborators who are still working after one member completes', async () => {
    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'completed',
      eventId: 'event-10',
      entityType: 'goal_task',
      taskId: 'task-1',
      taskTitle: 'Collect Free Cloud LLM API Keys',
      goalName: 'Automation System DM/Email',
      actorId: 'user-1',
      remainingCollaboratorUserIds: ['user-2', 'user-3'],
    })

    expect(result).toEqual({ success: true, outcome: 'delivered' })
    const blocks = postSlackMessage.mock.calls[0][3]
    expect(JSON.stringify(blocks)).toContain(
      'Araysh and Iqra are still working on it.',
    )
  })

  it('still lets a different event on the same entity through', async () => {
    await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'started',
      eventId: 'event-8',
      taskId: 'task-1',
      actorId: 'user-1',
    })
    await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'completed',
      eventId: 'event-9',
      taskId: 'task-1',
      actorId: 'user-1',
    })

    expect(postSlackMessage).toHaveBeenCalledTimes(2)
  })

  it('honours the preference group an event belongs to', async () => {
    db.connections[0].notification_settings = { notes: false }

    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'note_added',
      eventId: 'event-2',
      taskId: 'task-1',
      actorId: 'user-1',
    })

    expect(result.outcome).toBe('notification_type_disabled')
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  it('leaves the other groups on when one is switched off', async () => {
    db.connections[0].notification_settings = { notes: false }

    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'completed',
      eventId: 'event-3',
      taskId: 'task-1',
      actorId: 'user-1',
    })

    expect(result.outcome).toBe('delivered')
  })

  it('posts a workspace event only to that workspace connection', async () => {
    await dispatchSlackNotification({
      workspaceId: 'ws-b',
      eventType: 'goal_created',
      eventId: 'event-4',
      entityName: 'Q4 Launch',
      actorId: 'user-1',
    })

    expect(postSlackMessage).toHaveBeenCalledTimes(1)
    const [token, channel, fallback] = postSlackMessage.mock.calls[0]
    expect(token).toBe('xoxb-b')
    expect(channel).toBe('C-B')
    expect(fallback).toBe('[Other Co] Abrar created the goal "Q4 Launch"')
  })

  it('says nothing at all for a workspace with no Slack channel', async () => {
    const result = await dispatchSlackNotification({
      workspaceId: 'ws-none',
      eventType: 'goal_created',
      eventId: 'event-5',
      actorId: 'user-1',
    })

    expect(result).toEqual({ success: true, outcome: 'no_channel_configured' })
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  it('resolves the previous assignee for an unassignment', async () => {
    await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'unassigned',
      eventId: 'event-6',
      taskId: 'task-1',
      taskTitle: 'Student CRUD API',
      actorId: 'user-1',
      previousAssigneeId: 'user-2',
    })

    expect(postSlackMessage.mock.calls[0][2]).toBe(
      '[DevAbby] Abrar unassigned "Student CRUD API" from Araysh',
    )
  })

  it('announces work-session login with the actual action, not the generic fallback', async () => {
    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'work_session_start',
      eventId: 'session-event-1',
      entityType: 'work_session',
      actorId: 'user-1',
    })

    expect(result).toEqual({ success: true, outcome: 'delivered' })
    const [, , fallback, blocks] = postSlackMessage.mock.calls[0]
    expect(fallback).toBe('[DevAbby] Abrar logged in for work')
    expect(JSON.stringify(blocks)).toContain('Work Session Started')
    expect(JSON.stringify(blocks)).not.toContain('made a change to something')
    expect(db.deliveries[0].event_type).toBe('work_session_started')
  })

  it('announces work-session logout with the actual action, not the generic fallback', async () => {
    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: ' work_session_end ',
      eventId: 'session-event-2',
      entityType: 'work_session',
      actorId: 'user-1',
    })

    expect(result).toEqual({ success: true, outcome: 'delivered' })
    const [, , fallback, blocks] = postSlackMessage.mock.calls[0]
    expect(fallback).toBe('[DevAbby] Abrar logged out from work')
    expect(JSON.stringify(blocks)).toContain('Work Session Ended')
    expect(JSON.stringify(blocks)).not.toContain('made a change to something')
    expect(db.deliveries[0].event_type).toBe('work_session_ended')
  })

  it('sends the Daily Report that was actually stored, and nothing it made up', async () => {
    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'daily_report_ready',
      eventId: 'report-1',
      entityType: 'daily_report',
      reportId: 'report-1',
    })

    expect(result).toEqual({ success: true, outcome: 'delivered' })
    const [, , fallback, blocks] = postSlackMessage.mock.calls[0]
    const rendered = JSON.stringify(blocks)

    // The narration, word for word, as the card would show it.
    expect(rendered).toContain(
      'Abrar spent 5h 20m focused on the Slack integration and completed 4 tasks',
    )
    expect(rendered).toContain(
      'Two blockers were raised during the period and both were resolved',
    )
    expect(fallback).toContain('Abrar spent 5h 20m focused')
    // ...and the figures the report stores, not a second count of them.
    expect(rendered).toContain('5h 20m focused')
    expect(rendered).toContain('4 tasks completed')
    expect(rendered).not.toContain('5 tasks completed')
    expect(rendered).not.toContain('is ready')
  })

  it('links the button to the exact report it summarised', async () => {
    await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'daily_report_ready',
      eventId: 'report-1',
      reportId: 'report-1',
    })

    expect(JSON.stringify(postSlackMessage.mock.calls[0][3])).toContain(
      'http://localhost:3000/workspaces/devabby?report=report-1',
    )
  })

  // The whole point of the change: the report is generated once. Slack reads
  // the row, and reaches nothing else -- no snapshot RPC, no ontask-llm.
  it('reads the stored report and generates nothing', async () => {
    const fetchSpy = vi.fn()
    const realFetch = globalThis.fetch
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    try {
      await dispatchSlackNotification({
        workspaceId: 'ws-a',
        eventType: 'daily_report_ready',
        eventId: 'report-1',
        reportId: 'report-1',
      })
    } finally {
      globalThis.fetch = realFetch
    }

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(db.writes).not.toContain('workspace_daily_summaries')
    expect(db.summaries[0].narrative).toEqual(storedReport().narrative)
  })

  it('says nothing while a report is still being generated', async () => {
    db.summaries = [storedReport({ generation_status: 'pending' })]

    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'daily_report_ready',
      eventId: 'report-1',
      reportId: 'report-1',
    })

    expect(result).toEqual({ success: true, outcome: 'report_not_ready' })
    expect(postSlackMessage).not.toHaveBeenCalled()
    // And crucially the event id is still unspent, so the message that belongs
    // to this row can still be delivered when it finishes.
    expect(db.deliveries).toHaveLength(0)
  })

  it('still announces a report that was pending a moment ago', async () => {
    db.summaries = [storedReport({ generation_status: 'pending' })]
    const params = {
      workspaceId: 'ws-a',
      eventType: 'daily_report_ready',
      eventId: 'report-1',
      reportId: 'report-1',
    }

    await dispatchSlackNotification(params)
    db.summaries = [storedReport()]
    const result = await dispatchSlackNotification(params)

    expect(result).toEqual({ success: true, outcome: 'delivered' })
    expect(postSlackMessage).toHaveBeenCalledTimes(1)
  })

  it('says nothing about a report that failed', async () => {
    db.summaries = [storedReport({ generation_status: 'failed' })]

    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'daily_report_ready',
      eventId: 'report-1',
      reportId: 'report-1',
    })

    expect(result).toEqual({ success: true, outcome: 'report_not_ready' })
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  // The existing decision, unchanged: a day with nothing on it is still a
  // report in the app and still not a Slack message.
  it('says nothing about a day on which nothing happened', async () => {
    const quiet = storedReport()
    const snapshot = quiet.structured_snapshot as Record<string, unknown>
    quiet.structured_snapshot = {
      ...snapshot,
      total_focused_seconds: 0,
      members: [
        {
          user_id: 'user-1',
          display_name: 'Abrar',
          focused_seconds: 0,
          events: [],
          task_activity: [],
        },
      ],
      workspace_changes: {
        invitations: [],
        members_joined: [],
        members_removed: [],
        tasks_created: 0,
        tasks_completed: 0,
        tasks_skipped: 0,
        tasks_deleted: 0,
      },
    }
    db.summaries = [quiet]

    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'daily_report_ready',
      eventId: 'report-1',
      reportId: 'report-1',
    })

    expect(result).toEqual({ success: true, outcome: 'report_has_no_activity' })
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  // Regenerating rewrites the same row, which keeps the same id -- so the
  // second announcement deduplicates against the first.
  it('does not announce a regenerated report a second time', async () => {
    const params = {
      workspaceId: 'ws-a',
      eventType: 'daily_report_ready',
      eventId: 'report-1',
      reportId: 'report-1',
    }

    const first = await dispatchSlackNotification(params)
    db.summaries = [
      storedReport({
        narrative: {
          overall_summary: 'A regenerated narration of the same day.',
          members: [],
          workspace_changes_summary: '',
          highlights: [],
        },
      }),
    ]
    const second = await dispatchSlackNotification(params)

    expect(first.outcome).toBe('delivered')
    expect(second.outcome).toBe('duplicate_event_skipped')
    expect(postSlackMessage).toHaveBeenCalledTimes(1)
  })

  it('sends the figures alone when a report stored no narration', async () => {
    db.summaries = [storedReport({ narrative: null })]

    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'daily_report_ready',
      eventId: 'report-1',
      reportId: 'report-1',
    })

    expect(result.outcome).toBe('delivered')
    expect(JSON.stringify(postSlackMessage.mock.calls[0][3])).toContain(
      '5h 20m focused',
    )
  })

  it('says nothing when the report it was told about cannot be read', async () => {
    db.summaries = []

    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'daily_report_ready',
      eventId: 'report-1',
      reportId: 'report-1',
    })

    expect(result.outcome).toBe('report_unavailable')
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  it('will not announce another workspace’s report', async () => {
    const result = await dispatchSlackNotification({
      workspaceId: 'ws-b',
      eventType: 'daily_report_ready',
      eventId: 'report-1',
      reportId: 'report-1',
    })

    expect(result.outcome).toBe('report_unavailable')
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  it('marks the connection unhealthy when Slack rejects the token', async () => {
    postSlackMessage.mockResolvedValue({ ok: false, error: 'invalid_auth' })

    const result = await dispatchSlackNotification({
      workspaceId: 'ws-a',
      eventType: 'completed',
      eventId: 'event-10',
      taskId: 'task-1',
      actorId: 'user-1',
    })

    expect(result.success).toBe(false)
    expect(db.updates).toContainEqual({ connection_status: 'invalid_token' })
  })
})
