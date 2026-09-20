'use client'

import { Avatar } from '@/components/ui/Avatar'
import {
  formatElapsedSeconds,
  resolveMemberPresenceStatus,
  workSessionActiveSeconds,
  workSessionBreakSeconds,
  workSessionElapsedSeconds,
} from '@/lib/memberPresence'
import type {
  WorkSession,
  WorkspaceMember,
  WorkspaceTask,
} from '@/types/workspace'

const DOT_CLASS = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  orange: 'bg-orange-500',
} as const

export function MemberPresenceAvatar({
  member,
  online,
  session,
  activeTask,
  className = 'h-8 w-8 text-[10px]',
  now = Date.now(),
}: {
  member: WorkspaceMember
  online: boolean
  session?: WorkSession | null
  activeTask?: WorkspaceTask | null
  className?: string
  now?: number
}) {
  const status = resolveMemberPresenceStatus({ online, session, activeTask })
  const name = member.fullName || member.email || 'Member'
  const lines = [name, status.label]
  if (status.session) {
    lines.push(
      status.kind === 'break'
        ? `Work session: ${formatElapsedSeconds(workSessionElapsedSeconds(status.session, now))}`
        : `Working for ${formatElapsedSeconds(workSessionActiveSeconds(status.session, now))}`,
    )
    if (status.kind === 'break' && status.session.currentBreakStartedAt) {
      lines.push(
        `Break: ${formatElapsedSeconds(workSessionBreakSeconds(status.session, now))}`,
      )
    }
    if (status.activeTask) {
      lines.push(
        `${status.kind === 'blocked' ? 'Blocked on' : 'Focused on'}: ${status.activeTask.name}`,
      )
    } else if (status.kind === 'working') {
      lines.push('No active task')
    }
  } else if (status.kind === 'online') {
    lines.push('Not currently working')
  }

  return (
    <span
      title={lines.join('\n')}
      aria-label={`${name} - ${status.label}`}
      className={`relative inline-block shrink-0 ${className}`}
    >
      <Avatar
        person={member}
        className={`h-full w-full border-2 transition ${
          status.hasWorkRing
            ? 'border-[var(--ws-accent,#375b4b)] p-[1px]'
            : 'border-paper'
        } ${status.grayscale ? 'grayscale' : ''}`}
      />
      {status.dot !== 'none' && (
        <span
          aria-hidden="true"
          className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-paper ${DOT_CLASS[status.dot]}`}
        />
      )}
    </span>
  )
}
