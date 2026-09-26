import { ReactNode } from 'react'
import {
  Bell,
  Blocks,
  CircleHelp,
  FileText,
  GitBranch,
  Plug,
  Settings2,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { PreferenceToggle } from '@/components/ui/PreferenceToggle'
import { Skeleton } from '@/components/ui/Skeleton'
import { formatTimeOfDay } from '@/lib/dailyReportWindow'
import { getWorkspaceTheme } from '@/lib/workspaceThemes'
import { PERSONAL_WORKSPACE_NAME } from '@/lib/workspaces'
import { Workspace } from '@/types/workspace'
import { SlackIntegrationCard } from '@/components/settings/SlackIntegrationCard'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { GithubIntegrationCard } from '@/components/settings/GithubIntegrationCard'

export type WorkspaceSettingsTab =
  | 'workspace-settings'
  | 'reports-settings'
  | 'modules-settings'
  | 'integrations-settings'
  | 'preferences-settings'
  | 'guidance-settings'

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(112px,0.8fr)_minmax(0,1fr)] items-center gap-4 px-5 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="min-w-0 truncate text-right text-xs font-bold text-ink">
        {value}
      </p>
    </div>
  )
}

function DetailBlock({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(112px,0.28fr)_minmax(0,1fr)] sm:gap-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="min-w-0 whitespace-pre-wrap break-words text-xs font-semibold leading-5 text-ink sm:text-right">
        {value}
      </p>
    </div>
  )
}

// The one Settings page for every workspace, personal or shared. Two things
// live here, and where each is saved is different:
//
//  - Workspace details (name, timezone, Daily Report time, accent): a property
//    of the workspace, stored on its row and shared by everyone in it. Only
//    the owner can edit them (`canManage`); everyone else sees them read-only.
//  - Your preferences (completion sound): a property of the person on this
//    device, kept in localStorage. Available to every member.
//
// Plus "Help & guidance", which replays this workspace's onboarding tour.
//
// The Daily Report switch is a property of the workspace too (owner only), but
// it is a plain on/off with an immediate effect, so it has its own card and
// saves on the spot rather than going through the Edit dialog.
//
// A personal workspace keeps its fixed name and has no description.
export function WorkspaceSettingsSection({
  ready,
  error,
  workspace,
  isPersonal = false,
  canManage,
  preferences,
  dailyReports,
  modules,
  guidance,
  activeTab = 'workspace-settings',
  onTabChange,
  onEdit,
}: {
  ready: boolean
  error?: string | null
  workspace: Workspace | null
  isPersonal?: boolean
  // Whether to offer editing the workspace itself (owner only).
  canManage: boolean
  preferences: {
    ready: boolean
    soundEnabled: boolean
    onSoundEnabledChange: (enabled: boolean) => void
  }
  // Replaying this workspace's onboarding tour. `label` names it ("Personal
  // Workspace tour"); omit `guidance` to leave the card out. `onDevelopmentTour`
  // adds the Development tour (shared workspaces only).
  guidance?: {
    label: string
    onReplay: () => void
    onDevelopmentTour?: () => void
  }
  // Turning the Daily Report on or off; omit to leave the card out.
  dailyReports?: { saving: boolean; onChange: (enabled: boolean) => void }
  // Switching optional modules (Development) on or off; shared workspaces
  // only. Omit to leave the card out.
  modules?: {
    saving: boolean
    onDevelopmentChange: (enabled: boolean) => void
  }
  activeTab?: WorkspaceSettingsTab
  onTabChange?: (tab: WorkspaceSettingsTab) => void
  onEdit: () => void
}) {
  const theme = getWorkspaceTheme(workspace?.accent)
  const tabs: {
    id: WorkspaceSettingsTab
    label: string
    icon: typeof Settings2
    visible: boolean
  }[] = [
    {
      id: 'workspace-settings',
      label: isPersonal ? 'Workspace' : 'Workspace',
      icon: Settings2,
      visible: true,
    },
    {
      id: 'reports-settings',
      label: 'Reports',
      icon: Sparkles,
      visible: Boolean(dailyReports && workspace),
    },
    {
      id: 'modules-settings',
      label: 'Modules',
      icon: Blocks,
      visible: Boolean(modules && !isPersonal && workspace),
    },
    {
      id: 'integrations-settings',
      label: 'Integrations',
      icon: Plug,
      visible: Boolean(!isPersonal && workspace),
    },
    {
      id: 'preferences-settings',
      label: 'Preferences',
      icon: SlidersHorizontal,
      visible: true,
    },
    {
      id: 'guidance-settings',
      label: 'Guidance',
      icon: CircleHelp,
      visible: Boolean(guidance),
    },
  ]
  const visibleTabs = tabs.filter(tab => tab.visible)
  const selectedTab = visibleTabs.some(tab => tab.id === activeTab)
    ? activeTab
    : 'workspace-settings'

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1 shadow-sm"
      >
        {visibleTabs.map(tab => {
          const Icon = tab.icon
          const selected = selectedTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onTabChange?.(tab.id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${
                selected
                  ? 'bg-[var(--ws-accent,#375b4b)] text-white shadow-sm'
                  : 'text-muted hover:bg-slate-100 hover:text-ink'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {selectedTab === 'workspace-settings' && (
        <SettingsCard
          icon={Settings2}
          title={
            isPersonal ? 'Personal Workspace settings' : 'Workspace details'
          }
          action={
            canManage && (
              <Button variant="secondary" onClick={onEdit} disabled={!ready}>
                Edit
              </Button>
            )
          }
        >
          {error && <ErrorBanner variant="flush">{error}</ErrorBanner>}
          {!ready || !workspace ? (
            <div className="space-y-4 px-5 py-4">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3.5 w-1/3" />
            </div>
          ) : (
            <div className="divide-y divide-line/70">
              <DetailRow
                label="Name"
                value={isPersonal ? PERSONAL_WORKSPACE_NAME : workspace.name}
              />
              {!isPersonal && (
                <DetailBlock
                  label="Description"
                  value={workspace.description || 'No description yet.'}
                />
              )}
              <DetailRow label="Timezone" value={workspace.timezone} />
              <DetailRow
                label="Daily Report time"
                value={formatTimeOfDay(workspace.reportTime ?? '12:00:00')}
              />
              <DetailRow
                label="Accent theme"
                value={
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      style={{ backgroundColor: theme.strong }}
                      className="h-3 w-3 rounded-full"
                    />
                    {theme.label}
                  </span>
                }
              />
            </div>
          )}
        </SettingsCard>
      )}

      {selectedTab === 'reports-settings' && dailyReports && workspace && (
        <SettingsCard icon={Sparkles} title="Daily Reports">
          <div className="space-y-3 px-5 py-4">
            <PreferenceToggle
              icon={FileText}
              title="AI Daily Report"
              description={`${
                isPersonal
                  ? 'A short written summary of your work,'
                  : 'A short written summary of what the workspace got done,'
              } generated each day at ${formatTimeOfDay(workspace.reportTime ?? '12:00:00')}.`}
              checked={workspace.dailyReportsEnabled}
              disabled={!ready || !canManage || dailyReports.saving}
              onChange={dailyReports.onChange}
            />
            <p className="text-[10px] leading-4 text-muted">
              {!canManage
                ? 'Only the workspace owner can change this.'
                : workspace.dailyReportsEnabled
                  ? 'Turning this off hides the Daily Report and stops new reports. Reports already written are kept.'
                  : 'Turn this on to start receiving a Daily Report. Reports already written are kept, and nothing is written for the time it was off.'}
            </p>
          </div>
        </SettingsCard>
      )}

      {selectedTab === 'modules-settings' &&
        modules &&
        !isPersonal &&
        workspace && (
          <SettingsCard icon={Blocks} title="Modules">
            <div className="space-y-3 px-5 py-4">
              <PreferenceToggle
                icon={GitBranch}
                title="Development"
                description="Development Tasks with generated branch names, tracked automatically through GitHub branches and Pull Requests."
                checked={workspace.developmentEnabled}
                disabled={!ready || !canManage || modules.saving}
                onChange={modules.onDevelopmentChange}
              />
              <p className="text-[10px] leading-4 text-muted">
                {!canManage
                  ? 'Only the workspace owner can change this.'
                  : workspace.developmentEnabled
                    ? 'Turning this off hides Development from the workspace. Development Tasks and their tracking are kept, and come back when it is turned on again.'
                    : 'Tasks, Goals, Resources, Activity and Notifications are always on.'}
              </p>
            </div>
          </SettingsCard>
        )}

      {selectedTab === 'integrations-settings' && !isPersonal && workspace && (
        <div className="grid gap-5 lg:grid-cols-2">
          {workspace.developmentEnabled && (
            <GithubIntegrationCard
              // Keyed by workspace: nothing it loaded for one workspace (a
              // repository list, a pending account choice) carries into another.
              key={workspace.id}
              workspaceId={workspace.id}
              canManage={canManage}
            />
          )}

          <SlackIntegrationCard
            workspaceId={workspace.id}
            canManage={canManage}
          />
        </div>
      )}

      {selectedTab === 'preferences-settings' && (
        <SettingsCard icon={SlidersHorizontal} title="Your preferences">
          <div className="space-y-3 px-5 py-4">
            <PreferenceToggle
              icon={Bell}
              title="Completion sound"
              description="Play a short sound when a task reaches its target."
              checked={preferences.soundEnabled}
              disabled={!preferences.ready}
              onChange={preferences.onSoundEnabledChange}
            />
            <p className="text-[10px] text-muted">
              Preferences are saved on this device.
            </p>
          </div>
        </SettingsCard>
      )}

      {selectedTab === 'guidance-settings' && guidance && (
        <SettingsCard icon={CircleHelp} title="Help & guidance">
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted">
              Take a quick look around this workspace again.
            </p>
            <Button
              variant="secondary"
              onClick={guidance.onReplay}
              disabled={!ready}
              className="shrink-0"
            >
              Replay {guidance.label}
            </Button>
          </div>
          {guidance.onDevelopmentTour && (
            <div className="flex flex-col gap-4 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <GitBranch
                  size={15}
                  className="mt-0.5 shrink-0 text-[var(--ws-accent,#375b4b)]"
                />
                <div>
                  <p className="text-xs font-bold text-ink">
                    Development Section guide
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">
                    See how a task follows its branch and Pull Request from
                    Queued to Completed, with sample data.
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={guidance.onDevelopmentTour}
                disabled={!ready}
                className="shrink-0"
              >
                Start Development tour
              </Button>
            </div>
          )}
        </SettingsCard>
      )}
    </div>
  )
}
