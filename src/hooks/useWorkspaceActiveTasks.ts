'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WorkspaceTaskRow, rowToTask } from '@/lib/tasks/workspaceMappers'
import type { AuthUser } from '@/hooks/useAuth'
import type { WorkspaceTask } from '@/types/workspace'

export function useWorkspaceActiveTasks(
  workspaceId: string,
  user: AuthUser | null,
) {
  const userId = user?.id
  const [tasks, setTasks] = useState<WorkspaceTask[]>([])

  useEffect(() => {
    if (!workspaceId || !userId) {
      setTasks([])
      return
    }
    let cancelled = false
    const supabase = createClient()

    const fetchTasks = () => {
      supabase
        .from('workspace_tasks')
        .select('*')
        .eq('workspace_id', workspaceId)
        .in('status', ['working', 'blocked'])
        .then(({ data }) => {
          if (!cancelled)
            setTasks(((data ?? []) as WorkspaceTaskRow[]).map(rowToTask))
        })
    }

    fetchTasks()
    const handleReconnect = () => fetchTasks()
    window.addEventListener('online', handleReconnect)

    const channel = supabase
      .channel(`workspace-active-tasks-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspace_tasks',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        payload => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string }).id
            if (id) setTasks(current => current.filter(task => task.id !== id))
            return
          }
          const task = rowToTask(payload.new as WorkspaceTaskRow)
          setTasks(current => {
            const rest = current.filter(row => row.id !== task.id)
            return task.status === 'working' || task.status === 'blocked'
              ? [...rest, task]
              : rest
          })
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      window.removeEventListener('online', handleReconnect)
      supabase.removeChannel(channel)
    }
  }, [workspaceId, userId])

  return useMemo(() => {
    const byUserId = new Map<string, WorkspaceTask>()
    tasks.forEach(task => {
      if (task.assignedTo && !byUserId.has(task.assignedTo)) {
        byUserId.set(task.assignedTo, task)
      }
    })
    return byUserId
  }, [tasks])
}
