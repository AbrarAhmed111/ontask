import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVO, snapshot } from '@/lib/dailyReportTestData'

// Manual "Regenerate". With Daily Reports switched off there is nothing to
// regenerate (the section is hidden), so a direct call must be refused up front --
// before a snapshot is aggregated and before any AI call is made.

const createClient = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))

import { POST } from './route'

type Fixture = {
  workspace: { daily_reports_enabled?: boolean } | null
  existing?: Record<string, unknown> | null
}

function fakeSupabase({ workspace, existing }: Fixture) {
  const stored = existing ?? {
    report_start: '2026-09-18T12:00:00Z',
    report_end: '2026-09-19T12:00:00Z',
    report_timezone: 'UTC',
  }
  const from = vi.fn((table: string) => {
    const result = {
      data: table === 'workspaces' ? workspace : stored,
      error: null,
    }
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = async () => result
    return chain
  })
  const rpc = vi.fn<
    (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{
      data: unknown
      error: null
    }>
  >(async name =>
    name === 'generate_workspace_daily_snapshot'
      ? { data: snapshot(), error: null }
      : { data: { id: 'saved-report' }, error: null },
  )
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from,
    rpc,
  }
}

const request = () =>
  new Request('http://localhost/api/workspace-summaries/generate', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: 'ws-1',
      reportEnd: '2026-09-19T12:00:00Z',
    }),
  })

const llmResponse = () =>
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
  )

describe('POST /api/workspace-summaries/generate', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => llmResponse())
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('ONTASK_LLM_SERVICE_URL', 'http://llm.test')
    createClient.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('refuses when Daily Reports are turned off, without aggregating anything or calling the AI', async () => {
    const supabase = fakeSupabase({
      workspace: { daily_reports_enabled: false },
    })
    createClient.mockResolvedValue(supabase)

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/turned off/i)
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('regenerates from the snapshot the database built -- Daily Updates included -- with one AI call', async () => {
    const supabase = fakeSupabase({
      workspace: { daily_reports_enabled: true },
    })
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
    const original = supabase.rpc.getMockImplementation()!
    supabase.rpc.mockImplementation(async (name, args) =>
      name === 'generate_workspace_daily_snapshot'
        ? { data: withUpdates, error: null }
        : original(name, args),
    )
    createClient.mockResolvedValue(supabase)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1) // no extra call for the Daily Updates
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(sent.work_context.members[0].daily_updates.next[0].task_title).toBe(
      'Slack Notification Testing',
    )
    const saved = supabase.rpc.mock.calls.find(
      ([name]) => name === 'regenerate_workspace_daily_report',
    )!
    expect(
      (saved[1] as { p_structured_snapshot: { daily_updates: unknown[] } })
        .p_structured_snapshot.daily_updates,
    ).toHaveLength(1)
  })

  it('regenerates as before when Daily Reports are on', async () => {
    const supabase = fakeSupabase({
      workspace: { daily_reports_enabled: true },
    })
    createClient.mockResolvedValue(supabase)

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const saved = supabase.rpc.mock.calls.find(
      ([name]) => name === 'regenerate_workspace_daily_report',
    )
    expect(saved).toBeDefined()
  })

  it('treats a database without the setting yet as on, as reports always were', async () => {
    createClient.mockResolvedValue(fakeSupabase({ workspace: {} }))
    expect((await POST(request())).status).toBe(200)
  })

  it('does not reveal a workspace the caller cannot see', async () => {
    createClient.mockResolvedValue(fakeSupabase({ workspace: null }))
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to a deterministic narrative built from the real facts when the AI is unreachable', async () => {
    const supabase = fakeSupabase({
      workspace: { daily_reports_enabled: true },
    })
    createClient.mockResolvedValue(supabase)
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect((await POST(request())).status).toBe(200)

    const call = supabase.rpc.mock.calls.find(
      ([name]) => name === 'regenerate_workspace_daily_report',
    )
    const args = call?.[1] as unknown as {
      p_narrative: { overall_summary: string }
      p_meta: { used_fallback_template: boolean }
    }
    expect(args.p_meta.used_fallback_template).toBe(true)
    expect(args.p_narrative.overall_summary).toContain(`"${EVO}"`)
    expect(args.p_narrative.overall_summary).not.toMatch(/\ba task\b/)
  })
})
