/**
 * Which notification setting governs which Slack event.
 *
 * Three vocabularies meet here and none of them are the same words:
 *
 *   task_events.event_type   what the database actually records
 *                            ('task_blocker_added', 'resource_uploaded')
 *   Slack event type         what dispatch_slack_from_task_event() sends
 *                            ('blocker_created', 'resource_added')
 *   preference key           what a workspace toggles in Settings
 *                            ('blockers', 'resources')
 *
 * The first mapping lives in the trigger (it is the only place that can see a
 * real row); the second lives here, apart from the dispatcher, so the settings
 * card and the dispatcher cannot drift into disagreeing about a key -- which
 * is a failure that looks exactly like "Slack is broken" and leaves no trace
 * anywhere.
 */

export const SLACK_PREFERENCE_KEYS = [
  'created',
  'assigned',
  'started',
  'completed',
  'deleted',
  'notes',
  'goals',
  'blockers',
  'resolutions',
  'mentions',
  'resources',
  'members',
  'work_sessions',
  'daily_reports',
] as const

export type SlackPreferenceKey = (typeof SLACK_PREFERENCE_KEYS)[number]

export type SlackNotificationSettings = Partial<
  Record<SlackPreferenceKey, boolean>
>

// One group per kind of work, not one per event: a workspace that wants to
// hear about blockers wants all of them, and a twelve-switch panel is already
// at the edge of what anyone will read.
const CATEGORY_BY_EVENT: Record<string, SlackPreferenceKey> = {
  task_created: 'created',
  goal_task_created: 'created',
  goal_subtask_created: 'created',

  assigned: 'assigned',
  reassigned: 'assigned',
  unassigned: 'assigned',

  started: 'started',
  resumed: 'started',
  paused: 'started',

  completed: 'completed',
  skipped: 'completed',
  reopened: 'completed',

  // Its own switch rather than a corner of 'created': a workspace that wants
  // to hear about work starting does not necessarily want to hear about work
  // disappearing, and deletion is the one task event nobody can go back and
  // check for themselves afterwards.
  task_deleted: 'deleted',

  note_added: 'notes',

  goal_created: 'goals',
  goal_completed: 'goals',
  goal_archived: 'goals',
  goal_deleted: 'goals',

  blocker_created: 'blockers',
  blocker_resolved: 'resolutions',
  task_unblocked: 'resolutions',
  mentioned: 'mentions',

  resource_added: 'resources',
  resource_updated: 'resources',
  resource_deleted: 'resources',

  member_invited: 'members',
  member_joined: 'members',
  member_removed: 'members',

  work_session_started: 'work_sessions',
  work_session_ended: 'work_sessions',

  daily_report_ready: 'daily_reports',
}

export function slackPreferenceKeyFor(
  eventType: string,
): SlackPreferenceKey | null {
  return CATEGORY_BY_EVENT[eventType] ?? null
}

// An unknown event type is allowed through rather than silently dropped: the
// trigger is the whitelist, and a new event that reached this far is a mapping
// this file has not caught up with, not something a workspace asked not to
// see. Silently discarding it is the exact failure 0046 had to debug.
export function isSlackEventEnabled(
  settings: SlackNotificationSettings | null | undefined,
  eventType: string,
): boolean {
  const key = slackPreferenceKeyFor(eventType)
  if (!key) return true
  return settings?.[key] !== false
}
