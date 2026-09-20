import { useState } from 'react'
import { Archive, CirclePlus, Target } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Skeleton } from '@/components/ui/Skeleton'
import { GoalCard } from '@/components/goals/GoalCard'
import { tourAnchor } from '@/lib/tourAnchors'
import { Goal, Idea, WorkspaceMember, WorkspaceTask } from '@/types/workspace'
import type { AuthUser } from '@/hooks/useAuth'

export function WorkspaceGoalsSection({
  ready,
  error,
  goals,
  workspaceId,
  isPersonal,
  soundEnabled,
  user,
  members,
  updateGoal,
  setGoalStatus,
  deleteGoal,
  onWorkingTasksChange,
  onBlockedTasksChange,
  onAddGoal,
  ideas,
}: {
  ready: boolean
  error?: string | null
  goals: Goal[]
  workspaceId: string
  // Which kind of workspace these goals are in — a personal one has nobody to
  // assign a goal's tasks to. Passed down to each GoalCard.
  isPersonal: boolean
  // The user's completion-sound preference, applied to every goal task's
  // "finished" alarm.
  soundEnabled: boolean
  user: AuthUser | null
  members: WorkspaceMember[]
  updateGoal: (
    id: string,
    update: Partial<
      Pick<Goal, 'name' | 'description' | 'targetDate' | 'status' | 'ideaId'>
    >,
  ) => void
  setGoalStatus: (id: string, status: Goal['status']) => void
  deleteGoal?: (id: string) => void
  onWorkingTasksChange: (goalId: string, tasks: WorkspaceTask[]) => void
  // The goal's blocked tasks, for the overview's "Blocked" panel.
  onBlockedTasksChange?: (goalId: string, tasks: WorkspaceTask[]) => void
  onAddGoal: () => void
  ideas?: Idea[]
}) {
  const [showArchived, setShowArchived] = useState(false)
  const archivedCount = goals.filter(goal => goal.status === 'archived').length
  const visibleGoals = goals.filter(goal =>
    showArchived ? goal.status === 'archived' : goal.status !== 'archived',
  )

  return (
    <div {...tourAnchor('goals')}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink">
          <Target size={15} className="text-[var(--ws-accent,#375b4b)]" />
          Goals
        </h2>
        <div className="flex items-center gap-3">
          {(archivedCount > 0 || showArchived) && (
            <button
              onClick={() => setShowArchived(open => !open)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-muted transition hover:text-ink"
            >
              <Archive size={12} />
              {showArchived ? 'Show active' : `${archivedCount} archived`}
            </button>
          )}
          <Button onClick={onAddGoal}>
            <CirclePlus size={15} /> New goal
          </Button>
        </div>
      </div>

      {ready && error && <ErrorBanner className="mb-4">{error}</ErrorBanner>}

      {!ready ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
        </div>
      ) : visibleGoals.length === 0 ? (
        <EmptyState
          icon={Target}
          title={showArchived ? 'No archived goals' : 'No goals yet'}
        >
          {showArchived ? (
            <div className="mt-2">
              <Button
                variant="secondary"
                className="text-xs"
                onClick={() => setShowArchived(false)}
              >
                Show active goals
              </Button>
            </div>
          ) : (
            'Goals group related tasks and subtasks toward a bigger outcome — create one when work needs more structure than a single task.'
          )}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {visibleGoals.map(goal => (
            <GoalCard
              key={goal.id}
              goal={goal}
              workspaceId={workspaceId}
              isPersonal={isPersonal}
              soundEnabled={soundEnabled}
              user={user}
              members={members}
              updateGoal={updateGoal}
              setGoalStatus={setGoalStatus}
              deleteGoal={deleteGoal}
              onWorkingTasksChange={onWorkingTasksChange}
              onBlockedTasksChange={onBlockedTasksChange}
              ideas={ideas}
            />
          ))}
        </div>
      )}
    </div>
  )
}
