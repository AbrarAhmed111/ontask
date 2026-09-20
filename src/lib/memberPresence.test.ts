import { describe, expect, it } from 'vitest'
import {
  resolveMemberPresenceStatus,
  workSessionActiveSeconds,
  workSessionBreakSeconds,
} from '@/lib/memberPresence'
import type { WorkSession, WorkspaceTask } from '@/types/workspace'

const session: WorkSession = {
  id: 's-1',
  workspaceId: 'w-1',
  userId: 'u-1',
  status: 'working',
  startedAt: '2026-09-21T08:00:00.000Z',
  endedAt: null,
  currentBreakStartedAt: null,
  totalBreakSeconds: 0,
  createdAt: '2026-09-21T08:00:00.000Z',
  updatedAt: '2026-09-21T08:00:00.000Z',
}

const task: WorkspaceTask = {
  id: 't-1',
  workspaceId: 'w-1',
  parentTaskId: null,
  goalId: null,
  createdBy: 'u-1',
  assignedTo: 'u-1',
  name: 'Calendar Booking System',
  plannedMinutes: null,
  workedSeconds: 0,
  status: 'working',
  startedAt: null,
  completedAt: null,
}

describe('resolveMemberPresenceStatus', () => {
  it('shows offline first, without dot or work ring', () => {
    expect(
      resolveMemberPresenceStatus({ online: false, session, activeTask: task }),
    ).toMatchObject({
      kind: 'offline',
      dot: 'none',
      hasWorkRing: false,
      grayscale: true,
    })
  })

  it('keeps online separate from working', () => {
    expect(resolveMemberPresenceStatus({ online: true })).toMatchObject({
      kind: 'online',
      dot: 'green',
      hasWorkRing: false,
    })
  })

  it('adds a work ring for an active work session', () => {
    expect(
      resolveMemberPresenceStatus({ online: true, session }),
    ).toMatchObject({
      kind: 'working',
      dot: 'green',
      hasWorkRing: true,
    })
  })

  it('does not create a new visual state for a focused task', () => {
    expect(
      resolveMemberPresenceStatus({ online: true, session, activeTask: task }),
    ).toMatchObject({
      kind: 'working',
      dot: 'green',
      hasWorkRing: true,
      activeTask: task,
    })
  })

  it('uses orange for a blocked active task', () => {
    expect(
      resolveMemberPresenceStatus({
        online: true,
        session,
        activeTask: { ...task, status: 'blocked' },
      }),
    ).toMatchObject({
      kind: 'blocked',
      dot: 'orange',
      hasWorkRing: true,
    })
  })

  it('uses yellow while on break', () => {
    expect(
      resolveMemberPresenceStatus({
        online: true,
        session: {
          ...session,
          status: 'break',
          currentBreakStartedAt: '2026-09-21T09:00:00.000Z',
        },
      }),
    ).toMatchObject({
      kind: 'break',
      dot: 'yellow',
      hasWorkRing: true,
    })
  })
})

describe('work session durations', () => {
  it('subtracts completed and active break time from active work time', () => {
    const breaking: WorkSession = {
      ...session,
      status: 'break',
      currentBreakStartedAt: '2026-09-21T09:30:00.000Z',
      totalBreakSeconds: 600,
    }
    const now = new Date('2026-09-21T10:00:00.000Z').getTime()
    expect(workSessionBreakSeconds(breaking, now)).toBe(2400)
    expect(workSessionActiveSeconds(breaking, now)).toBe(4800)
  })
})
