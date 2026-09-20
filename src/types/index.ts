export type TaskStatus =
  'pending' | 'active' | 'paused' | 'completed' | 'skipped'

export type Task = {
  id: string
  name: string
  plannedMinutes: number
  workedSeconds: number
  status: TaskStatus
  // A free-text label + manual percent a member can track on any task —
  // unrelated to workspace Goals (src/types/workspace.ts's `Goal`), which is
  // a real hierarchical entity. Named distinctly to avoid confusion between
  // "set a progress label on this task" and "create a workspace Goal".
  progressLabel?: string
  progressPercentage?: number
  startedAt: number | null
  parentTaskId: string | null
}

export type TaskFormValues = {
  name: string
  description?: string
  hasPlannedTime?: boolean
  hours: string
  minutes: string
  goal: string
  progress: string
  trackGoal: boolean
  ideaId?: string
}

export type Settings = {
  dailyTargetMinutes: number
  soundEnabled: boolean
  autoStartNextTask: boolean
}
