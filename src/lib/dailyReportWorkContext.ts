import {
  StructuredSnapshotBlocker,
  StructuredSnapshotDailyUpdate,
  StructuredSnapshotMember,
  StructuredSnapshotWorkSession,
  StructuredSnapshotTaskActivity,
  SummaryNarrative,
  WorkspaceStructuredSnapshot,
} from '@/types/workspace'
import { reportTaskStatus } from '@/lib/dailyReportMetrics'

export type DailyReportWorkContextTask = {
  task_id: string
  title: string
  parent_task_id: string | null
  parent_title: string | null
  goal_id: string | null
  goal_name: string | null
  focused_seconds: number
  status: string
  completed_in_period: boolean
}

export type DailyReportWorkContextMember = {
  user_id: string
  name: string
  work_sessions: {
    session_id: string
    started_at: string
    ended_at: string | null
    status_at_report_end: string
    active_seconds: number
    break_seconds: number
    still_active_at_report_end: boolean
  }[]
  tasks_worked_on: DailyReportWorkContextTask[]
  completed_work: DailyReportWorkContextTask[]
  blockers: {
    blocker_id: string
    task_id: string
    task_title: string
    reason: string
    created_at: string
    resolved: boolean
    resolved_at: string | null
    resolved_by_user_id: string | null
    resolved_by_name: string | null
    mentioned: { user_id: string; name: string }[]
    resolution_note: string | null
  }[]
  daily_updates: {
    done: unknown[]
    blockers: unknown[]
    next: unknown[]
  }
  meaningful_collaboration: unknown[]
  has_meaningful_work: boolean
}

export type DailyReportWorkContext = {
  report_format_version: 2
  workspace: {
    id: string
    name: string
    type: string | null
    timezone: string
  }
  reporting_period: {
    start: string
    end: string
  }
  members: DailyReportWorkContextMember[]
}

function completedInPeriod(
  member: StructuredSnapshotMember,
  task: StructuredSnapshotTaskActivity,
): boolean {
  if (reportTaskStatus(task) !== 'completed') return false
  if (member.events.length === 0) return true
  return member.events.some(
    event => event.task_id === task.task_id && event.type === 'completed',
  )
}

function memberUpdates(
  updates: StructuredSnapshotDailyUpdate[],
  userId: string,
) {
  const items = updates
    .filter(update => update.user_id === userId)
    .flatMap(update => update.items)
  return {
    done: items.filter(item => item.type === 'done'),
    blockers: items.filter(item => item.type === 'blocker'),
    next: items.filter(item => item.type === 'next'),
  }
}

function memberBlockers(
  blockers: StructuredSnapshotBlocker[],
  member: StructuredSnapshotMember,
) {
  const taskIds = new Set(member.task_activity.map(task => task.task_id))
  return blockers
    .filter(
      blocker =>
        blocker.blocked_by_user_id === member.user_id ||
        taskIds.has(blocker.task_id) ||
        blocker.mentioned.some(mention => mention.user_id === member.user_id) ||
        blocker.resolved_by_user_id === member.user_id,
    )
    .map(blocker => ({
      blocker_id: blocker.blocker_id,
      task_id: blocker.task_id,
      task_title: blocker.task_title,
      reason: blocker.reason,
      created_at: blocker.blocked_at,
      resolved: !blocker.still_blocked_at_report_end,
      resolved_at: blocker.resolved_at,
      resolved_by_user_id: blocker.resolved_by_user_id,
      resolved_by_name: blocker.resolved_by_name,
      mentioned: blocker.mentioned.map(mention => ({
        user_id: mention.user_id,
        name: mention.display_name,
      })),
      resolution_note: blocker.resolution_note,
    }))
}

function memberWorkSessions(sessions: StructuredSnapshotWorkSession[] = []) {
  return sessions.map(session => ({
    session_id: session.session_id,
    started_at: session.started_at,
    ended_at: session.ended_at,
    status_at_report_end: session.status_at_report_end,
    active_seconds: session.active_seconds,
    break_seconds: session.total_break_seconds,
    still_active_at_report_end: session.still_active_at_report_end,
  }))
}

function collaborationFor(
  snapshot: WorkspaceStructuredSnapshot,
  member: StructuredSnapshotMember,
) {
  const changes = snapshot.workspace_changes
  return [
    ...changes.invitations
      .filter(invitation => invitation.invited_by_user_id === member.user_id)
      .map(invitation => ({
        type: 'invitation',
        invited_email: invitation.invited_email,
        status: invitation.status,
        responded_at: invitation.responded_at,
      })),
    ...changes.members_joined.map(joined => ({
      type: 'member_joined',
      user_id: joined.user_id,
      name: joined.display_name,
    })),
  ]
}

export function buildDailyReportWorkContext(
  snapshot: WorkspaceStructuredSnapshot,
): DailyReportWorkContext {
  const blockers = snapshot.blockers ?? []
  const updates = snapshot.daily_updates ?? []
  return {
    report_format_version: 2,
    workspace: {
      id: snapshot.workspace_id,
      name: snapshot.workspace_name,
      type: snapshot.workspace_type ?? null,
      timezone: snapshot.timezone,
    },
    reporting_period: {
      start: snapshot.report_start,
      end: snapshot.report_end,
    },
    members: snapshot.members.map(member => {
      const tasks = member.task_activity.map(task => ({
        task_id: task.task_id,
        title: task.title,
        parent_task_id: task.parent_task_id,
        parent_title: task.parent_title,
        goal_id: task.goal_id,
        goal_name: task.goal_name,
        focused_seconds: task.focused_seconds,
        status: reportTaskStatus(task),
        completed_in_period: completedInPeriod(member, task),
      }))
      const memberDailyUpdates = memberUpdates(updates, member.user_id)
      const memberBlockerItems = memberBlockers(blockers, member)
      const meaningfulCollaboration = collaborationFor(snapshot, member)
      const workSessions = memberWorkSessions(member.work_sessions)
      return {
        user_id: member.user_id,
        name: member.display_name,
        work_sessions: workSessions,
        tasks_worked_on: tasks,
        completed_work: tasks.filter(task => task.completed_in_period),
        blockers: memberBlockerItems,
        daily_updates: memberDailyUpdates,
        meaningful_collaboration: meaningfulCollaboration,
        has_meaningful_work:
          tasks.length > 0 ||
          workSessions.length > 0 ||
          memberBlockerItems.length > 0 ||
          memberDailyUpdates.done.length > 0 ||
          memberDailyUpdates.blockers.length > 0 ||
          memberDailyUpdates.next.length > 0 ||
          meaningfulCollaboration.length > 0,
      }
    }),
  }
}

export function emptyWorkContextNarrative(
  snapshot: WorkspaceStructuredSnapshot,
): SummaryNarrative {
  return {
    overall_summary:
      'No significant workspace activity was recorded during the previous 24 hours.',
    members: snapshot.members.map(member => ({
      user_id: member.user_id,
      name: member.display_name,
      narrative:
        'No meaningful work activity was recorded during this reporting period.',
    })),
    summary:
      'No significant workspace activity was recorded during the previous 24 hours.',
    format_version: 2,
    workspace_changes_summary: '',
    highlights: [],
  }
}
