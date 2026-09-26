import { beforeEach, describe, expect, it, vi } from 'vitest'

// Every field the trigger sends has to be read off the body here, or it is
// dropped between Postgres and the dispatcher (0046's eventId bug). The
// Development Task details are the newest such field.
const dispatchSlackNotification = vi.fn()
vi.mock('@/lib/integrations/slack/slackDispatcher', () => ({
  dispatchSlackNotification: (...args: unknown[]) =>
    dispatchSlackNotification(...args),
}))

const { POST } = await import('./route')

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/integrations/slack/dispatch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  dispatchSlackNotification.mockReset()
  dispatchSlackNotification.mockResolvedValue({
    success: true,
    outcome: 'delivered',
  })
})

describe('POST /api/integrations/slack/dispatch', () => {
  it('passes a Development Task status change through whole', async () => {
    const development = {
      status: 'completed',
      workType: 'feature',
      branch: 'feature/google-oauth-abrar',
      repository: 'acme/ontask',
      prNumber: 142,
      prUrl: 'https://github.com/acme/ontask/pull/142',
      prTitle: 'Implement Google OAuth',
      baseBranch: 'main',
    }
    const response = await post({
      workspaceId: 'ws-a',
      eventType: 'development_status_changed',
      eventId: 'event-1',
      entityType: 'development_task',
      entityId: 'task-1',
      taskId: 'task-1',
      taskTitle: 'Implement Google OAuth',
      recipientUserIds: ['user-2'],
      development,
    })

    expect(response.status).toBe(200)
    expect(dispatchSlackNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'development_status_changed',
        eventId: 'event-1',
        entityType: 'development_task',
        recipientUserIds: ['user-2'],
        development,
      }),
    )
  })

  it('refuses a body without a workspace or event type', async () => {
    const response = await post({ eventType: 'completed' })
    expect(response.status).toBe(400)
    expect(dispatchSlackNotification).not.toHaveBeenCalled()
  })
})
