import { FormEvent, useEffect, useRef, useState } from 'react'
import { loadTasks, saveTasks } from '@/lib/storage'
import { getLiveSeconds, useTimer } from '@/hooks/useTimer'
import { notifyTaskCompletion } from '@/lib/notifications'
import { shouldReopenOnExtend } from '@/lib/tasks/reopen'
import { Settings, Task, TaskFormValues } from '@/types'

export function useTasks(
  settings: Settings,
  onComplete?: (task: Task) => void,
) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [ready, setReady] = useState(false)
  const now = useTimer()
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    setTasks(loadTasks())
    setReady(true)
  }, [])

  useEffect(() => {
    if (ready) saveTasks(tasks)
  }, [ready, tasks])

  useEffect(() => {
    const active = tasks.find(task => task.status === 'active')
    if (
      !active ||
      active.plannedMinutes == null ||
      active.plannedMinutes <= 0 ||
      getLiveSeconds(active, now) < active.plannedMinutes * 60
    )
      return

    notifyTaskCompletion(active.name)
    onCompleteRef.current?.(active)
    setTasks(current => {
      const completed = current.map(task =>
        task.id === active.id
          ? {
              ...task,
              status: 'completed' as const,
              workedSeconds: Math.round(getLiveSeconds(task, now)),
              startedAt: null,
            }
          : task,
      )
      if (!settings.autoStartNextTask) return completed

      // Parents are containers, not runnable — never auto-start one even if
      // its own status still reads 'pending'.
      const next = completed.find(
        task =>
          (task.status === 'pending' || task.status === 'paused') &&
          !completed.some(t => t.parentTaskId === task.id),
      )
      return next
        ? completed.map(task =>
            task.id === next.id
              ? { ...task, status: 'active' as const, startedAt: Date.now() }
              : task,
          )
        : completed
    })
  }, [now, settings.autoStartNextTask, tasks])

  const updateTask = (id: string, update: Partial<Task>) => {
    setTasks(current =>
      current.map(task =>
        task.id === id
          ? {
              ...task,
              ...update,
              // More time on a completed task means it has work left: hand it
              // back as paused so it can be resumed.
              ...(shouldReopenOnExtend(task, update.plannedMinutes)
                ? { status: 'paused' as const, startedAt: null }
                : {}),
            }
          : task,
      ),
    )
  }

  // Parents are pure containers — they never carry their own running timer,
  // so starting one is a no-op rather than a crash if the UI ever lets it
  // through (it shouldn't: parent cards render no Start button).
  const startTask = (id: string) => {
    setTasks(current => {
      const isParent = current.some(task => task.parentTaskId === id)
      if (isParent) return current
      return current.map(task => {
        if (task.id === id)
          return { ...task, status: 'active', startedAt: Date.now() }
        if (task.status === 'active')
          return {
            ...task,
            status: 'paused',
            workedSeconds: Math.round(getLiveSeconds(task, now)),
            startedAt: null,
          }
        return task
      })
    })
  }

  const pauseTask = (task: Task) =>
    updateTask(task.id, {
      status: 'paused',
      workedSeconds: Math.round(getLiveSeconds(task, now)),
      startedAt: null,
    })

  const finishTask = (task: Task, early = false) => {
    updateTask(task.id, {
      status: early ? 'skipped' : 'completed',
      workedSeconds: Math.round(getLiveSeconds(task, now)),
      startedAt: null,
    })
  }

  const addTask = (
    event: FormEvent,
    form: TaskFormValues,
    parentTaskId: string | null = null,
  ) => {
    event.preventDefault()
    const plannedMinutes =
      Number(form.hours || 0) * 60 + Number(form.minutes || 0)
    if (!form.name.trim() || plannedMinutes < 0) return false
    setTasks(current => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: form.name.trim(),
        plannedMinutes,
        workedSeconds: 0,
        status: 'pending',
        startedAt: null,
        parentTaskId,
        progressLabel: form.trackGoal
          ? form.goal.trim() || undefined
          : undefined,
        progressPercentage: form.trackGoal
          ? Math.min(100, Math.max(0, Number(form.progress) || 0))
          : undefined,
      },
    ])
    return true
  }

  const deleteTask = (id: string) =>
    setTasks(current => current.filter(task => task.id !== id))

  const restartTask = (task: Task) =>
    setTasks(current => [
      ...current,
      {
        ...task,
        id: crypto.randomUUID(),
        workedSeconds: 0,
        status: 'pending',
        startedAt: null,
      },
    ])

  // A task can only move under a root task that isn't itself a child (one
  // level of nesting), and a task that currently has children of its own
  // can't become someone else's child. Passing null makes it standalone.
  const moveTask = (id: string, parentTaskId: string | null) => {
    setTasks(current => {
      if (id === parentTaskId) return current
      const hasChildren = current.some(task => task.parentTaskId === id)
      if (hasChildren && parentTaskId !== null) return current
      if (parentTaskId !== null) {
        const target = current.find(task => task.id === parentTaskId)
        if (!target || target.parentTaskId !== null) return current
      }
      return current.map(task =>
        task.id === id ? { ...task, parentTaskId } : task,
      )
    })
  }

  // Drag-reorder only applies among root-level cards (standalone tasks and
  // parent containers) — subtasks keep the order they were created in.
  // Child rows are left exactly where they are; only root-level slots swap.
  const reorderTasks = (fromIndex: number, toIndex: number) => {
    setTasks(current => {
      const rootIndices = current.reduce<number[]>((acc, task, index) => {
        if (!task.parentTaskId) acc.push(index)
        return acc
      }, [])
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= rootIndices.length ||
        toIndex >= rootIndices.length
      )
        return current

      const roots = rootIndices.map(index => current[index])
      const reorderedRoots = [...roots]
      const [movedTask] = reorderedRoots.splice(fromIndex, 1)
      reorderedRoots.splice(toIndex, 0, movedTask)

      const next = [...current]
      rootIndices.forEach((slot, i) => {
        next[slot] = reorderedRoots[i]
      })
      return next
    })
  }

  const activeTask = tasks.find(task => task.status === 'active')
  const totalSeconds = Math.round(
    tasks.reduce((total, task) => total + getLiveSeconds(task, now), 0),
  )

  return {
    tasks,
    ready,
    now,
    activeTask,
    totalSeconds,
    updateTask,
    startTask,
    pauseTask,
    finishTask,
    addTask,
    deleteTask,
    restartTask,
    moveTask,
    reorderTasks,
    getLiveSeconds: (task: Task) => getLiveSeconds(task, now),
  }
}
