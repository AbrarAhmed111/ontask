import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVO, snapshot } from '@/lib/dailyReportTestData'

// The scheduler's entry point. Whether a workspace is due at all (Daily Reports
// on, and a window that ends after they were last switched on) is decided in the
// database -- see supabase/tests/0042_daily_reports_setting.sql. What is checked
// here is what the route does with that answer: a workspace that is not due, or
// whose claim is refused because it was switched off since, costs no snapshot and
// no AI call.

const createServiceRoleClient = vi.fn()
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => createServiceRoleClient(),
}))

import { POST } from './route'

const DUE = {
  workspace_id: 'ws-1',
  workspace_name: 'Personal Workspace',
  timezone: 'UTC',
  report_start: '2026-09-18T12:00:00Z',
  report_end: '2026-09-19T12:00:00Z',
}

function fakeSupabase({
  due = [DUE],
  claimed = { id: 'claimed' } as unknown,
}: { due?: unknown[]; claimed?: unknown } = {}) {
  const rpc = vi.fn<
    (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{
      data: unknown
      error: null
    }>
  >(async name => {
    switch (name) {
      case 'list_workspaces_due_for_daily_report':
        return { data: due, error: null }
      case 'claim_daily_report':
        return { data: claimed, error: null }
      case 'generate_workspace_daily_snapshot':
        return { data: snapshot(), error: null }
      default:
        return { data: null, error: null }
    }
  })
  return { rpc }
}

const request = (secret: string | null = 'sekret') =>
  new Request('http://localhost/api/cron/daily-reports', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  })

const called = (rpc: ReturnType<typeof fakeSupabase>['rpc'], name: string) =>
  rpc.mock.calls.filter(([n]) => n === name)

describe('POST /api/cron/daily-reports', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            narrative: {
              members: [
                {
                  user_id: 'user-abrar',
                  narrative: `Abrar completed "${EVO}".`,
                },
              ],
              summary: `Abrar completed "${EVO}".`,
              overall_summary: '',
              workspace_changes_summary: '',
              highlights: [],
            },
            meta: { used_fallback_template: false, validation_warnings: [] },
          }),
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('CRON_SECRET', 'sekret')
    vi.stubEnv('ONTASK_LLM_SERVICE_URL', 'http://llm.test')
    createServiceRoleClient.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('rejects a caller without the shared secret', async () => {
    createServiceRoleClient.mockReturnValue(fakeSupabase())
    expect((await POST(request(null))).status).toBe(401)
    expect((await POST(request('wrong'))).status).toBe(401)
  })

  it('does nothing when no workspace is due -- which is what a switched-off workspace looks like', async () => {
    const supabase = fakeSupabase({ due: [] })
    createServiceRoleClient.mockReturnValue(supabase)

    const response = await POST(request())

    expect(await response.json()).toEqual({
      due: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
    })
    expect(called(supabase.rpc, 'claim_daily_report')).toHaveLength(0)
    expect(
      called(supabase.rpc, 'generate_workspace_daily_snapshot'),
    ).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips a workspace whose claim is refused because it was switched off since -- no snapshot, no AI call', async () => {
    const supabase = fakeSupabase({ claimed: null })
    createServiceRoleClient.mockReturnValue(supabase)

    const body = await (await POST(request())).json()

    expect(body).toMatchObject({ due: 1, completed: 0, skipped: 1 })
    expect(
      called(supabase.rpc, 'generate_workspace_daily_snapshot'),
    ).toHaveLength(0)
    expect(called(supabase.rpc, 'finish_daily_report')).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('generates and saves a report for a due, claimed workspace', async () => {
    const supabase = fakeSupabase()
    createServiceRoleClient.mockReturnValue(supabase)

    const body = await (await POST(request())).json()

    expect(body).toMatchObject({ due: 1, completed: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // the LLM receives work context, not the raw activity snapshot
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(sent.work_context.workspace.type).toBe('personal')
    expect(sent.work_context.members[0].tasks_worked_on).toHaveLength(2)
    expect(sent.work_context.members[0].completed_work[0].title).toBe(EVO)
    expect(called(supabase.rpc, 'finish_daily_report')).toHaveLength(1)
  })

  it('sends the Daily Updates to the AI inside the SAME single call, and stores the AI report', async () => {
    const withUpdates = {
      ...snapshot(),
      daily_updates: [
        {
          user_id: 'user-abrar',
          display_name: 'Abrar Ahmed',
          report_date: '2026-09-19',
          submitted_at: '2026-09-19T09:42:00Z',
          edited_at: null,
          items: [
            {
              type: 'done',
              content: 'Finished the Slack integration',
              task_id: 'task-slack',
              task_title: 'Slack Integration',
              parent_title: null,
              goal_name: null,
              task_status: 'completed',
              mentioned: [],
            },
            {
              type: 'blocker',
              content: 'Waiting for production credentials',
              task_id: 'task-pay',
              task_title: 'Payment Integration',
              parent_title: null,
              goal_name: null,
              task_status: 'queued',
              mentioned: [
                { user_id: 'user-iqra', display_name: 'Iqra Nadeem' },
              ],
            },
            {
              type: 'next',
              content: 'Test Slack notifications',
              task_id: 'task-test',
              task_title: 'Slack Notification Testing',
              parent_title: null,
              goal_name: null,
              task_status: 'queued',
              mentioned: [],
            },
          ],
        },
      ],
    }
    const supabase = fakeSupabase()
    const original = supabase.rpc.getMockImplementation()!
    supabase.rpc.mockImplementation(async (name, args) =>
      name === 'generate_workspace_daily_snapshot'
        ? { data: withUpdates, error: null }
        : original(name, args),
    )
    createServiceRoleClient.mockReturnValue(supabase)

    await POST(request())

    // ONE model call for the report -- none for the Daily Updates
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    // the meaningful work evidence and the members' updates travel together
    expect(sent.work_context.members.length).toBeGreaterThan(0)
    expect(
      sent.work_context.members[0].daily_updates.done.map(
        (item: { content: string }) => item.content,
      ),
    ).toContain('Finished the Slack integration')
    expect(
      sent.work_context.members[0].daily_updates.blockers[0].task_title,
    ).toBe('Payment Integration')
    // the stored report is that one call's result, saved once
    const finished = called(supabase.rpc, 'finish_daily_report')
    expect(finished).toHaveLength(1)
    const args = finished[0][1] as unknown as {
      p_narrative: {
        members: { narrative: string }[]
        summary: string
      }
      p_structured_snapshot: { daily_updates: unknown[] }
    }
    expect(args.p_narrative.members[0].narrative).toContain(EVO)
    expect(args.p_narrative.summary).toContain(EVO)
    // and the snapshot kept beside it is the recorded one plus what was reported
    expect(args.p_structured_snapshot.daily_updates).toHaveLength(1)
  })

  it('does not touch Slack itself: the stored report is the only thing that reaches it', async () => {
    const supabase = fakeSupabase()
    createServiceRoleClient.mockReturnValue(supabase)

    await POST(request())

    // No other network call is made for the report -- Slack is fed by the
    // database trigger on the stored summary (0045), not from here.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://llm.test/api/summary/generate',
    )
    for (const [name] of supabase.rpc.mock.calls) {
      expect(name).not.toMatch(/daily_update|slack/i)
    }
  })

  it('still finishes the report from the deterministic facts when the AI is unreachable', async () => {
    const supabase = fakeSupabase()
    createServiceRoleClient.mockReturnValue(supabase)
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const body = await (await POST(request())).json()

    expect(body).toMatchObject({ completed: 1, failed: 0 })
    const args = called(
      supabase.rpc,
      'finish_daily_report',
    )[0][1] as unknown as {
      p_narrative: { overall_summary: string }
      p_meta: { used_fallback_template: boolean }
    }
    expect(args.p_meta.used_fallback_template).toBe(true)
    expect(args.p_narrative.overall_summary).toContain(`"${EVO}"`)
    expect(args.p_narrative.overall_summary).not.toMatch(/\ba task\b/)
  })
})
