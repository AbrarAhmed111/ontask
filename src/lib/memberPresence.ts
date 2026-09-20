import type { WorkSession, WorkspaceTask } from '@/types/workspace'

export type MemberPresenceKind =
  'offline' | 'online' | 'working' | 'blocked' | 'break'

export type MemberPresenceStatus = {
  kind: MemberPresenceKind
  label: string
  dot: 'none' | 'green' | 'yellow' | 'orange'
  hasWorkRing: boolean
  grayscale: boolean
  activeTask: WorkspaceTask | null
  session: WorkSession | null
}

export function resolveMemberPresenceStatus({
  online,
  session,
  activeTask,
}: {
  online: boolean
  session?: WorkSession | null
  activeTask?: WorkspaceTask | null
}): MemberPresenceStatus {
  if (!online) {
    return {
      kind: 'offline',
      label: 'Offline',
      dot: 'none',
      hasWorkRing: false,
      grayscale: true,
      activeTask: null,
      session: null,
    }
  }

  if (session && activeTask?.status === 'blocked') {
    return {
      kind: 'blocked',
      label: 'Working and blocked',
      dot: 'orange',
      hasWorkRing: true,
      grayscale: false,
      activeTask: activeTask ?? null,
      session,
    }
  }

  if (session?.status === 'break') {
    return {
      kind: 'break',
      label: 'On break',
      dot: 'yellow',
      hasWorkRing: true,
      grayscale: false,
      activeTask: activeTask ?? null,
      session,
    }
  }

  if (session) {
    return {
      kind: 'working',
      label: 'Working',
      dot: 'green',
      hasWorkRing: true,
      grayscale: false,
      activeTask: activeTask ?? null,
      session,
    }
  }

  return {
    kind: 'online',
    label: 'Online',
    dot: 'green',
    hasWorkRing: false,
    grayscale: false,
    activeTask: null,
    session: null,
  }
}

export function formatElapsedSeconds(seconds: number) {
  const clamped = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

export function workSessionElapsedSeconds(
  session: WorkSession,
  now = Date.now(),
) {
  const started = new Date(session.startedAt).getTime()
  if (!Number.isFinite(started)) return 0
  return Math.max(0, Math.floor((now - started) / 1000))
}

export function workSessionBreakSeconds(
  session: WorkSession,
  now = Date.now(),
) {
  const runningBreak =
    session.status === 'break' && session.currentBreakStartedAt
      ? Math.max(
          0,
          Math.floor(
            (now - new Date(session.currentBreakStartedAt).getTime()) / 1000,
          ),
        )
      : 0
  return Math.max(0, session.totalBreakSeconds + runningBreak)
}

export function workSessionActiveSeconds(
  session: WorkSession,
  now = Date.now(),
) {
  return Math.max(
    0,
    workSessionElapsedSeconds(session, now) -
      workSessionBreakSeconds(session, now),
  )
}
