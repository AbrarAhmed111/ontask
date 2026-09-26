'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  WorkspaceSettingsSection,
  WorkspaceSettingsTab,
} from '@/components/workspaces/WorkspaceSettingsSection'
import { EditWorkspaceModal } from '@/components/workspaces/EditWorkspaceModal'
import { useWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import { useTour } from '@/components/tour/TourProvider'
import { useSettings } from '@/hooks/useSettings'
import { showSuccessToast } from '@/lib/toast'
import { TOURS, tourIdForWorkspace } from '@/lib/tour/definitions'
import { PERSONAL_WORKSPACE_PATH, workspacePath } from '@/lib/workspaces'

const SETTINGS_TABS: WorkspaceSettingsTab[] = [
  'workspace-settings',
  'reports-settings',
  'modules-settings',
  'integrations-settings',
  'preferences-settings',
  'guidance-settings',
]

function tabFromSearchParams(searchParams: {
  has: (key: string) => boolean
}): WorkspaceSettingsTab {
  return (
    SETTINGS_TABS.find(tab => searchParams.has(tab)) ?? 'workspace-settings'
  )
}

export function WorkspaceSettingsClient() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { requestReplay } = useTour()
  const { workspace, ready, isOwner, isPersonal, updateWorkspace } =
    useWorkspaceDetail()
  const { settings, ready: settingsReady, updateSettings } = useSettings()
  const [editing, setEditing] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [dailyReportsSaving, setDailyReportsSaving] = useState(false)
  const [modulesSaving, setModulesSaving] = useState(false)
  const activeTab = tabFromSearchParams(searchParams)

  const showTabInUrl = useCallback(
    (tab: WorkspaceSettingsTab) => {
      const next = new URLSearchParams(searchParams.toString())
      SETTINGS_TABS.forEach(key => next.delete(key))
      const preserved = next.toString()
      const query = preserved ? `${preserved}&${tab}` : tab
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      })
    },
    [pathname, router, searchParams],
  )

  useEffect(() => {
    if (SETTINGS_TABS.some(tab => searchParams.has(tab))) return
    showTabInUrl('workspace-settings')
  }, [searchParams, showTabInUrl])

  const handleTabChange = (tab: WorkspaceSettingsTab) => {
    showTabInUrl(tab)
  }

  const handleUpdateWorkspace: typeof updateWorkspace = async patch => {
    const result = await updateWorkspace(patch)
    if (result.success) {
      setSettingsError(null)
    } else {
      setSettingsError(result.error || 'Failed to save changes.')
    }
    return result
  }

  const handleDailyReportsChange = async (enabled: boolean) => {
    setDailyReportsSaving(true)
    const result = await handleUpdateWorkspace({ dailyReportsEnabled: enabled })
    setDailyReportsSaving(false)
    if (result.success) {
      showSuccessToast(
        enabled ? 'Daily Reports turned on.' : 'Daily Reports turned off.',
      )
    }
  }

  const handleDevelopmentChange = async (enabled: boolean) => {
    setModulesSaving(true)
    const result = await handleUpdateWorkspace({ developmentEnabled: enabled })
    setModulesSaving(false)
    if (result.success) {
      showSuccessToast(
        enabled ? 'Development turned on.' : 'Development turned off.',
      )
    }
  }

  // The tour points at the Overview, so replaying it means going there: the
  // request outlives this page and the Overview starts it once it has loaded.
  const tour = TOURS[tourIdForWorkspace(isPersonal ? 'personal' : 'shared')]
  const handleReplayTour = () => {
    if (!workspace) return
    requestReplay(tour.id)
    router.push(isPersonal ? PERSONAL_WORKSPACE_PATH : workspacePath(workspace))
  }

  // The Development tour runs on the Overview's Development section, which
  // shows sample data for it -- so it is offered even with the module off.
  const handleDevelopmentTour = () => {
    if (!workspace || isPersonal) return
    requestReplay('development')
    router.push(workspacePath(workspace))
  }

  return (
    <>
      <WorkspaceSettingsSection
        ready={ready}
        error={settingsError}
        workspace={workspace}
        isPersonal={isPersonal}
        canManage={isOwner}
        preferences={{
          ready: settingsReady,
          soundEnabled: settings.soundEnabled,
          onSoundEnabledChange: soundEnabled =>
            updateSettings({ soundEnabled }),
        }}
        dailyReports={{
          saving: dailyReportsSaving,
          onChange: handleDailyReportsChange,
        }}
        modules={{
          saving: modulesSaving,
          onDevelopmentChange: handleDevelopmentChange,
        }}
        guidance={{
          label: tour.label,
          onReplay: handleReplayTour,
          onDevelopmentTour: isPersonal ? undefined : handleDevelopmentTour,
        }}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onEdit={() => {
          setSettingsError(null)
          setEditing(true)
        }}
      />

      {editing && isOwner && workspace && (
        <EditWorkspaceModal
          workspace={workspace}
          isPersonal={isPersonal}
          onSave={handleUpdateWorkspace}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  )
}
