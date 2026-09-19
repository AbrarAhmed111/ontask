import { beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from './__fixtures__/slackEventPayloads.json'

/**
 * The end of the pipeline, tested from the real beginning of it.
 *
 * Every other test in this folder starts from a payload someone wrote by hand,
 * which is precisely how the bug this file exists for survived: the message
 * builder was correct, the dispatcher was correct, and Slack still said
 * "Abrar Ahmed updated A task in Products & AI Solutions" for goals, files,
 * invitations and goal subtasks, because the PAYLOAD could not say what it was
 * about. A hand-written payload with entityType already filled in would have
 * passed on the day it was broken.
 *
 * So the inputs here are not written at all. They are captured from Postgres
 * (scripts/capture-slack-payloads.mjs runs
 * supabase/tests/0048_slack_entity_resolution.sql against real migrations and
 * reads what slack_payload_for_task_event() produced for rows the real RPCs
 * and triggers wrote), and each one is pushed through the real HTTP route, the
 * real dispatcher and the real builder. What is asserted is the text Slack
 * would actually display.
 *
 * mutation -> task_events row -> trigger payload -> dispatch -> builder -> Slack
 */

const postSlackMessage = vi.fn()
const createServiceRoleClient = vi.fn()

vi.mock('./slackClient', () => ({
  postSlackMessage: (...args: unknown[]) => postSlackMessage(...args),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => createServiceRoleClient(),
}))

const { POST } = await import('@/app/api/integrations/slack/dispatch/route')

type Row = Record<string, unknown>

const WORKSPACE_ID = fixture.events[0].payload.workspaceId
const WORKSPACE_NAME = 'Products & AI Solutions'
const WORKSPACE_SLUG = 'products-ai-solutions'

const deliveries: { workspace_id: string; event_id: string }[] = []
const connection: Row = {
  id: 'conn-1',
  workspace_id: WORKSPACE_ID,
  bot_access_token: 'xoxb-test',
  channel_id: 'C-TEST',
  connection_status: 'connected',
  notification_settings: {},
}

// Only the reads the dispatcher makes, in the order it makes them: the
// idempotency insert, the connection, the workspace, then a profile per id in
// the payload. The profiles are the ones the scenario really had.
function fakeClient() {
  return {
    from(table: string) {
      const filters: Row = {}
      const builder: Record<string, unknown> = {
        insert(row: Row) {
          if (table === 'workspace_slack_deliveries') {
            const clash = deliveries.some(
              d =>
                d.workspace_id === row.workspace_id &&
                d.event_id === row.event_id,
            )
            if (clash) return Promise.resolve({ error: { code: '23505' } })
            deliveries.push(row as (typeof deliveries)[number])
          }
          return Promise.resolve({ error: null })
        },
        update() {
          return { eq: () => Promise.resolve({ error: null }) }
        },
        select() {
          return builder
        },
        eq(column: string, value: unknown) {
          filters[column] = value
          return builder
        },
        single() {
          if (table === 'workspace_slack_connections') {
            return Promise.resolve({ data: connection, error: null })
          }
          if (table === 'workspaces') {
            return Promise.resolve({
              data: { name: WORKSPACE_NAME, slug: WORKSPACE_SLUG },
              error: null,
            })
          }
          const found = fixture.profiles.find(p => p.id === filters.id)
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

interface SlackCall {
  fallbackText: string
  blocks: {
    type: string
    text?: { text?: string }
    elements?: { text?: { text?: string }; url?: string }[]
  }[]
}

/** Puts one captured payload through the route exactly as Postgres would. */
async function deliver(payload: Record<string, unknown>): Promise<SlackCall> {
  postSlackMessage.mockClear()
  postSlackMessage.mockResolvedValue({ ok: true })
  const response = await POST(
    new Request('http://localhost/api/integrations/slack/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  const result = await response.json()
  expect(
    result,
    `dispatch refused the payload: ${result.outcome}`,
  ).toMatchObject({ outcome: 'delivered' })
  const [, , fallbackText, blocks] = postSlackMessage.mock.calls[0]
  return { fallbackText, blocks } as SlackCall
}

const byStep = new Map(
  fixture.events.map(e => [e.step, e.payload as Record<string, unknown>]),
)

/** The captured payload for a step, failing loudly if the scenario changed. */
function payloadFor(step: string): Record<string, unknown> {
  const payload = byStep.get(step)
  if (!payload) {
    throw new Error(
      `the fixture has no "${step}" step -- regenerate it with ` +
        'node scripts/capture-slack-payloads.mjs',
    )
  }
  return payload
}

const headingOf = (call: SlackCall) =>
  call.blocks.find(b => b.type === 'header')?.text?.text ?? ''
const bodyOf = (call: SlackCall) =>
  call.blocks.find(b => b.type === 'section')?.text?.text ?? ''
const buttonOf = (call: SlackCall) =>
  call.blocks.find(b => b.type === 'actions')?.elements?.[0]

beforeEach(() => {
  deliveries.length = 0
  connection.notification_settings = {}
  createServiceRoleClient.mockReturnValue(fakeClient())
})

describe('the Slack pipeline, on payloads a real database produced', () => {
  it('never describes anything as "A task"', async () => {
    for (const { step, payload } of fixture.events) {
      const call = await deliver(payload as Record<string, unknown>)
      expect(
        call.fallbackText,
        `"${step}" fell back to a generic message`,
      ).not.toContain('A task')
      expect(JSON.stringify(call.blocks), `"${step}"`).not.toContain('A task')
    }
  })

  it('never falls through to the generic "made a change" branch', async () => {
    for (const { step, payload } of fixture.events) {
      const call = await deliver(payload as Record<string, unknown>)
      expect(
        headingOf(call),
        `"${step}" hit the unknown-event fallback`,
      ).not.toBe('🔔 OnTask Update')
      expect(bodyOf(call), `"${step}"`).not.toContain('made a change to')
    }
  })

  it('names the workspace on every message', async () => {
    for (const { step, payload } of fixture.events) {
      const call = await deliver(payload as Record<string, unknown>)
      expect(call.fallbackText, `"${step}"`).toContain(WORKSPACE_NAME)
    }
  })

  it('gives every message a link with no missing ids in it', async () => {
    for (const { step, payload } of fixture.events) {
      const call = await deliver(payload as Record<string, unknown>)
      const url = buttonOf(call)?.url ?? ''
      expect(url, `"${step}" has no link`).toContain(
        `/workspaces/${WORKSPACE_SLUG}`,
      )
      expect(url, `"${step}" links to a missing id`).not.toMatch(
        /=(undefined|null|)$/,
      )
    }
  })
})

describe('tasks', () => {
  it('announces a creation with its assignee, as one message', async () => {
    const call = await deliver(payloadFor('task created + assigned'))
    expect(headingOf(call)).toBe('📋 Task Created')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed created "OnTask Integration to Slack" and assigned it to Abrar Ahmed`,
    )
  })

  it('says started, not updated', async () => {
    const call = await deliver(payloadFor('task started'))
    expect(headingOf(call)).toBe('▶️ Task Started')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed started "OnTask Integration to Slack"`,
    )
  })

  it('tells resumed apart from started', async () => {
    const call = await deliver(payloadFor('task resumed'))
    expect(headingOf(call)).toBe('▶️ Task Resumed')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed resumed "OnTask Integration to Slack"`,
    )
  })

  it('says paused', async () => {
    const call = await deliver(payloadFor('task paused'))
    expect(headingOf(call)).toBe('⏸️ Task Paused')
    expect(call.fallbackText).toContain('paused "OnTask Integration to Slack"')
  })

  it('says completed', async () => {
    const call = await deliver(payloadFor('task completed'))
    expect(headingOf(call)).toBe('✅ Task Completed')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed completed "OnTask Integration to Slack"`,
    )
  })

  // The case the spec called out: the previous assignee has to come from the
  // event, because the task row no longer holds it.
  it('names both ends of a reassignment', async () => {
    const call = await deliver(payloadFor('task reassigned'))
    expect(headingOf(call)).toBe('📋 Task Reassigned')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed reassigned "OnTask Integration to Slack" from Abrar Ahmed to Iqra Nadeem`,
    )
  })

  it('announces a deletion from the event alone, and links somewhere real', async () => {
    const call = await deliver(payloadFor('task deleted'))
    expect(headingOf(call)).toBe('🗑️ Task Deleted')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed deleted "Old Integration Task" from ${WORKSPACE_NAME}`,
    )
    // Never a task URL for a task that is gone.
    expect(buttonOf(call)?.url).toBe(
      `http://localhost:3000/workspaces/${WORKSPACE_SLUG}`,
    )
    expect(buttonOf(call)?.text?.text).toBe('Open Workspace')
  })

  it('adds a note without repeating what the note said', async () => {
    const call = await deliver(payloadFor('note added'))
    expect(headingOf(call)).toBe('📝 Note Added')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed added a note to "OnTask Integration to Slack"`,
    )
    expect(JSON.stringify(call.blocks)).not.toContain('Slack app review')
  })
})

describe('the four assignment states, told apart', () => {
  it('assigning an existing task is not a creation', async () => {
    const call = await deliver(payloadFor('task assigned'))
    expect(headingOf(call)).toBe('📋 Task Assigned')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed assigned "OnTask Integration to Slack" to Iqra Nadeem`,
    )
  })

  it('unassigning is not a reassignment to nobody', async () => {
    const call = await deliver(payloadFor('task unassigned'))
    expect(headingOf(call)).toBe('📋 Task Unassigned')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed unassigned "OnTask Integration to Slack" from Iqra Nadeem`,
    )
  })

  // Creating a task with an assignee writes two rows ('created' and
  // 'assigned'), and the trigger returns null for the second so Slack gets one
  // message that does both jobs. That the second row dispatches NOTHING is
  // asserted where it is visible -- in supabase/tests/0047 and 0048, against
  // the database. What is checkable here is the other half: that the one
  // message which does go out names the assignee, rather than leaving the
  // channel to infer it from a message that never arrives.
  it('a creation with an assignee names them in the one message', async () => {
    const created = await deliver(payloadFor('task created + assigned'))
    expect(created.fallbackText).toContain(
      'created "OnTask Integration to Slack" and assigned it to Abrar Ahmed',
    )
    expect(bodyOf(created)).toContain('Assigned to *Abrar Ahmed*')
  })

  it('each of the four reads differently', async () => {
    const steps = [
      'task created + assigned',
      'task assigned',
      'task reassigned',
      'task unassigned',
    ]
    const texts: string[] = []
    for (const step of steps) {
      texts.push((await deliver(payloadFor(step))).fallbackText)
    }
    expect(new Set(texts).size).toBe(4)
  })
})

describe('reopen and skip', () => {
  it('says reopened', async () => {
    const call = await deliver(payloadFor('task reopened'))
    expect(headingOf(call)).toBe('🔄 Task Reopened')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed reopened "OnTask Integration to Slack"`,
    )
  })

  it('says skipped, not completed', async () => {
    const call = await deliver(payloadFor('task skipped'))
    expect(headingOf(call)).toBe('⏭️ Task Skipped')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed skipped "OnTask Integration to Slack"`,
    )
  })
})

// These three worked before this change and had to keep working.
describe('blockers', () => {
  it('names the task, the reason and who raised it', async () => {
    const call = await deliver(payloadFor('blocker created'))
    expect(headingOf(call)).toBe('🚨 Task Blocked')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Task Blocked: "OnTask Integration to Slack"`,
    )
    expect(bodyOf(call)).toContain('blocked by *Abrar Ahmed*')
    expect(bodyOf(call)).toContain('Waiting for Stripe credentials')
    expect(buttonOf(call)?.url).toContain('?task=')
  })

  it('names who was mentioned', async () => {
    const call = await deliver(payloadFor('blocker mention'))
    expect(headingOf(call)).toBe('👋 Mentioned in a Blocker')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed mentioned Iqra Nadeem on "OnTask Integration to Slack"`,
    )
  })

  it('says the blocker was resolved, and by whom', async () => {
    const call = await deliver(payloadFor('blocker resolved'))
    expect(headingOf(call)).toBe('🎉 Blocker Resolved')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Blocker Resolved on "OnTask Integration to Slack"`,
    )
    expect(bodyOf(call)).toContain('resolved by *Abrar Ahmed*')
  })
})

describe('goals, goal tasks and goal subtasks', () => {
  it('names the goal, not a task', async () => {
    const call = await deliver(payloadFor('goal created'))
    expect(headingOf(call)).toBe('🎯 Goal Created')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed created the goal "Launch MVP"`,
    )
    expect(buttonOf(call)?.text?.text).toBe('Open Goal')
    expect(buttonOf(call)?.url).toContain('?goal=')
  })

  it('says a goal was completed', async () => {
    const call = await deliver(payloadFor('goal completed'))
    expect(headingOf(call)).toBe('🏆 Goal Completed')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed completed the goal "Launch MVP"`,
    )
  })

  it('tells archiving apart from deleting', async () => {
    const archived = await deliver(payloadFor('goal archived'))
    expect(headingOf(archived)).toBe('🗄️ Goal Archived')
    expect(archived.fallbackText).toContain('archived the goal "Launch MVP"')

    const deleted = await deliver(payloadFor('goal deleted'))
    expect(headingOf(deleted)).toBe('🗑️ Goal Deleted')
    expect(deleted.fallbackText).toContain('deleted the goal "Launch MVP"')
    // The goal is gone, so the link steps out to the workspace.
    expect(buttonOf(deleted)?.url).toBe(
      `http://localhost:3000/workspaces/${WORKSPACE_SLUG}`,
    )
  })

  it('names the goal a task was added to', async () => {
    const call = await deliver(payloadFor('goal task created'))
    expect(headingOf(call)).toBe('🎯 Goal Task Added')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed added "Build Authentication" to the goal "Launch MVP"`,
    )
    expect(JSON.stringify(call.blocks)).toContain('*Goal:* Launch MVP')
  })

  it('keeps the goal on a goal task that starts', async () => {
    const call = await deliver(payloadFor('goal task started'))
    expect(headingOf(call)).toBe('▶️ Task Started')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed started "Build Authentication" in goal "Launch MVP"`,
    )
  })

  it('keeps the goal on a goal task that completes', async () => {
    const call = await deliver(payloadFor('goal task completed'))
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed completed "Build Authentication" in goal "Launch MVP"`,
    )
  })

  // The whole chain: subtask, its parent task, and the goal both sit under.
  // complete_workspace_task records only a title, so the parent is resolved.
  it('keeps Goal -> Task -> Subtask readable when a subtask completes', async () => {
    const call = await deliver(payloadFor('goal subtask completed'))
    expect(headingOf(call)).toBe('✅ Task Completed')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed completed subtask "Create OAuth callback" under "Build Authentication" in goal "Launch MVP"`,
    )
    expect(bodyOf(call)).toContain('under *Build Authentication*')
  })

  it('names the parent when a subtask is added', async () => {
    const call = await deliver(payloadFor('goal subtask created'))
    expect(headingOf(call)).toBe('🎯 Goal Subtask Added')
    expect(call.fallbackText).toContain('added subtask "Create OAuth callback"')
  })
})

describe('resources', () => {
  it('names the file that was uploaded and links to the list', async () => {
    const call = await deliver(payloadFor('resource uploaded'))
    expect(headingOf(call)).toBe('📎 Resource Added')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed uploaded "Architecture.pdf" to ${WORKSPACE_NAME}`,
    )
    expect(buttonOf(call)?.url).toBe(
      `http://localhost:3000/workspaces/${WORKSPACE_SLUG}#workspace-resources`,
    )
  })

  it('says a resource was updated', async () => {
    const call = await deliver(payloadFor('resource updated'))
    expect(headingOf(call)).toBe('📎 Resource Updated')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed updated resource "Architecture.pdf" in ${WORKSPACE_NAME}`,
    )
  })

  // The name has to come from the event: the row is gone by now.
  it('names a deleted resource', async () => {
    const call = await deliver(payloadFor('resource deleted'))
    expect(headingOf(call)).toBe('📎 Resource Removed')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Abrar Ahmed deleted resource "Architecture.pdf" from ${WORKSPACE_NAME}`,
    )
  })
})

describe('workspace membership', () => {
  it('names the invitee by the address on the invitation', async () => {
    const call = await deliver(payloadFor('member invited'))
    expect(headingOf(call)).toBe('👋 Workspace Invitation')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Workspace Owner invited newcomer@example.com to the ${WORKSPACE_NAME} workspace`,
    )
    expect(buttonOf(call)?.url).toBe(
      `http://localhost:3000/workspaces/${WORKSPACE_SLUG}/members`,
    )
  })

  it('attributes a join to the person who joined', async () => {
    const call = await deliver(payloadFor('member joined'))
    expect(headingOf(call)).toBe('👋 New Workspace Member')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Iqra Nadeem joined the ${WORKSPACE_NAME} workspace`,
    )
  })

  // The membership row is deleted, so the name is the event's own snapshot.
  it('names a removed member and who removed them', async () => {
    const call = await deliver(payloadFor('member removed'))
    expect(headingOf(call)).toBe('👤 Member Removed')
    expect(call.fallbackText).toBe(
      `[${WORKSPACE_NAME}] Workspace Owner removed Iqra Nadeem from the ${WORKSPACE_NAME} workspace`,
    )
  })
})

describe('the Daily Report', () => {
  it('points at the report that was actually generated, and summarises nothing', async () => {
    const payload = payloadFor('daily report ready')
    const call = await deliver(payload)
    expect(call.fallbackText).toBe(`[${WORKSPACE_NAME}] Daily Report is ready`)
    expect(buttonOf(call)?.text?.text).toBe('View Daily Report')
    expect(buttonOf(call)?.url).toBe(
      `http://localhost:3000/workspaces/${WORKSPACE_SLUG}?report=${payload.reportId}`,
    )
    // The report is the authoritative document; this is a pointer to it.
    expect(JSON.stringify(call.blocks)).not.toContain('A good day')
  })

  it('sends once, however often the scheduler runs', async () => {
    const payload = payloadFor('daily report ready')
    await deliver(payload)
    expect(postSlackMessage).toHaveBeenCalledTimes(1)

    postSlackMessage.mockClear()
    const again = await POST(
      new Request('http://localhost/api/integrations/slack/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    )
    expect(await again.json()).toMatchObject({
      outcome: 'duplicate_event_skipped',
    })
    expect(postSlackMessage).not.toHaveBeenCalled()
  })
})

describe('preferences and duplicate delivery, on the same real payloads', () => {
  it('sends each event once, however many times Postgres posts it', async () => {
    const payload = payloadFor('task started')
    await deliver(payload)
    expect(postSlackMessage).toHaveBeenCalledTimes(1)

    postSlackMessage.mockClear()
    const again = await POST(
      new Request('http://localhost/api/integrations/slack/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    )
    expect(await again.json()).toMatchObject({
      outcome: 'duplicate_event_skipped',
    })
    expect(postSlackMessage).not.toHaveBeenCalled()
  })

  it('honours the switch that governs each event', async () => {
    const cases: [string, string][] = [
      ['task started', 'started'],
      ['task completed', 'completed'],
      ['task deleted', 'deleted'],
      ['goal created', 'goals'],
      ['resource uploaded', 'resources'],
      ['member invited', 'members'],
      ['note added', 'notes'],
      ['task reassigned', 'assigned'],
      ['daily report ready', 'daily_reports'],
      ['blocker created', 'blockers'],
      ['blocker resolved', 'resolutions'],
      ['blocker mention', 'mentions'],
    ]

    for (const [step, key] of cases) {
      deliveries.length = 0
      connection.notification_settings = { [key]: false }
      postSlackMessage.mockClear()
      postSlackMessage.mockResolvedValue({ ok: true })

      const response = await POST(
        new Request('http://localhost/api/integrations/slack/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadFor(step)),
        }),
      )
      expect(
        await response.json(),
        `"${step}" ignored the "${key}" switch`,
      ).toMatchObject({ outcome: 'notification_type_disabled' })
      expect(postSlackMessage).not.toHaveBeenCalled()
    }
  })

  it('leaves the other switches alone', async () => {
    connection.notification_settings = { goals: false }
    const call = await deliver(payloadFor('task started'))
    expect(headingOf(call)).toBe('▶️ Task Started')
  })
})
