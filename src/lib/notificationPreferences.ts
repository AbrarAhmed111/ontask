// A user's own notification preferences
// (supabase/migrations/20260926210000_notification_preferences.sql). One row
// per preference the user has changed; no row means on. Which notification
// types each key governs is decided in SQL (notification_preference_key) --
// a type with no key is required and can't be turned off.

export type NotificationPreferenceKey =
  | 'event_personal_reminders'
  | 'event_workspace_reminders'
  | 'event_changes'
  | 'event_cancellations'
  | 'task_assigned'
  | 'task_status'
  | 'task_notes'
  | 'development_branch'
  | 'development_pr_opened'
  | 'development_pr_merged'
  | 'development_attention'
  | 'mentions'
  | 'blockers_resolved'
  | 'goals'
  | 'members'
  | 'daily_reports'
  | 'browser'

export type NotificationPreferences = Partial<
  Record<NotificationPreferenceKey, boolean>
>

export type PreferenceItem = {
  key: NotificationPreferenceKey
  title: string
  description: string
}

// Only categories OnTask actually sends. The wording says what arrives, not
// which internal type it is.
export const NOTIFICATION_PREFERENCE_GROUPS: {
  title: string
  items: PreferenceItem[]
}[] = [
  {
    title: 'Events',
    items: [
      {
        key: 'event_personal_reminders',
        title: 'Personal event reminders',
        description: 'Before your own personal events start.',
      },
      {
        key: 'event_workspace_reminders',
        title: 'Workspace event reminders',
        description: 'Before workspace events you’re part of start.',
      },
      {
        key: 'event_changes',
        title: 'Event changes',
        description:
          'When a workspace event moves, or you’re added to or taken off one.',
      },
      {
        key: 'event_cancellations',
        title: 'Event cancellations',
        description: 'When a workspace event you’re part of is cancelled.',
      },
    ],
  },
  {
    title: 'Tasks',
    items: [
      {
        key: 'task_assigned',
        title: 'Task assigned to me',
        description: 'When a task is assigned or reassigned to you.',
      },
      {
        key: 'task_status',
        title: 'Task status changes',
        description:
          'When your tasks are completed, reopened or unblocked, or your timer is stopped.',
      },
      {
        key: 'task_notes',
        title: 'Task notes',
        description: 'When someone adds a note to your task.',
      },
    ],
  },
  {
    title: 'Development',
    items: [
      {
        key: 'development_branch',
        title: 'Branch detected',
        description: 'When GitHub shows work started on your Development Task.',
      },
      {
        key: 'development_pr_opened',
        title: 'Pull Request opened',
        description: 'When a Pull Request is opened for your Development Task.',
      },
      {
        key: 'development_pr_merged',
        title: 'Pull Request merged',
        description: 'When your Development Task’s Pull Request is merged.',
      },
      {
        key: 'development_attention',
        title: 'Needs attention',
        description:
          'When a branch is deleted before a Pull Request, or a Pull Request is closed unmerged.',
      },
    ],
  },
  {
    title: 'Collaboration',
    items: [
      {
        key: 'mentions',
        title: 'Mentions',
        description:
          'When you’re named in a blocker or tagged in a Daily Update.',
      },
      {
        key: 'blockers_resolved',
        title: 'Blocker resolved',
        description: 'When a blocker on your task is resolved.',
      },
      {
        key: 'goals',
        title: 'Goal completed',
        description: 'When a Goal you’re part of is completed.',
      },
      {
        key: 'members',
        title: 'Members',
        description: 'When someone joins, or answers an invitation you sent.',
      },
      {
        key: 'daily_reports',
        title: 'Daily Report ready',
        description: 'When a workspace’s Daily Report is written.',
      },
    ],
  },
]

export function isPreferenceEnabled(
  preferences: NotificationPreferences,
  key: NotificationPreferenceKey,
): boolean {
  return preferences[key] !== false
}

export function rowsToPreferences(
  rows: { preference_key: string; enabled: boolean }[],
): NotificationPreferences {
  const preferences: NotificationPreferences = {}
  for (const row of rows)
    preferences[row.preference_key as NotificationPreferenceKey] = row.enabled
  return preferences
}
