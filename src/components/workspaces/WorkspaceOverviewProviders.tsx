'use client'

import { ReactNode, Suspense, useState } from 'react'
import { useWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import { WorkspaceBlockersProvider } from '@/components/workspaces/WorkspaceBlockersContext'
import { TaskNoteCountsProvider } from '@/components/workspaces/TaskNoteCountsContext'
import {
  FocusedTaskProvider,
  TaskFocus,
  TaskFocusFromUrl,
} from '@/components/workspaces/FocusedTaskContext'
import {
  FocusedReportProvider,
  ReportFocus,
  ReportFocusFromUrl,
} from '@/components/workspaces/FocusedReportContext'
import {
  FocusedGoalProvider,
  GoalFocus,
  GoalFocusFromUrl,
} from '@/components/workspaces/FocusedGoalContext'

// What the overview's task cards read from context. Both are specific to the
// overview — that is the only page with task cards — so, like the tasks, goals
// and Daily Reports it fetches for itself, they are mounted here rather than in the
// shared workspace layout, where the Members and Settings pages would pay for a
// realtime subscription they never use.
//
//   - the workspace's active blockers, fetched once and subscribed to live, so
//     any card (flat queue, a Goal's tasks, a subtask) can look up its own;
//     none at all for a personal workspace, which has nobody to wait on;
//   - every card's note count, read in batches over one realtime channel
//     rather than a request and a channel per card;
//   - a notification's request to bring one task into view (`?task=<id>`);
//   - a Slack Daily Report link's request to open the report (`?report=<id>`);
//   - a Slack "Open Goal" link's request to open one goal (`?goal=<id>`).
export function WorkspaceOverviewProviders({
  children,
}: {
  children: ReactNode
}) {
  const { workspaceId, user, isPersonal } = useWorkspaceDetail()
  const [taskFocus, setTaskFocus] = useState<TaskFocus | null>(null)
  const [reportFocus, setReportFocus] = useState<ReportFocus | null>(null)
  const [goalFocus, setGoalFocus] = useState<GoalFocus | null>(null)

  return (
    <WorkspaceBlockersProvider
      workspaceId={workspaceId}
      user={user}
      enabled={!isPersonal}
    >
      <TaskNoteCountsProvider workspaceId={workspaceId} userId={user?.id}>
        <FocusedTaskProvider value={taskFocus}>
          <FocusedReportProvider value={reportFocus}>
            <FocusedGoalProvider value={goalFocus}>
              {/* `useSearchParams` opts its nearest Suspense boundary out of static
              rendering, so it gets one of its own around a component that renders
              nothing. */}
              <Suspense fallback={null}>
                <TaskFocusFromUrl onFocus={setTaskFocus} />
              </Suspense>
              <Suspense fallback={null}>
                <ReportFocusFromUrl onFocus={setReportFocus} />
              </Suspense>
              <Suspense fallback={null}>
                <GoalFocusFromUrl onFocus={setGoalFocus} />
              </Suspense>
              {children}
            </FocusedGoalProvider>
          </FocusedReportProvider>
        </FocusedTaskProvider>
      </TaskNoteCountsProvider>
    </WorkspaceBlockersProvider>
  )
}
