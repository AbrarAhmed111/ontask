import { WorkspaceOverviewClient } from '@/components/workspaces/WorkspaceOverviewClient'
import { WorkspaceOverviewProviders } from '@/components/workspaces/WorkspaceOverviewProviders'

// Data-fetching for this page (tasks, the Daily Report) lives in
// the client component below, not the shared layout -- it's specific to the
// overview and would be wasted work on the Members/Settings pages. The same goes
// for what its task cards read from context (blockers, a notification's
// "show me this task" request), so that is mounted here too.
export default function WorkspaceOverviewPage() {
  return (
    <WorkspaceOverviewProviders>
      <WorkspaceOverviewClient />
    </WorkspaceOverviewProviders>
  )
}
