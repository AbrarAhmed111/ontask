import { WorkspaceMember } from '@/types/workspace'
import { ActivityEvent } from '@/hooks/useWorkspaceActivity'
import { timeAgo } from '@/lib/time'

// " — text" when there is some, nothing otherwise.
function withDetail(value: unknown): string {
  return typeof value === 'string' && value.trim() ? ` — ${value.trim()}` : ''
}

type NamedMember = { name?: string }

// " #142" when the event names its Pull Request.
function prNumber(metadata: Record<string, unknown>): string {
  return typeof metadata.pr_number === 'number' ? ` #${metadata.pr_number}` : ''
}

// What an edit to a blocker changed, in words: who was added or removed. A
// wording-only edit adds nothing after the sentence.
function describeBlockerUpdate(metadata: Record<string, unknown>): string {
  const names = (value: unknown) =>
    Array.isArray(value)
      ? (value as NamedMember[]).map(member => member.name || 'a member')
      : []
  const parts: string[] = []
  const added = names(metadata.added)
  const removed = names(metadata.removed)
  if (added.length > 0) parts.push(`added ${added.join(', ')}`)
  if (removed.length > 0) parts.push(`removed ${removed.join(', ')}`)
  return parts.length > 0 ? ` (${parts.join('; ')})` : ''
}

function describeEvent(event: ActivityEvent, actorName: string): string {
  const title = (event.metadata.title as string) || 'a task'
  const parentTitle = event.metadata.parent_title as string | undefined
  const under = parentTitle ? ` under "${parentTitle}"` : ''

  switch (event.eventType) {
    case 'created':
      return `${actorName} created "${title}"${under}`
    case 'edited':
      return `${actorName} updated "${title}"${under}`
    case 'started':
      return `${actorName} started "${title}"${under}`
    case 'paused':
      // Timer stops that weren't the assignee pausing: an owner's emergency
      // stop, and the automatic stop when a running task is reassigned.
      if (event.metadata.reason === 'emergency_stop')
        return `${actorName} stopped ${event.metadata.stopped_user_name || 'a member'}'s timer on "${title}"${under}`
      if (event.metadata.reason === 'reassigned')
        return `The timer on "${title}"${under} was stopped because it was reassigned`
      return `${actorName} paused "${title}"${under}`
    case 'resumed':
      return `${actorName} resumed "${title}"${under}`
    case 'completed':
      // A merged Pull Request finished it, not a person.
      if (event.metadata.source === 'github')
        return `"${title}"${under} was completed — Pull Request${prNumber(event.metadata)} was merged`
      return `${actorName} completed "${title}"${under}`
    case 'skipped':
      return `${actorName} skipped "${title}"${under}`
    case 'reopened':
      return `${actorName} reopened "${title}"${under}`
    case 'deleted':
      return `${actorName} deleted "${title}"${under}`
    case 'assigned':
      return `${actorName} assigned "${title}"${under} to ${event.metadata.to}`
    case 'reassigned':
      return `${actorName} reassigned "${title}"${under} from ${event.metadata.from} to ${event.metadata.to}`
    case 'unassigned':
      return `${actorName} unassigned "${title}"${under}`
    case 'progress_changed':
      return event.metadata.to !== undefined
        ? `${actorName} updated progress on "${title}"${under} to ${event.metadata.to}%`
        : `${actorName} updated progress on "${title}"${under}`
    case 'parent_changed':
      return event.metadata.to === 'Standalone'
        ? `${actorName} made "${title}" standalone`
        : `${actorName} moved "${title}" under "${event.metadata.to}"`
    case 'member_invited':
      return `${actorName} invited ${event.metadata.invited_email}`
    case 'invitation_cancelled':
      return `${actorName} cancelled the invitation to ${event.metadata.invited_email}`
    case 'invitation_accepted':
      return `${actorName} accepted an invitation to join`
    case 'invitation_rejected':
      return `${actorName} declined an invitation to join`
    case 'member_joined':
      return `${actorName} joined the workspace`
    case 'member_removed':
      return event.metadata.self_removed
        ? `${actorName} left the workspace`
        : `${actorName} removed ${event.metadata.removed_display_name} from the workspace`
    case 'goal_created':
      return `${actorName} created the goal "${event.metadata.name}"`
    case 'goal_updated':
      return `${actorName} updated the goal "${event.metadata.name}"`
    case 'goal_completed':
      return `${actorName} marked the goal "${event.metadata.name}" complete`
    case 'goal_archived':
      return `${actorName} archived the goal "${event.metadata.name}"`
    case 'goal_task_created':
      return `${actorName} added "${title}" to ${event.metadata.goal_name ? `the goal "${event.metadata.goal_name}"` : 'a goal'}`
    case 'goal_subtask_created':
      return `${actorName} added subtask "${title}"${under}`
    case 'dependency_added':
      return `${actorName} marked "${event.metadata.blocking_title}" as required before "${title}"`
    case 'dependency_removed':
      return `${actorName} removed a dependency on "${title}"`
    case 'task_blocked':
      return `"${title}" is now blocked by "${event.metadata.blocking_title}"`
    case 'task_unblocked':
      return `"${title}" is now unblocked — "${event.metadata.unblocked_by_title}" finished`
    // Task blockers (someone reported something in the way of a task) — not to
    // be confused with task_blocked/task_unblocked above, which are about an
    // unfinished Goal dependency.
    case 'task_blocker_added':
      return `${actorName} blocked "${title}"${under}${withDetail(event.metadata.reason)}`
    case 'task_blocker_mention':
      return `${actorName} mentioned ${event.metadata.mentioned_name || 'a member'} in the blocker for "${title}"${under}`
    case 'task_blocker_updated':
      return `${actorName} updated the blocker on "${title}"${under}${describeBlockerUpdate(event.metadata)}`
    case 'task_blocker_resolved':
      return `${actorName} resolved the blocker on "${title}"${under}${withDetail(event.metadata.resolution_note)}`
    case 'note_added':
      return `${actorName} added a note to "${title}"`
    case 'note_updated':
      return `${actorName} edited a note on "${title}"`
    case 'note_deleted':
      return `${actorName} removed a note from "${title}"`
    case 'resource_uploaded':
      return `${actorName} uploaded "${event.metadata.file_name}"`
    case 'resource_updated':
      return `${actorName} updated "${event.metadata.file_name}"`
    case 'resource_deleted':
      return `${actorName} deleted "${event.metadata.file_name}"`
    // Development Tasks. GitHub is what happened; the actor recorded is the
    // task's assignee, whose branch it is.
    case 'development_tracking_enabled':
      return `${actorName} started tracking "${title}" on branch ${event.metadata.branch}`
    case 'development_branch_detected':
      return `${actorName}'s branch ${event.metadata.branch} was detected — "${title}" is in development`
    case 'development_pr_opened':
      return event.metadata.reopened
        ? `Pull Request${prNumber(event.metadata)} was reopened — "${title}" is in review`
        : `Pull Request${prNumber(event.metadata)} was opened — "${title}" moved to In Review`
    case 'development_pr_closed':
      return `Pull Request${prNumber(event.metadata)} was closed without merging — "${title}" is back in development`
    case 'development_pr_merged':
      return `Pull Request${prNumber(event.metadata)} was merged for "${title}"`
    // Workspace events only -- personal events never reach Activity.
    case 'event_created':
      return `${actorName} created the event "${title}"${withDetail(event.metadata.schedule)}`
    case 'event_updated':
      if (typeof event.metadata.previous_schedule === 'string')
        return `"${title}" was moved from ${event.metadata.previous_schedule} to ${event.metadata.schedule}`
      if (typeof event.metadata.previous_title === 'string')
        return `${actorName} renamed the event "${event.metadata.previous_title}" to "${title}"`
      if (event.metadata.audience_changed === true)
        return `${actorName} changed who "${title}" is for`
      return `${actorName} updated the event "${title}"`
    case 'event_cancelled':
      return `"${title}" was cancelled`
    case 'event_deleted':
      return `${actorName} deleted the event "${title}"`
    default:
      return `${actorName} updated "${title}"${under}`
  }
}

// Renders task_events as plain sentences with parent context preserved —
// "Iqra started 'Dashboard UI' under 'School Management MVP'" — never just
// a bare task name once it has a parent.
export function WorkspaceActivityFeed({
  events,
  members,
}: {
  events: ActivityEvent[]
  members: WorkspaceMember[]
}) {
  if (events.length === 0) {
    return (
      <p className="px-5 py-6 text-center text-xs text-muted">
        No activity yet.
      </p>
    )
  }
  return (
    <div className="max-h-[220px] divide-y divide-line/70 overflow-y-auto">
      {events.map(event => {
        const actor = members.find(member => member.userId === event.actorId)
        const actorName = actor?.fullName || actor?.email || 'Someone'
        return (
          <div
            key={event.id}
            className="flex items-center justify-between gap-3 px-5 py-3 animate-[slideInFade_260ms_ease-out]"
          >
            <p className="text-xs leading-5 text-ink">
              {describeEvent(event, actorName)}
            </p>
            <span className="shrink-0 text-[10px] text-muted">
              {timeAgo(event.createdAt)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
