import {
  NotificationEntityType,
  NotificationType,
  NotificationWithWorkspace,
  WorkspaceType,
} from '@/types/workspace'
import {
  PERSONAL_WORKSPACE_NAME,
  PERSONAL_WORKSPACE_SLUG,
} from '@/lib/workspaces'

type EmbeddedWorkspace = {
  slug: string
  type: WorkspaceType
  name: string
  accent: string
}

export type NotificationRow = {
  id: string
  user_id: string
  workspace_id: string
  event_id: string | null
  goal_id: string | null
  notification_type: NotificationType
  entity_type: NotificationEntityType
  entity_id: string | null
  title: string
  body: string | null
  actor_id: string | null
  read_at: string | null
  created_at: string
  // Embedded via the workspaces(id) FK. Routing is entirely slug-based (never
  // workspace_id), so the slug is what a notification deep-links with; a
  // personal workspace is addressed by its alias, not its stored slug.
  workspaces: EmbeddedWorkspace | EmbeddedWorkspace[] | null
}

// Where a notification leads. Always its workspace; for one about a task, also
// that task, so the page can bring it into view (and open the Goal it's in);
// for a Daily Update mention, the Daily Updates page; for GitHub progress on a
// Development Task, that task opened in the Overview's Development section.
// Routing is slug-based -- the notification's workspaceSlug is already the
// personal alias for a personal workspace.
export function notificationHref(
  notification: Pick<
    NotificationWithWorkspace,
    'workspaceSlug' | 'entityType' | 'entityId'
  > &
    Partial<Pick<NotificationWithWorkspace, 'notificationType'>>,
): string {
  const base = `/workspaces/${notification.workspaceSlug}`
  // Being tagged in a Daily Update leads to the Daily Updates page.
  if (notification.entityType === 'daily_update') return `${base}/daily-updates`
  if (
    notification.notificationType?.startsWith('development_') &&
    notification.entityId
  ) {
    return `${base}?devtask=${encodeURIComponent(notification.entityId)}`
  }
  return notification.entityType === 'task' && notification.entityId
    ? `${base}?task=${encodeURIComponent(notification.entityId)}`
    : base
}

// null when the embed didn't resolve. The notifications policy requires
// current membership of the workspace (0034), and so does the workspaces
// policy the embed goes through -- so an unresolved workspace means the user
// isn't authorised to see it. Failing closed beats rendering a notification
// that can't say where it came from.
export function rowToNotification(
  row: NotificationRow,
): NotificationWithWorkspace | null {
  const workspace = Array.isArray(row.workspaces)
    ? row.workspaces[0]
    : row.workspaces
  if (!workspace) return null
  const personal = workspace.type === 'personal'
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    eventId: row.event_id,
    goalId: row.goal_id,
    notificationType: row.notification_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body,
    actorId: row.actor_id,
    readAt: row.read_at,
    createdAt: row.created_at,
    workspaceSlug: personal ? PERSONAL_WORKSPACE_SLUG : workspace.slug,
    workspaceName: personal ? PERSONAL_WORKSPACE_NAME : workspace.name,
    workspaceType: workspace.type,
    workspaceAccent: workspace.accent,
  }
}

export function rowsToNotifications(
  rows: NotificationRow[],
): NotificationWithWorkspace[] {
  return rows.flatMap(row => {
    const notification = rowToNotification(row)
    return notification ? [notification] : []
  })
}

// Which notifications a bell shows:
//   personal -> everything the user can see: their Personal Workspace's plus
//               every shared workspace they belong to
//   shared   -> only that one workspace's -- never another shared workspace's
export type NotificationScope =
  { kind: 'personal' } | { kind: 'shared'; workspaceId: string }

// null while a shared workspace's id hasn't resolved from its slug yet --
// there's nothing safe to show until it has.
export function notificationScopeFor({
  workspaceId,
  isPersonal,
}: {
  workspaceId: string
  isPersonal: boolean
}): NotificationScope | null {
  if (isPersonal) return { kind: 'personal' }
  return workspaceId ? { kind: 'shared', workspaceId } : null
}

export function isInScope(
  notification: Pick<NotificationWithWorkspace, 'workspaceId'>,
  scope: NotificationScope,
): boolean {
  return (
    scope.kind === 'personal' || notification.workspaceId === scope.workspaceId
  )
}

export type NotificationGroup = {
  workspaceId: string
  name: string
  type: WorkspaceType
  accent: string
  unreadCount: number
  notifications: NotificationWithWorkspace[]
}

const newestFirst = (
  a: Pick<NotificationWithWorkspace, 'createdAt'>,
  b: Pick<NotificationWithWorkspace, 'createdAt'>,
) => Date.parse(b.createdAt) - Date.parse(a.createdAt)

// One group per workspace for the Personal Workspace's combined panel: the
// Personal Workspace first, then shared workspaces by their most recent
// notification. Workspaces with nothing to show get no group.
export function groupNotificationsByWorkspace(
  notifications: NotificationWithWorkspace[],
): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>()
  for (const notification of notifications) {
    let group = groups.get(notification.workspaceId)
    if (!group) {
      group = {
        workspaceId: notification.workspaceId,
        name: notification.workspaceName,
        type: notification.workspaceType,
        accent: notification.workspaceAccent,
        unreadCount: 0,
        notifications: [],
      }
      groups.set(notification.workspaceId, group)
    }
    group.notifications.push(notification)
    if (!notification.readAt) group.unreadCount += 1
  }

  const result = [...groups.values()]
  for (const group of result) group.notifications.sort(newestFirst)
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'personal' ? -1 : 1
    return newestFirst(a.notifications[0], b.notifications[0])
  })
}
