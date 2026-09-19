import { NextResponse } from 'next/server'
import { dispatchSlackNotification } from '@/lib/integrations/slack/slackDispatcher'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      workspaceId,
      eventType,
      // 0046 started sending the task_events row id as `eventId` so the
      // dispatcher's idempotency insert would finally run -- but this route
      // never read it off the body, so `if (eventId)` stayed false and a
      // repeated http_post still produced a repeated Slack message. Every
      // field the triggers send has to be destructured here or it is dropped
      // between Postgres and the dispatcher.
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
    } = body

    if (!workspaceId || !eventType) {
      return NextResponse.json(
        { error: 'workspaceId and eventType are required' },
        { status: 400 },
      )
    }

    const result = await dispatchSlackNotification({
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
    })

    return NextResponse.json(result)
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to dispatch Slack message'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
