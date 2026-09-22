import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDailyReportNarrative } from '@/lib/dailyReportGeneration'
import { WorkspaceStructuredSnapshot } from '@/types/workspace'

// Manual "Regenerate" -- strictly secondary to the automatic scheduler
// (src/app/api/cron/daily-reports/route.ts), which owns creating a workspace's
// Daily Report in the first place. This route can only ever refresh a report
// that already exists for a given (workspaceId, reportEnd) occurrence -- it
// never creates a brand-new reporting window, so report_start/report_end/
// report_timezone are always read back from the existing row (never trusted
// from the client) and passed through unchanged to
// regenerate_workspace_daily_report, which preserves them plus the report's
// original generation_type/generated_by.
//
// It also honours the workspace's Daily Reports switch: with reports turned off
// there is nothing to regenerate (the section is hidden), so a direct call is
// refused up front -- before the snapshot is aggregated or an AI call is made.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const workspaceId = body?.workspaceId
  const reportEnd = body?.reportEnd

  if (typeof workspaceId !== 'string' || !workspaceId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })
  }
  if (typeof reportEnd !== 'string' || Number.isNaN(Date.parse(reportEnd))) {
    return NextResponse.json(
      { error: 'Missing or invalid reportEnd' },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('daily_reports_enabled')
    .eq('id', workspaceId)
    .maybeSingle()
  if (workspaceError) {
    return NextResponse.json(
      { error: 'Failed to load the workspace' },
      { status: 500 },
    )
  }
  if (!workspace) {
    return NextResponse.json(
      { error: 'Not a member of this workspace' },
      { status: 403 },
    )
  }
  // `=== false`, not falsy: a database that hasn't got migration 0042 yet has
  // no such column, and reports were always on before it.
  if (workspace.daily_reports_enabled === false) {
    return NextResponse.json(
      { error: 'Daily Reports are turned off for this workspace' },
      { status: 409 },
    )
  }

  const { data: existing, error: existingError } = await supabase
    .from('workspace_daily_summaries')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('report_end', reportEnd)
    .maybeSingle()
  if (existingError) {
    return NextResponse.json(
      { error: 'Failed to load the existing report' },
      { status: 500 },
    )
  }
  if (!existing) {
    return NextResponse.json(
      { error: 'No report exists yet for this window to regenerate' },
      { status: 404 },
    )
  }

  const { data: snapshot, error: snapshotError } = await supabase.rpc(
    'generate_workspace_daily_snapshot',
    {
      p_workspace_id: workspaceId,
      p_report_start: existing.report_start,
      p_report_end: existing.report_end,
      p_timezone: existing.report_timezone,
    },
  )
  if (snapshotError || !snapshot) {
    const notMember = snapshotError?.message?.includes('not a member')
    return NextResponse.json(
      {
        error: notMember
          ? 'Not a member of this workspace'
          : 'Failed to aggregate activity for this window',
      },
      { status: notMember ? 403 : 500 },
    )
  }

  const serviceUrl = process.env.ONTASK_LLM_SERVICE_URL
  if (!serviceUrl) {
    console.error('ONTASK_LLM_SERVICE_URL is not configured')
    return NextResponse.json(
      { error: 'AI summary service is not configured' },
      { status: 500 },
    )
  }

  let generated: Awaited<ReturnType<typeof generateDailyReportNarrative>>
  try {
    generated = await generateDailyReportNarrative({
      snapshot: snapshot as WorkspaceStructuredSnapshot,
      serviceUrl,
      timeoutMs: 45_000,
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'AI narrative generation failed'
    console.error(
      `[workspace-summaries] AI narrative generation failed ` +
        `workspace_id=${workspaceId} report_end=${reportEnd}: ${message}`,
    )
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const { narrative, meta } = generated

  const { data: saved, error: regenerateError } = await supabase.rpc(
    'regenerate_workspace_daily_report',
    {
      p_workspace_id: workspaceId,
      p_report_end: reportEnd,
      p_structured_snapshot: snapshot,
      p_narrative: narrative,
      p_meta: meta,
    },
  )
  if (regenerateError || !saved) {
    return NextResponse.json(
      {
        error:
          regenerateError?.message || 'Failed to save the regenerated report',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ summary: saved })
}
