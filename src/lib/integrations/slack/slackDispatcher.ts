/**
 * Asynchronous Slack Event Dispatcher for OnTask.
 * Fetches workspace connection settings, builds Block Kit messages, and posts to Slack safely.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { postSlackMessage } from './slackClient'
import { buildSlackEventMessage } from './slackMessageBuilder'
import { isSlackEventEnabled } from './slackEventCategories'
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

    // 1. Idempotency Check (Phase 11): Prevent duplicate notifications for same event_id
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

    // 2. Fetch Slack connection for workspace
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

    // 3. Check notification preferences
    if (!isSlackEventEnabled(connection.notification_settings, eventType)) {
      return { success: true, outcome: 'notification_type_disabled' }
    }

    // 4. Fetch workspace slug & name
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name, slug')
      .eq('id', workspaceId)
      .single()

    if (!workspace) {
      return { success: false, outcome: 'workspace_not_found' }
    }

    // 5. Fetch display names for actor, recipient and (for an unassignment,
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

    // 6. Build message payload
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
    })

    // 7. Post message to Slack
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
