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
  deliveries: { workspace_id: string; event_id: string; event_type: string }[]
  updates: Row[]
}

function fakeClient(db: FakeDb) {
  return {
    from(table: string) {
      const filters: Row = {}
      const builder: Record<string, unknown> = {
        insert(row: Row) {
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
          const source =
            table === 'workspace_slack_connections'
              ? db.connections
              : table === 'workspaces'
                ? db.workspaces
                : db.profiles
          const found = source.find(candidate =>
            Object.entries(filters).every(
              ([key, value]) => candidate[key] === value,
            ),
          )
          return Promise.resolve(
            found
              ? { data: found, error: null }
              : { data: null, error: { code: 'PGRST116' } },
          )
        },
      }
      return builder
    },
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
    ],
    deliveries: [],
    updates: [],
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
