import { describe, expect, it } from 'vitest'
import {
  NotificationRow,
  groupNotificationsByWorkspace,
  isInScope,
  notificationHref,
  notificationScopeFor,
  rowToNotification,
  rowsToNotifications,
} from '@/lib/workspaceNotifications'
import { NotificationWithWorkspace } from '@/types/workspace'

const row = (overrides: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 'n-1',
  user_id: 'user-1',
  workspace_id: 'ws-alpha',
  event_id: null,
  goal_id: null,
  notification_type: 'assigned',
  entity_type: 'task',
  entity_id: 'task-1',
  title: 'You were assigned a task',
  body: 'Ship it',
  actor_id: 'user-2',
  read_at: null,
  created_at: '2026-01-01T10:00:00Z',
  workspaces: {
    slug: 'team-alpha',
    type: 'shared',
    name: 'Team Alpha',
    accent: 'ocean',
  },
  ...overrides,
})

const notification = (
  overrides: Partial<NotificationWithWorkspace> = {},
): NotificationWithWorkspace => ({
  id: 'n-1',
  userId: 'user-1',
  workspaceId: 'ws-alpha',
  eventId: null,
  goalId: null,
  notificationType: 'assigned',
  entityType: 'task',
  entityId: null,
  title: 'A notification',
  body: null,
  actorId: null,
  readAt: null,
  createdAt: '2026-01-01T10:00:00Z',
  workspaceSlug: 'team-alpha',
  workspaceName: 'Team Alpha',
  workspaceType: 'shared',
  workspaceAccent: 'ocean',
  ...overrides,
})

describe('rowToNotification', () => {
  it('carries the originating workspace onto a shared notification', () => {
    expect(rowToNotification(row())).toMatchObject({
      id: 'n-1',
      workspaceId: 'ws-alpha',
      workspaceSlug: 'team-alpha',
      workspaceName: 'Team Alpha',
      workspaceType: 'shared',
      workspaceAccent: 'ocean',
      readAt: null,
    })
  })

  it('names a personal workspace by its alias and label, not its stored slug/name', () => {
    const result = rowToNotification(
      row({
        workspace_id: 'ws-personal',
        workspaces: {
          slug: 'personal-0f3c9a2b7d1e4c5a8b6d9e0f1a2b3c4d',
          type: 'personal',
          name: 'whatever the row says',
          accent: 'forest',
        },
      }),
    )
    expect(result).toMatchObject({
      workspaceSlug: 'personal-workspace',
      workspaceName: 'Personal Workspace',
      workspaceType: 'personal',
    })
  })

  it('accepts the embed as a one-element array (PostgREST can return either)', () => {
    const result = rowToNotification(
      row({
        workspaces: [
          {
            slug: 'team-alpha',
            type: 'shared',
            name: 'Team Alpha',
            accent: 'ocean',
          },
        ],
      }),
    )
    expect(result?.workspaceName).toBe('Team Alpha')
  })

  it('carries a timer_stopped notification through with its task and the owner who stopped it', () => {
    const result = rowToNotification(
      row({
        notification_type: 'timer_stopped',
        entity_type: 'task',
        entity_id: 'task-9',
        title: 'The workspace owner stopped your timer',
        body: 'Design the homepage',
        actor_id: 'owner-1',
      }),
    )
    expect(result).toMatchObject({
      notificationType: 'timer_stopped',
      entityType: 'task',
      entityId: 'task-9',
      body: 'Design the homepage',
      actorId: 'owner-1',
      workspaceSlug: 'team-alpha',
    })
  })

  it('carries a blocker mention through with its task, the person who asked and its workspace', () => {
    const result = rowToNotification(
      row({
        notification_type: 'blocker_mention',
        entity_type: 'task',
        entity_id: 'task-7',
        title: 'Abrar Ahmed mentioned you in a blocker',
        body: 'Student API\nWaiting for API credentials from @Araysh.',
        actor_id: 'user-abrar',
        user_id: 'user-araysh',
      }),
    )
    expect(result).toMatchObject({
      notificationType: 'blocker_mention',
      entityType: 'task',
      entityId: 'task-7',
      actorId: 'user-abrar',
      userId: 'user-araysh',
      workspaceId: 'ws-alpha',
      workspaceName: 'Team Alpha',
      workspaceSlug: 'team-alpha',
      readAt: null,
    })
  })

  it('carries a blocker resolution through the same way', () => {
    expect(
      rowToNotification(
        row({
          notification_type: 'blocker_resolved',
          entity_id: 'task-7',
          title: 'Araysh resolved a blocker on your task',
        }),
      ),
    ).toMatchObject({
      notificationType: 'blocker_resolved',
      entityId: 'task-7',
    })
  })

  it('drops a notification whose workspace did not resolve, rather than showing it unlabelled', () => {
    expect(rowToNotification(row({ workspaces: null }))).toBeNull()
    expect(
      rowsToNotifications([
        row({ id: 'kept' }),
        row({ id: 'gone', workspaces: null }),
      ]).map(n => n.id),
    ).toEqual(['kept'])
  })
})

describe('notificationHref', () => {
  it('opens the workspace and the task a task notification is about', () => {
    expect(
      notificationHref(
        notification({ entityType: 'task', entityId: 'task-7' }),
      ),
    ).toBe('/workspaces/team-alpha?task=task-7')
  })

  it('opens just the workspace when the notification is not about a task', () => {
    expect(
      notificationHref(
        notification({ entityType: 'workspace', entityId: null }),
      ),
    ).toBe('/workspaces/team-alpha')
    expect(
      notificationHref(notification({ entityType: 'task', entityId: null })),
    ).toBe('/workspaces/team-alpha')
  })

  it('uses the personal alias for a notification that belongs to the personal workspace', () => {
    const personal = rowToNotification(
      row({
        entity_id: 'task-3',
        workspaces: {
          slug: 'stored-slug-123',
          type: 'personal',
          name: 'stored name',
          accent: 'forest',
        },
      }),
    )!
    expect(notificationHref(personal)).toBe(
      '/workspaces/personal-workspace?task=task-3',
    )
  })

  it('encodes the id so it cannot break out of the query', () => {
    expect(
      notificationHref(
        notification({ entityType: 'task', entityId: 'a&b=c#d' }),
      ),
    ).toBe('/workspaces/team-alpha?task=a%26b%3Dc%23d')
  })

  it('opens the Daily Updates page for a Daily Update mention', () => {
    expect(
      notificationHref(
        notification({
          notificationType: 'daily_update_mention',
          entityType: 'daily_update',
          entityId: 'update-1',
        }),
      ),
    ).toBe('/workspaces/team-alpha/daily-updates')
  })

  it('carries a Daily Update mention through with who asked and where', () => {
    const mention = rowToNotification(
      row({
        notification_type: 'daily_update_mention',
        entity_type: 'daily_update',
        entity_id: 'update-1',
        title: 'Abrar Ahmed mentioned you in a Daily Update',
        body: 'Waiting for Stripe credentials from @Iqra Nadeem',
      }),
    )!
    expect(mention.notificationType).toBe('daily_update_mention')
    expect(mention.entityType).toBe('daily_update')
    expect(mention.workspaceSlug).toBe('team-alpha')
    expect(notificationHref(mention)).toBe(
      '/workspaces/team-alpha/daily-updates',
    )
  })
})

describe('notificationScopeFor', () => {
  it('is personal for the Personal Workspace, whatever the workspace id', () => {
    expect(notificationScopeFor({ workspaceId: '', isPersonal: true })).toEqual(
      {
        kind: 'personal',
      },
    )
    expect(
      notificationScopeFor({ workspaceId: 'ws-personal', isPersonal: true }),
    ).toEqual({ kind: 'personal' })
  })

  it('is one workspace for a shared workspace', () => {
    expect(
      notificationScopeFor({ workspaceId: 'ws-alpha', isPersonal: false }),
    ).toEqual({ kind: 'shared', workspaceId: 'ws-alpha' })
  })

  it('is null for a shared workspace that has not resolved yet', () => {
    expect(
      notificationScopeFor({ workspaceId: '', isPersonal: false }),
    ).toBeNull()
  })
})

describe('isInScope', () => {
  const alpha = notification({ workspaceId: 'ws-alpha' })
  const beta = notification({ workspaceId: 'ws-beta' })
  const personal = notification({
    workspaceId: 'ws-personal',
    workspaceType: 'personal',
  })

  it('a shared workspace only sees its own notifications', () => {
    const scope = { kind: 'shared', workspaceId: 'ws-alpha' } as const
    expect(isInScope(alpha, scope)).toBe(true)
    expect(isInScope(beta, scope)).toBe(false)
    expect(isInScope(personal, scope)).toBe(false)
  })

  it('the Personal Workspace sees its own and every shared workspace’s', () => {
    const scope = { kind: 'personal' } as const
    expect([alpha, beta, personal].every(n => isInScope(n, scope))).toBe(true)
  })

  it('two shared workspaces never see each other’s notifications', () => {
    const scopeA = { kind: 'shared', workspaceId: 'ws-alpha' } as const
    const scopeB = { kind: 'shared', workspaceId: 'ws-beta' } as const
    const all = [alpha, beta]
    expect(all.filter(n => isInScope(n, scopeA))).toEqual([alpha])
    expect(all.filter(n => isInScope(n, scopeB))).toEqual([beta])
  })
})

describe('groupNotificationsByWorkspace', () => {
  const personal = (
    id: string,
    createdAt: string,
    readAt: string | null = null,
  ) =>
    notification({
      id,
      createdAt,
      readAt,
      workspaceId: 'ws-personal',
      workspaceType: 'personal',
      workspaceName: 'Personal Workspace',
      workspaceSlug: 'personal-workspace',
      workspaceAccent: 'forest',
    })
  const shared = (
    id: string,
    workspaceId: string,
    workspaceName: string,
    createdAt: string,
    readAt: string | null = null,
  ) => notification({ id, workspaceId, workspaceName, createdAt, readAt })

  it('puts the Personal Workspace first, then shared workspaces by most recent activity', () => {
    const groups = groupNotificationsByWorkspace([
      shared('a1', 'ws-devabby', 'DevAbby Project', '2026-01-01T09:00:00Z'),
      shared('s1', 'ws-school', 'School Management', '2026-01-01T09:30:00Z'),
      personal('p1', '2026-01-01T08:00:00Z'),
    ])
    expect(groups.map(g => g.name)).toEqual([
      'Personal Workspace',
      'School Management',
      'DevAbby Project',
    ])
  })

  it('keeps each workspace’s notifications together, newest first', () => {
    const [group] = groupNotificationsByWorkspace([
      shared('old', 'ws-devabby', 'DevAbby Project', '2026-01-01T08:00:00Z'),
      shared('new', 'ws-devabby', 'DevAbby Project', '2026-01-01T09:00:00Z'),
    ])
    expect(group.notifications.map(n => n.id)).toEqual(['new', 'old'])
  })

  it('never merges two shared workspaces, even with the same name', () => {
    const groups = groupNotificationsByWorkspace([
      shared('a', 'ws-1', 'Project', '2026-01-01T09:00:00Z'),
      shared('b', 'ws-2', 'Project', '2026-01-01T08:00:00Z'),
    ])
    expect(groups).toHaveLength(2)
  })

  it('counts unread per workspace', () => {
    const [group] = groupNotificationsByWorkspace([
      shared('u', 'ws-1', 'Project', '2026-01-01T09:00:00Z'),
      shared(
        'r',
        'ws-1',
        'Project',
        '2026-01-01T08:00:00Z',
        '2026-01-01T09:30:00Z',
      ),
    ])
    expect(group.unreadCount).toBe(1)
  })

  it('has no group for a workspace with no notifications', () => {
    expect(groupNotificationsByWorkspace([])).toEqual([])
    const groups = groupNotificationsByWorkspace([
      shared('s1', 'ws-school', 'School Management', '2026-01-01T09:30:00Z'),
    ])
    expect(groups.map(g => g.name)).toEqual(['School Management'])
  })
})
