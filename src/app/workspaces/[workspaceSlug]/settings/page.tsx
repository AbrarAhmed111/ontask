import { Suspense } from 'react'
import { WorkspaceSettingsClient } from '@/components/workspaces/WorkspaceSettingsClient'

export default function WorkspaceSettingsPage() {
  return (
    <Suspense fallback={null}>
      <WorkspaceSettingsClient />
    </Suspense>
  )
}
