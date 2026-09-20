/**
 * Slack Block Kit Message Builder for OnTask events.
 * Constructs visually engaging, structured messages with deep links back to OnTask.
 */

import {
  getTaskUrl,
  getReportUrl,
  getWorkspaceUrl,
  getMembersUrl,
  getGoalUrl,
  getResourcesUrl,
} from './slackUrl'
import type { DailyReportDigest } from '@/lib/dailyReportDigest'

/**
 * What an event is about. The database decides this (see
 * slack_payload_for_task_event in migration 0048) rather than this file
 * inferring it from which fields happen to be filled in — which is what
 * produced "updated A task" for goals, files and invitations alike.
 */
export type SlackEntityType =
  | 'task'
  | 'goal_task'
  | 'goal_subtask'
  | 'goal'
  | 'resource'
  | 'workspace_member'
  | 'invitation'
  | 'work_session'
  | 'daily_report'

export interface EventSlackPayload {
  workspaceName: string
  workspaceSlug: string
  eventType: string
  /** What kind of thing this is about. Absent only for an event from a
   *  database that predates 0048; the message still resolves, it just cannot
   *  tell a goal's task from a loose one. */
  entityType?: SlackEntityType
  /** The id of that thing — the goal, the file, the member. For a task
   *  event it is the task's own id, the same value as `taskId`. */
  entityId?: string | null
  taskTitle?: string | null
  taskId?: string | null
  /** The parent task a subtask sits under, when there is one. */
  parentTitle?: string | null
  goalId?: string | null
  /** The goal a task, subtask or resource belongs to — context, not subject. */
  goalName?: string | null
  /** The subject of an event that is not about a task: a goal's name, a file's
   *  name, the member who joined or was removed. */
  entityName?: string | null
  actorName?: string | null
  recipientName?: string | null
  previousAssigneeName?: string | null
  selfRemoved?: boolean | null
  blockerReason?: string | null
  reportId?: string | null
  /** The short form of the Daily Report this event announces, read out of the
   *  stored report by the dispatcher. Absent means there was no report to read
   *  — never "summarise it here instead". */
  report?: DailyReportDigest | null
}

export interface SlackMessagePayload {
  fallbackText: string
  blocks: unknown[]
}

export function buildSlackEventMessage(
  payload: EventSlackPayload,
): SlackMessagePayload {
  // A value the payload actually has. Postgres sends JSON null for every
  // field it has nothing for, and a destructuring default (`= 'Untitled'`)
  // only fires for undefined — so null would sail straight through into
  // escapeSlackText and throw, taking the whole notification with it.
  const str = (value?: string | null): string | undefined =>
    value == null || value === '' ? undefined : value

  const { workspaceName, workspaceSlug, eventType, entityType } = payload
  const taskTitle = str(payload.taskTitle) ?? 'Untitled Task'
  const taskId = str(payload.taskId)
  const parentTitle = str(payload.parentTitle)
  const goalId = str(payload.goalId)
  const goalName = str(payload.goalName)
  const entityName = str(payload.entityName)
  const actorName = str(payload.actorName) ?? 'Someone'
  const recipientName = str(payload.recipientName)
  const previousAssigneeName = str(payload.previousAssigneeName)
  const blockerReason = str(payload.blockerReason)
  const reportId = str(payload.reportId)
  const selfRemoved = payload.selfRemoved ?? false

  const taskUrl = taskId
    ? getTaskUrl(workspaceSlug, taskId)
    : getReportUrl(workspaceSlug)
  const reportUrl = getReportUrl(workspaceSlug, reportId)
  const workspaceUrl = getWorkspaceUrl(workspaceSlug)
  const membersUrl = getMembersUrl(workspaceSlug)
  const goalUrl = getGoalUrl(workspaceSlug, goalId)
  const resourcesUrl = getResourcesUrl(workspaceSlug)

  // Where a message about something that no longer exists should land. A
  // deleted task's own URL would open a workspace that then cannot find it,
  // so the link goes one level out: to the goal it belonged to, or to the
  // workspace. Never a task URL for a task that is gone.
  const goneUrl = goalId ? goalUrl : workspaceUrl

  const isSubtask = entityType === 'goal_subtask'
  const inGoal = entityType === 'goal_task' || isSubtask

  // The shape every message shares: what happened, who did it, which
  // workspace, and one button back to the thing itself. Written once so a new
  // event type cannot quietly arrive looking like a different product.
  const message = ({
    heading,
    body,
    fallback,
    url,
    buttonText = 'Open in OnTask',
    style,
    goal,
  }: {
    heading: string
    body: string
    fallback: string
    url: string
    buttonText?: string
    style?: 'primary' | 'danger'
    goal?: string
  }): SlackMessagePayload => {
    const context: unknown[] = [
      {
        type: 'mrkdwn',
        text: `*Workspace:* ${escapeSlackText(workspaceName)}`,
      },
    ]
    if (goal) {
      context.push({
        type: 'mrkdwn',
        text: `*Goal:* ${escapeSlackText(goal)}`,
      })
    }
    return {
      fallbackText: `[${workspaceName}] ${fallback}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: heading, emoji: true },
        },
        { type: 'section', text: { type: 'mrkdwn', text: body } },
        { type: 'context', elements: context },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: buttonText, emoji: true },
              url,
              ...(style ? { style } : {}),
            },
          ],
        },
      ],
    }
  }

  const taskLink = `*<${taskUrl}|${escapeSlackText(taskTitle)}>*`
  const subject = escapeSlackText(entityName || 'Untitled')
  const actor = escapeSlackText(actorName)

  // How a task refers to itself in a sentence. A subtask says what it is a
  // subtask OF, because its own title ("Create OAuth callback") rarely makes
  // sense alone; the goal stays in the context row, where it does not have to
  // be repeated in every line. The plain-text twin is for the notification
  // preview, which renders no links and no context row — so that one does
  // name the goal.
  const taskPhrase =
    isSubtask && parentTitle
      ? `subtask ${taskLink} under *${escapeSlackText(parentTitle)}*`
      : taskLink

  const taskPhraseText = (() => {
    const base =
      isSubtask && parentTitle
        ? `subtask "${taskTitle}" under "${parentTitle}"`
        : `"${taskTitle}"`
    return inGoal && goalName ? `${base} in goal "${goalName}"` : base
  })()

  switch (eventType) {
    // ── tasks ────────────────────────────────────────────────────────────
    case 'task_created': {
      const assigned = recipientName
        ? ` Assigned to *${escapeSlackText(recipientName)}*.`
        : ''
      return message({
        heading: '📋 Task Created',
        body: `*${actor}* created ${taskLink}.${assigned}`,
        fallback: `${actorName} created "${taskTitle}"${recipientName ? ` and assigned it to ${recipientName}` : ''}`,
        url: taskUrl,
      })
    }

    case 'goal_task_created': {
      const assigned = recipientName
        ? ` Assigned to *${escapeSlackText(recipientName)}*.`
        : ''
      return message({
        heading: '🎯 Goal Task Added',
        body: `*${actor}* added ${taskLink}${goalName ? ` to the goal *${escapeSlackText(goalName)}*` : ' to a goal'}.${assigned}`,
        fallback: `${actorName} added "${taskTitle}" to ${goalName ? `the goal "${goalName}"` : 'a goal'}`,
        url: taskUrl,
        goal: goalName,
      })
    }

    case 'goal_subtask_created': {
      const under = parentTitle
        ? ` under *${escapeSlackText(parentTitle)}*`
        : ''
      const assigned = recipientName
        ? ` Assigned to *${escapeSlackText(recipientName)}*.`
        : ''
      return message({
        heading: '🎯 Goal Subtask Added',
        body: `*${actor}* added subtask ${taskLink}${under}.${assigned}`,
        fallback: `${actorName} added subtask "${taskTitle}"${parentTitle ? ` under "${parentTitle}"` : ''}`,
        url: taskUrl,
        goal: goalName,
      })
    }

    // A reassignment names both ends of the move. The person it came FROM is
    // resolved from the event's own `from_user_id`, captured before the write
    // — by the time this runs the task row holds only the new assignee, so
    // reading it back would name the wrong person or nobody.
    case 'assigned':
    case 'reassigned': {
      const isReassigned = eventType === 'reassigned'
      const verb = isReassigned ? 'reassigned' : 'assigned'
      const fromText =
        isReassigned && previousAssigneeName
          ? ` from *${escapeSlackText(previousAssigneeName)}*`
          : ''
      const fromTextPlain =
        isReassigned && previousAssigneeName
          ? ` from ${previousAssigneeName}`
          : ''
      const recipientText = recipientName
        ? ` to *${escapeSlackText(recipientName)}*`
        : ''
      return message({
        heading: isReassigned ? '📋 Task Reassigned' : '📋 Task Assigned',
        body: `*${actor}* ${verb} ${taskPhrase}${fromText}${recipientText}.`,
        fallback: `${actorName} ${verb} ${taskPhraseText}${fromTextPlain}${recipientName ? ` to ${recipientName}` : ''}`,
        url: taskUrl,
        style: 'primary',
        goal: goalName,
      })
    }

    case 'unassigned': {
      const fromText = previousAssigneeName
        ? ` from *${escapeSlackText(previousAssigneeName)}*`
        : ''
      return message({
        heading: '📋 Task Unassigned',
        body: `*${actor}* unassigned ${taskPhrase}${fromText}.`,
        fallback: `${actorName} unassigned ${taskPhraseText}${previousAssigneeName ? ` from ${previousAssigneeName}` : ''}`,
        url: taskUrl,
        goal: goalName,
      })
    }

    case 'started':
    case 'resumed': {
      const isResumed = eventType === 'resumed'
      const verb = isResumed ? 'resumed' : 'started'
      return message({
        heading: isResumed ? '▶️ Task Resumed' : '▶️ Task Started',
        body: `*${actor}* ${verb} work on ${taskPhrase}.`,
        fallback: `${actorName} ${verb} ${taskPhraseText}`,
        url: taskUrl,
        goal: goalName,
      })
    }

    case 'paused': {
      return message({
        heading: '⏸️ Task Paused',
        body: `*${actor}* paused ${taskPhrase}.`,
        fallback: `${actorName} paused ${taskPhraseText}`,
        url: taskUrl,
        goal: goalName,
      })
    }

    case 'completed': {
      return message({
        heading: '✅ Task Completed',
        body: `*${actor}* completed ${taskPhrase}.`,
        fallback: `${actorName} completed ${taskPhraseText}`,
        url: taskUrl,
        goal: goalName,
      })
    }

    case 'skipped': {
      return message({
        heading: '⏭️ Task Skipped',
        body: `*${actor}* skipped ${taskPhrase}.`,
        fallback: `${actorName} skipped ${taskPhraseText}`,
        url: taskUrl,
        goal: goalName,
      })
    }

    case 'reopened': {
      return message({
        heading: '🔄 Task Reopened',
        body: `*${actor}* reopened ${taskPhrase}.`,
        fallback: `${actorName} reopened ${taskPhraseText}`,
        url: taskUrl,
        goal: goalName,
      })
    }

    // The task is gone by the time this is built — its title and its parent
    // come from the event's own snapshot, and the button goes to the goal it
    // belonged to (or the workspace), never to a task URL that would open a
    // workspace which then cannot find it.
    case 'task_deleted': {
      return message({
        heading: '🗑️ Task Deleted',
        body: `*${actor}* deleted ${isSubtask && parentTitle ? `subtask *${escapeSlackText(taskTitle)}* under *${escapeSlackText(parentTitle)}*` : `*${escapeSlackText(taskTitle)}*`} from the *${escapeSlackText(workspaceName)}* workspace.`,
        fallback: `${actorName} deleted ${taskPhraseText} from ${workspaceName}`,
        url: goneUrl,
        buttonText: goalId ? 'Open Goal' : 'Open Workspace',
        goal: goalName,
      })
    }

    // ── notes ────────────────────────────────────────────────────────────
    // The note's own text is never sent: a note is where someone writes the
    // things they would not put in a task title, and the channel a Slack
    // integration posts to is not necessarily the audience they wrote it for.
    case 'note_added': {
      return message({
        heading: '📝 Note Added',
        body: `*${actor}* added a note to ${taskPhrase}.`,
        fallback: `${actorName} added a note to ${taskPhraseText}`,
        url: taskUrl,
        goal: goalName,
      })
    }

    // ── goals ────────────────────────────────────────────────────────────
    case 'goal_created': {
      return message({
        heading: '🎯 Goal Created',
        body: `*${actor}* created the goal *${subject}*.`,
        fallback: `${actorName} created the goal "${entityName || 'Untitled'}"`,
        url: goalUrl,
        buttonText: 'Open Goal',
      })
    }

    case 'goal_completed': {
      return message({
        heading: '🏆 Goal Completed',
        body: `*${actor}* completed the goal *${subject}*.`,
        fallback: `${actorName} completed the goal "${entityName || 'Untitled'}"`,
        url: goalUrl,
        buttonText: 'Open Goal',
        style: 'primary',
      })
    }

    case 'goal_archived': {
      return message({
        heading: '🗄️ Goal Archived',
        body: `*${actor}* archived the goal *${subject}*.`,
        fallback: `${actorName} archived the goal "${entityName || 'Untitled'}"`,
        url: goalUrl,
        buttonText: 'Open Goal',
      })
    }

    // The goal itself is gone by the time this is built — every word here
    // comes from the event's own metadata, never a lookup.
    case 'goal_deleted': {
      return message({
        heading: '🗑️ Goal Deleted',
        body: `*${actor}* deleted the goal *${subject}*.`,
        fallback: `${actorName} deleted the goal "${entityName || 'Untitled'}"`,
        url: workspaceUrl,
        buttonText: 'Open Workspace',
      })
    }

    // ── blockers ─────────────────────────────────────────────────────────
    case 'blocker_created': {
      const reasonText = blockerReason
        ? `\n\n*Reason:* _${escapeSlackText(blockerReason)}_`
        : ''
      return message({
        heading: '🚨 Task Blocked',
        body: `${taskLink} has been blocked by *${actor}*.${reasonText}`,
        fallback: `Task Blocked: "${taskTitle}"`,
        url: taskUrl,
        style: 'danger',
        goal: goalName,
      })
    }

    case 'mentioned': {
      const recipientText = recipientName
        ? `*${escapeSlackText(recipientName)}*`
        : 'someone'
      const reasonText = blockerReason
        ? `\n\n*Reason:* _${escapeSlackText(blockerReason)}_`
        : ''
      return message({
        heading: '👋 Mentioned in a Blocker',
        body: `*${actor}* mentioned ${recipientText} on ${taskLink}.${reasonText}`,
        fallback: recipientName
          ? `${actorName} mentioned ${recipientName} on "${taskTitle}"`
          : `${actorName} mentioned someone on "${taskTitle}"`,
        url: taskUrl,
        style: 'primary',
        goal: goalName,
      })
    }

    case 'blocker_resolved':
    case 'task_unblocked': {
      return message({
        heading: '🎉 Blocker Resolved',
        body: `The blocker on ${taskLink} was resolved by *${actor}*.`,
        fallback: `Blocker Resolved on "${taskTitle}"`,
        url: taskUrl,
        style: 'primary',
        goal: goalName,
      })
    }

    // ── resources ────────────────────────────────────────────────────────
    // The file's name and where it lives, never its contents.
    case 'resource_added': {
      return message({
        heading: '📎 Resource Added',
        body: `*${actor}* uploaded *${subject}*${goalName ? ` to the goal *${escapeSlackText(goalName)}*` : ` to the *${escapeSlackText(workspaceName)}* workspace`}.`,
        fallback: `${actorName} uploaded "${entityName || 'a file'}" to ${workspaceName}`,
        url: resourcesUrl,
        buttonText: 'Open Resources',
        goal: goalName,
      })
    }

    case 'resource_updated': {
      return message({
        heading: '📎 Resource Updated',
        body: `*${actor}* updated the resource *${subject}*.`,
        fallback: `${actorName} updated resource "${entityName || 'a file'}" in ${workspaceName}`,
        url: resourcesUrl,
        buttonText: 'Open Resources',
        goal: goalName,
      })
    }

    case 'resource_deleted': {
      return message({
        heading: '📎 Resource Removed',
        body: `*${actor}* deleted the resource *${subject}* from the *${escapeSlackText(workspaceName)}* workspace.`,
        fallback: `${actorName} deleted resource "${entityName || 'a file'}" from ${workspaceName}`,
        url: resourcesUrl,
        buttonText: 'Open Resources',
        goal: goalName,
      })
    }

    // ── workspace membership ─────────────────────────────────────────────
    // The invitee is named, never the invitation's token or link.
    case 'member_invited': {
      return message({
        heading: '👋 Workspace Invitation',
        body: `*${actor}* invited *${subject}* to the *${escapeSlackText(workspaceName)}* workspace.`,
        fallback: `${actorName} invited ${entityName || 'someone'} to the ${workspaceName} workspace`,
        url: membersUrl,
        buttonText: 'View Members',
      })
    }

    // The actor IS the person who joined (accept_workspace_invitation runs as
    // them), so the name comes from the actor, not the subject.
    case 'member_joined': {
      return message({
        heading: '👋 New Workspace Member',
        body: `*${actor}* joined the *${escapeSlackText(workspaceName)}* workspace.`,
        fallback: `${actorName} joined the ${workspaceName} workspace`,
        url: membersUrl,
        buttonText: 'View Members',
        style: 'primary',
      })
    }

    case 'member_removed': {
      return message({
        heading: selfRemoved ? '👤 Member Left' : '👤 Member Removed',
        body: selfRemoved
          ? `*${actor}* left the *${escapeSlackText(workspaceName)}* workspace.`
          : `*${actor}* removed *${subject}* from the *${escapeSlackText(workspaceName)}* workspace.`,
        fallback: selfRemoved
          ? `${actorName} left the ${workspaceName} workspace`
          : `${actorName} removed ${entityName || 'a member'} from the ${workspaceName} workspace`,
        url: membersUrl,
        buttonText: 'View Members',
      })
    }

    // ── work sessions ────────────────────────────────────────────────────
    case 'work_session_started': {
      return message({
        heading: '▶️ Work Session Started',
        body: `*${actor}* logged in for work in *${escapeSlackText(workspaceName)}*.`,
        fallback: `${actorName} logged in for work`,
        url: workspaceUrl,
        buttonText: 'Open Workspace',
        style: 'primary',
      })
    }

    case 'work_session_ended': {
      return message({
        heading: '⏹️ Work Session Ended',
        body: `*${actor}* logged out from work in *${escapeSlackText(workspaceName)}*.`,
        fallback: `${actorName} logged out from work`,
        url: workspaceUrl,
        buttonText: 'Open Workspace',
      })
    }

    // ── Daily Report ─────────────────────────────────────────────────────
    // The one event whose message IS what it announces. Every other message
    // here describes a change and links to it; a Daily Report that only said
    // "your report is ready" made a reader open the app to find out whether
    // there was anything in it, which is the whole of what the report already
    // knows.
    //
    // So this carries the report's own opening paragraphs and its own figures,
    // read out of the stored row by the dispatcher (src/lib/dailyReportDigest.ts)
    // and repeated verbatim — nothing is summarised, recounted or regenerated
    // on the way to Slack. The rest of the report stays in OnTask, which is
    // what the button is for.
    case 'daily_report_ready': {
      const digest = payload.report ?? null
      const narration = digest?.paragraphs.length
        ? digest.paragraphs.map(escapeSlackText).join('\n\n')
        : null
      const factsText = digest?.facts.length ? digest.facts.join(' · ') : null
      const facts = factsText ? escapeSlackText(factsText) : null

      // A report with no stored narration still has its figures, and they are
      // worth a message on their own. With neither (a caller that has not read
      // the report at all) this stays the pointer it used to be rather than
      // inventing a sentence to fill the space.
      const body = narration ?? (facts ? `*${facts}*` : null)

      const blocks: unknown[] = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            // plain_text, so the workspace name goes in as it is written —
            // "Products & AI Solutions" keeps its ampersand. Clamped because
            // Slack rejects a header over 150 characters outright.
            text: clampHeader(`📊 Daily Report — ${workspaceName}`),
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              body ??
              `The Daily Report for *${escapeSlackText(workspaceName)}* is ready.`,
          },
        },
      ]
      // The figures sit under the prose, not inside it: the narration already
      // says what happened in words, and this is the same day in numbers.
      if (narration && facts) {
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: facts }],
        })
      }
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Full Daily Report',
              emoji: true,
            },
            url: reportUrl,
            style: 'primary',
          },
        ],
      })

      // The notification preview, which renders no blocks: it gets the opening
      // of the report rather than the fact that one exists.
      const preview = digest?.paragraphs[0] ?? factsText
      return {
        fallbackText: preview
          ? `[${workspaceName}] Daily Report: ${clampPreview(preview)}`
          : `[${workspaceName}] Daily Report is ready`,
        blocks,
      }
    }

    // The safety net, and nothing else. Every event type this product emits is
    // named above; this branch exists for one that has not been written yet,
    // and it is deliberately vague rather than confidently wrong — the
    // version of it that said "updated A task" for goals, files and
    // invitations alike is the bug this whole path was rebuilt to fix. It
    // names the entity it was actually given, and links where that entity
    // lives rather than assuming a task.
    default: {
      const named =
        entityName ??
        (entityType === 'work_session'
          ? 'work session'
          : taskId || entityType === undefined
            ? taskTitle
            : null)
      const where =
        entityType === 'goal'
          ? goalUrl
          : entityType === 'resource'
            ? resourcesUrl
            : entityType === 'workspace_member' || entityType === 'invitation'
              ? membersUrl
              : taskId
                ? taskUrl
                : workspaceUrl
      const describe = named ? `*${escapeSlackText(named)}*` : 'something'
      return message({
        heading: '',
        body: `*${actor}* made a change to ${describe} in *${escapeSlackText(workspaceName)}*.`,
        fallback: `${actorName} made a change to ${named ? `"${named}"` : 'something'} in ${workspaceName}`,
        url: where,
        goal: goalName,
      })
    }
  }
}

function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Slack's own limits, enforced here rather than discovered as an invalid_blocks
// error with nothing delivered: a header is 150 characters, and a notification
// preview longer than a line or two is truncated by the client anyway.
const HEADER_LIMIT = 150
const PREVIEW_LIMIT = 180

function clampHeader(text: string): string {
  return text.length <= HEADER_LIMIT
    ? text
    : `${text.slice(0, HEADER_LIMIT - 1).trimEnd()}…`
}

function clampPreview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= PREVIEW_LIMIT
    ? oneLine
    : `${oneLine.slice(0, PREVIEW_LIMIT - 1).trimEnd()}…`
}
