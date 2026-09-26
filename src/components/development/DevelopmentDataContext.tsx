'use client'

import { createContext, ReactNode, useContext, useMemo } from 'react'
import { useWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import { useDevelopmentTasks } from '@/hooks/useDevelopmentTasks'
import { useWorkspaceGithub } from '@/hooks/useWorkspaceGithub'
import type { GithubConnection, TaskDevelopment } from '@/types/workspace'

type DevelopmentData = {
  // Whether the workspace has the Development module on (never in a personal
  // workspace). Off, nothing below is loaded.
  enabled: boolean
  development: ReturnType<typeof useDevelopmentTasks>
  github: ReturnType<typeof useWorkspaceGithub>
}

// What a task card needs: kept apart from the full data (which changes with
// every timer tick) so cards only re-render when a record actually changes.
type DevelopmentLookup = {
  byTaskId: Map<string, TaskDevelopment>
  connection: GithubConnection | null
}

const DevelopmentDataContext = createContext<DevelopmentData | null>(null)
const DevelopmentLookupContext = createContext<DevelopmentLookup | null>(null)

// The workspace's Development Tasks and GitHub connection, loaded once for the
// whole Overview: the Development section lists them, and every other task
// card (a Goal's tasks, the task list, Working now) uses the same records to
// mark which tasks are code work. One subscription, not one per reader.
export function DevelopmentDataProvider({ children }: { children: ReactNode }) {
  const { workspaceId, workspace, user, members, isPersonal } =
    useWorkspaceDetail()
  const enabled = Boolean(workspace?.developmentEnabled) && !isPersonal
  const development = useDevelopmentTasks(workspaceId, user, members, enabled)
  const github = useWorkspaceGithub(workspaceId, user?.id, enabled)
  const byTaskId = useMemo(
    () =>
      new Map(
        enabled
          ? development.items.map(item => [item.task.id, item.development])
          : [],
      ),
    [enabled, development.items],
  )

  const connection = github.connection
  const lookup = useMemo<DevelopmentLookup>(
    () => ({ byTaskId, connection }),
    [byTaskId, connection],
  )

  return (
    <DevelopmentDataContext.Provider value={{ enabled, development, github }}>
      <DevelopmentLookupContext.Provider value={lookup}>
        {children}
      </DevelopmentLookupContext.Provider>
    </DevelopmentDataContext.Provider>
  )
}

export function useDevelopmentData() {
  const value = useContext(DevelopmentDataContext)
  if (!value) {
    throw new Error(
      'useDevelopmentData must be used within a DevelopmentDataProvider',
    )
  }
  return value
}

// A task's development record, for a card that may render outside the
// Overview (or with the module off): null means "not a Development Task here".
export function useTaskDevelopment(taskId: string): {
  development: TaskDevelopment
  connection: GithubConnection | null
} | null {
  const value = useContext(DevelopmentLookupContext)
  const development = value?.byTaskId.get(taskId)
  if (!value || !development) return null
  return { development, connection: value.connection }
}
