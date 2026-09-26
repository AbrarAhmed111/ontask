import Link from 'next/link'
import { Bell, CheckCheck, Lock, Users } from 'lucide-react'
import { timeAgo } from '@/lib/time'
import { getWorkspaceTheme } from '@/lib/workspaceThemes'
import {
  groupNotificationsByWorkspace,
  notificationAction,
  notificationBody,
  notificationHref,
} from '@/lib/workspaceNotifications'
import { NotificationWithWorkspace, WorkspaceType } from '@/types/workspace'

function WorkspaceIcon({ type, size }: { type: WorkspaceType; size: number }) {
  const Icon = type === 'personal' ? Lock : Users
  return <Icon size={size} className="shrink-0" />
}

// The workspace a notification came from, in that workspace's own accent
// colour so it's recognisable at a glance.
function WorkspacePill({
  notification,
}: {
  notification: NotificationWithWorkspace
}) {
  const theme = getWorkspaceTheme(notification.workspaceAccent)
  return (
    <span
      style={{ backgroundColor: theme.soft, color: theme.strong }}
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
    >
      <WorkspaceIcon type={notification.workspaceType} size={10} />
      <span className="truncate">{notification.workspaceName}</span>
    </span>
  )
}

function NotificationItem({
  notification,
  showWorkspace,
  onMarkRead,
  onNavigate,
}: {
  notification: NotificationWithWorkspace
  showWorkspace: boolean
  onMarkRead: (id: string) => void
  onNavigate: () => void
}) {
  const unread = !notification.readAt
  const body = notificationBody(notification)
  const action = notificationAction(notification)
  return (
    <li className="animate-[slideInFade_260ms_ease-out]">
      <Link
        href={notificationHref(notification)}
        onClick={() => {
          if (unread) onMarkRead(notification.id)
          onNavigate()
        }}
        className={`block px-3.5 py-3 transition hover:bg-slate-50 ${unread ? 'bg-[var(--ws-accent-soft,#e9f0ec)]/40' : ''}`}
      >
        <div className="flex items-start gap-2">
          {unread && (
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-coral" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-ink">
              {notification.title}
            </p>
            {/* A blocker's body is the task, then its reason, one per line. */}
            {body && (
              <p className="mt-0.5 line-clamp-2 whitespace-pre-line break-words text-[11px] text-muted">
                {body}
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              {showWorkspace && <WorkspacePill notification={notification} />}
              <p className="shrink-0 text-[10px] text-muted">
                {timeAgo(notification.createdAt)}
              </p>
            </div>
          </div>
        </div>
      </Link>
      {/* A sibling of the main link, never inside it: links don't nest. */}
      {action && (
        <Link
          href={action.href}
          onClick={() => {
            if (unread) onMarkRead(notification.id)
            onNavigate()
          }}
          className="-mt-1.5 mb-2 ml-[26px] inline-block text-[11px] font-semibold text-[var(--ws-accent,#375b4b)] hover:underline"
        >
          {action.label}
        </Link>
      )}
    </li>
  )
}

// `groupByWorkspace` is the Personal Workspace's panel: notifications from
// several workspaces, grouped under each workspace's name, with the name
// repeated on every entry. A shared workspace's panel is one workspace, so it
// stays a flat list with no labels to repeat.
export function NotificationPanel({
  notifications,
  ready,
  unreadCount,
  groupByWorkspace,
  onMarkRead,
  onMarkAllRead,
  onNavigate,
}: {
  notifications: NotificationWithWorkspace[]
  ready: boolean
  unreadCount: number
  groupByWorkspace: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
  onNavigate: () => void
}) {
  return (
    <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-32px)] rounded-xl border border-line bg-panel shadow-xl animate-[fadeIn_150ms_ease-out]">
      <div className="flex items-center justify-between gap-3 border-b border-line/70 px-3.5 py-3">
        <p className="text-xs font-bold text-ink">Notifications</p>
        {unreadCount > 0 && (
          <button
            onClick={onMarkAllRead}
            className="flex items-center gap-1 text-[10px] font-semibold text-muted transition hover:text-ink"
          >
            <CheckCheck size={12} /> Mark all read
          </button>
        )}
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Bell size={18} className="mx-auto text-muted" />
            <p className="mt-2 text-[11px] text-muted">
              {ready ? 'You’re all caught up.' : 'Loading notifications…'}
            </p>
          </div>
        ) : groupByWorkspace ? (
          groupNotificationsByWorkspace(notifications).map(group => {
            const theme = getWorkspaceTheme(group.accent)
            return (
              <section key={group.workspaceId} aria-label={group.name}>
                <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line/70 bg-slate-50 px-3.5 py-1.5">
                  <span
                    style={{ color: theme.strong }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                  >
                    <WorkspaceIcon type={group.type} size={11} />
                    <span className="truncate">{group.name}</span>
                  </span>
                  {group.unreadCount > 0 && (
                    <span className="shrink-0 font-mono text-[9px] font-bold text-muted">
                      {group.unreadCount} new
                    </span>
                  )}
                </div>
                <ul className="divide-y divide-line/70 border-b border-line/70 last:border-b-0">
                  {group.notifications.map(notification => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      showWorkspace
                      onMarkRead={onMarkRead}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              </section>
            )
          })
        ) : (
          <ul className="divide-y divide-line/70">
            {notifications.map(notification => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                showWorkspace={false}
                onMarkRead={onMarkRead}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
