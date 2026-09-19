/**
 * Asynchronous Slack Event Dispatcher for OnTask.
 * Fetches workspace connection settings, builds Block Kit messages, and posts to Slack safely.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { postSlackMessage } from './slackClient'
import { buildSlackEventMessage } from './slackMessageBuilder'
import { isSlackEventEnabled } from './slackEventCategories'
import { decideDailyReportForSlack } from '@/lib/dailyReportDigest'
import type { DailyReportDigest } from '@/lib/dailyReportDigest'
import type { SlackEntityType } from './slackMessageBuilder'

export interface DispatchSlackEventParams {
  workspaceId: string
  eventType: string
  eventId?: string
  /** What the event is about, decided by the database (migration 0048) so
   *  this layer never has to guess from which fields arrived filled in. */
  entityType?: SlackEntityType
  entityId?: string
  taskId?: string
  taskTitle?: string
  parentTitle?: string
  goalId?: string
  goalName?: string
  /** A goal's name, a file's name, a member's name — whatever the event is
   *  about when it is not about a task. */
  entityName?: string
  actorId?: string
  recipientUserId?: string
  previousAssigneeId?: string
  selfRemoved?: boolean
  blockerReason?: string
  reportId?: string
}

type DailyReportGate =
  | { send: true; digest: DailyReportDigest }
  | { send: false; outcome: string; success: boolean }

/**
 * Reads the Daily Report this event is about, straight out of the row the
 * generator wrote, and decides whether it is one to announce.
 *
 * This is the only place the Slack path touches report content, and it only
 * ever reads: the report was generated once, by the scheduler
 * (src/app/api/cron/daily-reports) or by an explicit regeneration, and Slack
 * repeats what that produced. No snapshot is aggregated here and ontask-llm is
 * never called — a second narration of the same day would be a different report
 * from the one the app shows.
 */
async function loadDailyReport(
  supabase: ReturnType<typeof createServiceRoleClient>,
  workspaceId: string,
  reportId: string | undefined,
): Promise<DailyReportGate> {
  if (!reportId) {
    // Every database from migration 0045 onwards sends reportId. Without one
    // there is no report to read and nothing truthful to say.
    return { send: false, outcome: 'report_not_identified', success: false }
  }

  const { data, error } = await supabase
    .from('workspace_daily_summaries')
    .select('generation_status, narrative, structured_snapshot')
    .eq('id', reportId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error || !data) {
    console.error(
      `[Slack Dispatcher] Daily Report ${reportId} could not be read:`,
      error,
    )
    return { send: false, outcome: 'report_unavailable', success: false }
  }

  const decision = decideDailyReportForSlack({
    generationStatus: data.generation_status,
    narrative: data.narrative,
    structuredSnapshot: data.structured_snapshot,
  })
  if (decision.send) return { send: true, digest: decision.digest }

  // Not failures: a report still generating, one that failed, and a day with
  // nothing on it are all reports Slack is meant to stay quiet about.
  const outcome =
    decision.reason === 'not_completed'
      ? 'report_not_ready'
      : decision.reason === 'no_activity'
        ? 'report_has_no_activity'
        : 'report_unreadable'
  return {
    send: false,
    outcome,
    success: decision.reason !== 'unreadable',
  }
}

export async function dispatchSlackNotification(
  params: DispatchSlackEventParams,
): Promise<{ success: boolean; outcome: string; error?: string }> {
  try {
    const {
      workspaceId,
      eventType,
      eventId,
      entityType,
      entityId,
      taskId,
      taskTitle,
      parentTitle,
      goalId,
      goalName,
      entityName,
      actorId,
      recipientUserId,
      previousAssigneeId,
      selfRemoved,
      blockerReason,
      reportId,
    } = params

    if (!workspaceId || !eventType) {
      return { success: false, outcome: 'invalid_params' }
    }

    const supabase = createServiceRoleClient()
    if (typeof supabase?.from !== 'function') {
      return { success: false, outcome: 'client_not_supported' }
    }

    // 1. A Daily Report is read BEFORE the event id is claimed below. The id a
    //    report event carries is the summary row's own id, so claiming it for a
    //    report that turns out to be pending would make the real message — the
    //    one sent when that same row finishes — look like a duplicate and drop
    //    it. Deciding first means only a report that is actually announced ever
    //    spends its id.
    let reportDigest: DailyReportDigest | undefined
    if (eventType === 'daily_report_ready') {
      const gate = await loadDailyReport(supabase, workspaceId, reportId)
      if (!gate.send) {
        return { success: gate.success, outcome: gate.outcome }
      }
      reportDigest = gate.digest
    }

    // 2. Idempotency Check (Phase 11): Prevent duplicate notifications for same event_id
    if (eventId) {
      const { error: idempotencyError } = await supabase
        .from('workspace_slack_deliveries')
        .insert({
          workspace_id: workspaceId,
          event_id: eventId,
          event_type: eventType,
        })

      if (idempotencyError && idempotencyError.code === '23505') {
        // Unique violation (already delivered)
        return { success: true, outcome: 'duplicate_event_skipped' }
      }
    }

    // 3. Fetch Slack connection for workspace
    const { data: connection, error: connError } = await supabase
      .from('workspace_slack_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single()

    if (
      connError ||
      !connection ||
      !connection.bot_access_token ||
      !connection.channel_id
    ) {
      return { success: true, outcome: 'no_channel_configured' }
    }

    // 4. Check notification preferences
    if (!isSlackEventEnabled(connection.notification_settings, eventType)) {
      return { success: true, outcome: 'notification_type_disabled' }
    }

    // 5. Fetch workspace slug & name
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name, slug')
      .eq('id', workspaceId)
      .single()

    if (!workspace) {
      return { success: false, outcome: 'workspace_not_found' }
    }

    // 6. Fetch display names for actor, recipient and (for an unassignment,
    //    which has no recipient at all) whoever the task was taken from.
    const displayName = async (userId: string): Promise<string | undefined> => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', userId)
        .single()
      if (!profile) return undefined
      return profile.full_name || profile.email?.split('@')[0] || undefined
    }

    const actorName =
      (actorId ? await displayName(actorId) : undefined) ?? 'Someone'
    const recipientName = recipientUserId
      ? await displayName(recipientUserId)
      : undefined
    const previousAssigneeName = previousAssigneeId
      ? await displayName(previousAssigneeId)
      : undefined

    // 7. Build message payload
    const messagePayload = buildSlackEventMessage({
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      eventType,
      entityType,
      entityId,
      taskTitle,
      taskId,
      parentTitle,
      goalId,
      goalName,
      entityName,
      actorName,
      recipientName,
      previousAssigneeName,
      selfRemoved,
      blockerReason,
      reportId,
      report: reportDigest,
    })

    // 8. Post message to Slack
    const postResult = await postSlackMessage(
      connection.bot_access_token,
      connection.channel_id,
      messagePayload.fallbackText,
      messagePayload.blocks,
    )

    if (!postResult.ok) {
      console.error(
        '[Slack Dispatcher] Slack postMessage failed:',
        postResult.error,
      )
      const errCode = postResult.error || ''

      // Phase 14: Update integration health state based on API error code
      if (
        ['token_revoked', 'account_inactive', 'invalid_auth'].includes(errCode)
      ) {
        await supabase
          .from('workspace_slack_connections')
          .update({ connection_status: 'invalid_token' })
          .eq('id', connection.id)
      } else if (
        ['channel_not_found', 'is_archived', 'not_in_channel'].includes(errCode)
      ) {
        await supabase
          .from('workspace_slack_connections')
          .update({ connection_status: 'channel_missing' })
          .eq('id', connection.id)
      }

      return {
        success: false,
        outcome: 'slack_api_error',
        error: postResult.error,
      }
    }

    // Clear any previous error status on successful delivery
    if (connection.connection_status !== 'connected') {
      await supabase
        .from('workspace_slack_connections')
        .update({ connection_status: 'connected' })
        .eq('id', connection.id)
    }

    return { success: true, outcome: 'delivered' }
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : 'Unknown dispatcher error'
    console.error('[Slack Dispatcher] Exception caught while dispatching:', err)
    return { success: false, outcome: 'exception', error: errorMsg }
  }
}
