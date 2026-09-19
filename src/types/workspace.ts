import type { SlackNotificationSettings } from '@/lib/integrations/slack/slackEventCategories'

export type WorkspaceRole = 'owner' | 'member'

// A `personal` workspace is the single, private, owner-only workspace every
// registered user gets automatically; `shared` workspaces are the
// collaborative ones. Both live in the same table and share every feature —
// see supabase/migrations/0028_personal_workspaces.sql.
export type WorkspaceType = 'personal' | 'shared'

export type Workspace = {
  id: string
  // For a personal workspace this is always the reserved alias
  // `personal-workspace` (the same URL for every user) rather than the row's
  // stored slug — see lib/workspaces.ts.
  slug: string
  type: WorkspaceType
  name: string
  description: string | null
  ownerId: string
  timezone: string
  // The workspace-local time of day (e.g. "12:00:00") the automatic Daily
  // Report is generated at -- owner-configurable, defaults to noon.
  reportTime: string
  // Whether the automatic Daily Report runs for this workspace at all. Owner-
  // configurable; off by default for a personal workspace, on for a shared one
  // (supabase/migrations/0042). Turning it off hides the report section and
  // stops new reports, and keeps the ones already stored.
  dailyReportsEnabled: boolean
  accent: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceMember = {
  id: string
  workspaceId: string
  userId: string
  role: WorkspaceRole
  joinedAt: string
  fullName: string | null
  email: string | null
  avatarUrl: string | null
}

export type InvitationStatus =
  'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled'

export type WorkspaceInvitation = {
  id: string
  workspaceId: string
  workspaceName: string | null
  invitedBy: string
  // Display name (or email) of whoever sent the invitation. Only populated
  // for the invitee's own list (list_my_pending_invitations) — the owner's
  // per-workspace list already knows who they are.
  inviterName: string | null
  invitedEmail: string
  invitedUserId: string | null
  message: string | null
  status: InvitationStatus
  rejectionReason: string | null
  createdAt: string
  respondedAt: string | null
  expiresAt: string
}

// 'blocked' means the task has an ACTIVE blocker (see TaskBlocker below) —
// something is preventing the assignee from continuing. It is not 'paused'
// (an intentional stop) and not a Goal dependency (a derived edge between two
// tasks, never stored here). It is entered only by block_workspace_task and
// left only by resolve_task_blocker (supabase/migrations/0041_task_blockers.sql).
export type WorkspaceTaskStatus =
  'queued' | 'working' | 'paused' | 'blocked' | 'completed' | 'skipped'

export type WorkspaceTask = {
  id: string
  workspaceId: string
  parentTaskId: string | null
  // The workspace Goal this task belongs to, if any. Only tasks with a
  // goalId may have a parentTaskId (subtasks exist only inside Goals) — see
  // supabase/migrations/0021_workspace_goals.sql.
  goalId: string | null
  createdBy: string
  assignedTo: string | null
  name: string
  description?: string | null
  plannedMinutes: number | null
  workedSeconds: number
  status: WorkspaceTaskStatus
  // A free-text label + manual percent a member can track on any task —
  // unrelated to the real `Goal` entity below. Named distinctly to avoid
  // confusion between "set a progress label on this task" and "create a
  // workspace Goal".
  progressLabel?: string
  progressPercentage?: number
  startedAt: number | null
  completedAt: number | null
}

export type GoalStatus = 'active' | 'completed' | 'archived'

export type Goal = {
  id: string
  workspaceId: string
  name: string
  description: string | null
  status: GoalStatus
  createdBy: string
  targetDate: string | null
  position: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  archivedAt: string | null
}

export type TaskDependency = {
  id: string
  workspaceId: string
  goalId: string
  blockingTaskId: string
  blockedTaskId: string
  createdBy: string
  createdAt: string
}

export type TaskBlockerStatus = 'active' | 'resolved'

// One reason a task can't move forward. A task may have many over its life
// (all kept as history) but only one active at a time. `mentionedUserIds` are
// the workspace members explicitly asked to help — stable user ids, never
// display names — and, together with the current assignee, the only people who
// may resolve an active blocker.
export type TaskBlocker = {
  id: string
  taskId: string
  workspaceId: string
  createdBy: string
  reason: string
  status: TaskBlockerStatus
  createdAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  resolutionNote: string | null
  mentionedUserIds: string[]
}

export type TaskNote = {
  id: string
  taskId: string
  authorId: string
  content: string
  createdAt: string
  updatedAt: string
}

export type NotificationType =
  | 'assigned'
  | 'reassigned'
  | 'completed'
  | 'reopened'
  | 'task_unblocked'
  | 'note_added'
  | 'goal_completed'
  | 'invitation_accepted'
  | 'invitation_rejected'
  | 'member_joined'
  | 'member_removed'
  | 'daily_report_ready'
  // The workspace owner emergency-stopped this member's running task timer.
  | 'timer_stopped'
  // Named in a task blocker, so able to resolve it — and someone else
  // resolved a blocker on a task this member is assigned to.
  | 'blocker_mention'
  | 'blocker_resolved'

export type NotificationEntityType =
  'task' | 'goal' | 'resource' | 'note' | 'workspace'

export type WorkspaceNotification = {
  id: string
  userId: string
  workspaceId: string
  eventId: string | null
  goalId: string | null
  notificationType: NotificationType
  entityType: NotificationEntityType
  entityId: string | null
  title: string
  body: string | null
  actorId: string | null
  readAt: string | null
  createdAt: string
}

// A notification as the bell renders it: the row plus the workspace it came
// from, so every entry can name (and deep-link to) its origin. See
// lib/workspaceNotifications.ts.
export type NotificationWithWorkspace = WorkspaceNotification & {
  workspaceSlug: string
  workspaceName: string
  workspaceType: WorkspaceType
  workspaceAccent: string
}

export type WorkspaceResource = {
  id: string
  workspaceId: string
  goalId: string | null
  uploadedBy: string
  fileName: string
  fileType: string
  fileSize: number
  storagePath: string
  description: string | null
  createdAt: string
  updatedAt: string
}

// ── Phase 11: Automatic Daily Report (rolling 24h, workspace-timezone noon) ─
// structured_snapshot/narrative/meta are stored (and returned by ontask-llm)
// as-is, snake_case, matching that service's Pydantic schema field names
// exactly — only the outer row columns get the usual camelCase treatment.
// See ontask-llm/src/app/schemas/summary.py for the authoritative shape, and
// supabase/migrations/0018_automatic_daily_reports.sql for how it's actually
// assembled and scheduled.

export type SummaryTaskStatus = 'completed' | 'in_progress' | 'skipped'

// A task's state AT report_end, from the authoritative task record -- never
// derived from how many times it was completed or reopened in the window.
export type SummaryCurrentStatus =
  | 'queued'
  | 'working'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'skipped'
  | 'deleted'

// One task_events row (or a synthesized 'invitation_sent' entry attributed
// to the inviter) — the raw, factual activity log a member's narrative is
// grounded in. `metadata` is forwarded from the DB as-is; shape depends on
// `type` (from/to for assignment or progress changes, invited_email/status
// for invitations, ...).
export type StructuredSnapshotEvent = {
  type: string
  timestamp: string
  task_id: string | null
  // Resolved in SQL (the title on the event, else the task's own, else the one
  // its `deleted` event kept) so nothing downstream has to guess. Null only for
  // an event with no task, or a task that genuinely cannot be resolved -- never
  // a placeholder.
  task_title: string | null
  parent_title: string | null
  // What a task-less event is about: a goal's name, a file's name, an invited
  // address. Absent on snapshots from before migration 0042.
  subject?: string | null
  actor_user_id?: string | null
  actor_name?: string | null
  metadata: Record<string, unknown>
}

export type StructuredSnapshotTaskActivity = {
  task_id: string
  title: string
  parent_task_id: string | null
  parent_title: string | null
  // The workspace Goal this task belongs to, if any — never inferred, only
  // ever the real goals.name at report time (see
  // supabase/migrations/0027_daily_report_goal_awareness.sql).
  goal_id: string | null
  goal_name: string | null
  focused_seconds: number
  // Only set when a progress_changed event occurred that day — never
  // inferred from the task's current value.
  progress_start: number | null
  progress_end: number | null
  status_end: SummaryTaskStatus
  // Absent on snapshots from before migration 0042 (status_end is all they have).
  current_status?: SummaryCurrentStatus | null
}

export type StructuredSnapshotMember = {
  user_id: string
  display_name: string
  focused_seconds: number
  events: StructuredSnapshotEvent[]
  task_activity: StructuredSnapshotTaskActivity[]
}

export type StructuredSnapshotInvitation = {
  invited_email: string
  invited_by_user_id: string
  invited_by_name: string
  status: string
  responded_at: string | null
}

export type StructuredSnapshotMemberChange = {
  user_id: string
  display_name: string
}

export type StructuredSnapshotWorkspaceChanges = {
  invitations: StructuredSnapshotInvitation[]
  members_joined: StructuredSnapshotMemberChange[]
  members_removed: StructuredSnapshotMemberChange[]
  tasks_created: number
  tasks_completed: number
  tasks_skipped: number
  tasks_deleted: number
}

export type StructuredSnapshotBlockerMember = {
  user_id: string
  display_name: string
}

// One task blocker that overlapped the reporting window, as
// generate_workspace_daily_snapshot assembled it (supabase/migrations/
// 0041_task_blockers.sql) — every field straight from the blocker tables, the
// reason and note exactly as the members wrote them. `resolved_*` are only set
// when the blocker was resolved INSIDE the window; one resolved later reads as
// still blocked at the end of it, so a regenerated report can't leak a future
// resolution. `blocked_seconds` is time blocked within the window only.
export type StructuredSnapshotBlocker = {
  blocker_id: string
  task_id: string
  task_title: string
  parent_title: string | null
  goal_id: string | null
  goal_name: string | null
  reason: string
  blocked_by_user_id: string
  blocked_by_name: string
  blocked_at: string
  mentioned: StructuredSnapshotBlockerMember[]
  resolved_at: string | null
  resolved_by_user_id: string | null
  resolved_by_name: string | null
  resolution_note: string | null
  still_blocked_at_report_end: boolean
  blocked_seconds: number
}

// The authoritative counts the report shows (migration 0042). Distinct TASKS:
// `tasks_completed` counts tasks completed in the window that are still
// completed at its end, so a task completed, reopened and running again is not
// one. Absent on older snapshots -- see lib/dailyReportMetrics.ts.
export type StructuredSnapshotMetrics = {
  tasks_worked_on: number
  tasks_completed: number
}

export type WorkspaceStructuredSnapshot = {
  workspace_id: string
  workspace_name: string
  // Absent on snapshots from before migration 0042.
  workspace_type?: WorkspaceType
  report_start: string
  report_end: string
  timezone: string
  total_focused_seconds: number
  metrics?: StructuredSnapshotMetrics
  members: StructuredSnapshotMember[]
  workspace_changes: StructuredSnapshotWorkspaceChanges
  // Absent on reports generated before task blockers existed.
  blockers?: StructuredSnapshotBlocker[]
}

export type SummaryMemberNarrative = {
  user_id: string
  note: string
}

// Since migration 0042 the Daily Report narrative is prose: `overall_summary`
// holds ALL of it (paragraphs separated by a blank line) and the other three
// fields are empty. They stay on the type because a report stored before then
// filled them.
export type SummaryNarrative = {
  overall_summary: string
  members: SummaryMemberNarrative[]
  workspace_changes_summary: string
  highlights: string[]
}

export type SummaryProviderStatusEvent = {
  type: string
  status: string
  message: string
  provider: string
}

export type SummaryGenerationMeta = {
  provider: string
  model: string
  generated_at: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  status_events: SummaryProviderStatusEvent[]
  used_fallback_template: boolean
  validation_warnings: string[]
}

export type DailyReportGenerationType = 'automatic' | 'manual'
export type DailyReportGenerationStatus = 'pending' | 'completed' | 'failed'

export type WorkspaceDailySummary = {
  id: string
  workspaceId: string
  reportStart: string
  reportEnd: string
  reportTimezone: string
  version: number
  structuredSnapshot: WorkspaceStructuredSnapshot
  narrative: SummaryNarrative
  meta: SummaryGenerationMeta
  generationType: DailyReportGenerationType
  generationStatus: DailyReportGenerationStatus
  generatedBy: string | null
  generatedAt: string
  regeneratedBy: string | null
  regeneratedAt: string | null
  createdAt: string
}

// One home for the preference keys: slackEventCategories.ts, which is also
// what the dispatcher reads them with. This file and SlackIntegrationCard.tsx
// each used to declare their own copy of the six keys from 0045 -- three
// lists, none of them checked against the others, which is how a preference
// key and the dispatcher can quietly stop agreeing.
export type { SlackNotificationSettings }

export type SlackStatusData = {
  connected: boolean
  connection_status?:
    | 'connected'
    | 'disconnected'
    | 'invalid_token'
    | 'channel_missing'
    | 'configuration_incomplete'
    | string
  id?: string
  slack_team_id?: string
  slack_team_name?: string
  channel_id?: string
  channel_name?: string
  notification_settings?: SlackNotificationSettings
  can_manage?: boolean
}
