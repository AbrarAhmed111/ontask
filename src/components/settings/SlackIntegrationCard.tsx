'use client'

import { ReactNode, useEffect, useState } from 'react'
import { Check, Hash, Loader2, LogOut, RefreshCw } from 'lucide-react'
import Image from 'next/image'
import slackIcon from '@/assets/img/slack-icon.png'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Skeleton } from '@/components/ui/Skeleton'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SlackChannel } from '@/lib/integrations/slack/slackClient'
import type {
  SlackNotificationSettings,
  SlackPreferenceKey,
} from '@/lib/integrations/slack/slackEventCategories'

import { useOptionalWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'

const LINK_CLASS =
  'inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ws-accent,#375b4b)] hover:underline disabled:opacity-50'

// The key set lives with the dispatcher (slackEventCategories.ts) rather than
// here: a switch this card offers that the dispatcher does not read, or the
// other way round, is invisible from both sides.
export type { SlackNotificationSettings }

// Order is the order the panel scrolls through — roughly the order work
// happens in, then the workspace-level things.
const NOTIFICATION_TYPES: { key: SlackPreferenceKey; label: string }[] = [
  { key: 'created', label: 'Tasks & goal tasks created' },
  { key: 'assigned', label: 'Task assignments & reassignments' },
  { key: 'started', label: 'Task started, paused & resumed' },
  { key: 'completed', label: 'Task completions & reopens' },
  { key: 'deleted', label: 'Tasks & goal tasks deleted' },
  { key: 'notes', label: 'Notes added to tasks' },
  { key: 'goals', label: 'Goals created, completed & removed' },
  { key: 'blockers', label: 'Task blockers created' },
  { key: 'resolutions', label: 'Blocker resolutions & unblocks' },
  { key: 'mentions', label: 'Mentions in blockers' },
  { key: 'resources', label: 'Resources added, updated & removed' },
  { key: 'members', label: 'Invitations & membership changes' },
  { key: 'work_sessions', label: 'Work sessions started & ended' },
  { key: 'daily_reports', label: 'Daily Reports' },
]

const DEFAULT_NOTIFICATION_SETTINGS: SlackNotificationSettings =
  Object.fromEntries(
    NOTIFICATION_TYPES.map(({ key }) => [key, true]),
  ) as SlackNotificationSettings

export interface SlackStatusData {
  connected: boolean
  connection_status?:
    | 'connected'
    | 'disconnected'
    | 'invalid_token'
    | 'channel_missing'
    | 'configuration_incomplete'
    | string
  id?: string
  slack_team_id?: string
  slack_team_name?: string
  channel_id?: string
  channel_name?: string
  notification_settings?: SlackNotificationSettings
  can_manage?: boolean
}

function SlackLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Image
      src={slackIcon}
      alt=""
      width={20}
      height={20}
      className={className}
    />
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <div className="min-w-0 text-right text-xs font-bold text-ink">
        {children}
      </div>
    </div>
  )
}

export function SlackIntegrationCard({
  workspaceId,
  canManage,
  className = '',
}: {
  workspaceId: string
  canManage: boolean
  className?: string
}) {
  const detail = useOptionalWorkspaceDetail()

  // Local state fallbacks for testing outside context
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState<SlackStatusData | null>(null)
  const [localChannels, setLocalChannels] = useState<SlackChannel[]>([])

  const status = detail ? detail.slackStatus : localStatus
  const loading = detail ? detail.slackLoading : localLoading
  const error = localError || (detail ? detail.slackError : null)
  const channels = detail ? detail.slackChannels : localChannels
  const loadingChannels = detail ? detail.slackChannelsLoading : false

  // Channel selection and toggles state
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [settings, setSettings] = useState<SlackNotificationSettings>(
    DEFAULT_NOTIFICATION_SETTINGS,
  )
  const [saving, setSaving] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // Fallback fetch if rendered outside workspace detail context
  useEffect(() => {
    if (!detail && workspaceId) {
      let cancelled = false
      setLocalLoading(true)
      setLocalError(null)
      fetch(`/api/integrations/slack/status?workspace_id=${workspaceId}`)
        .then(res => {
          if (!res.ok) throw new Error('Failed to load Slack status.')
          return res.json()
        })
        .then((data: SlackStatusData) => {
          if (cancelled) return
          setLocalStatus(data)
          if (data.connected) {
            fetch(
              `/api/integrations/slack/channels?workspace_id=${workspaceId}`,
            )
              .then(res => res.json())
              .then(cData => {
                if (!cancelled) setLocalChannels(cData.channels || [])
              })
              .catch(() => {})
          }
        })
        .catch(err => {
          if (!cancelled)
            setLocalError(
              err instanceof Error ? err.message : 'Error fetching status',
            )
        })
        .finally(() => {
          if (!cancelled) setLocalLoading(false)
        })

      return () => {
        cancelled = true
      }
    }
  }, [detail, workspaceId])

  useEffect(() => {
    if (status?.connected) {
      setSelectedChannelId(status.channel_id || '')
      if (status.notification_settings) {
        // Merged over the defaults, so a connection stored before a category
        // existed saves back with every switch the panel showed rather than
        // dropping the ones it had no stored value for.
        setSettings({
          ...DEFAULT_NOTIFICATION_SETTINGS,
          ...status.notification_settings,
        })
      }
    }
  }, [status])

  const getAuthorizeUrl = () => {
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost:3000'
    return `${origin}/api/integrations/slack/oauth/authorize?workspace_id=${workspaceId}`
  }

  const handleConnect = () => {
    window.location.href = getAuthorizeUrl()
  }

  const handleSave = async () => {
    setSaving(true)
    setSavedSuccess(false)
    setLocalError(null)

    const selectedChannel = channels.find(c => c.id === selectedChannelId)
    const channelName = selectedChannel
      ? selectedChannel.name
      : status?.channel_name || ''

    if (detail) {
      const result = await detail.saveSlackSettings({
        channelId: selectedChannelId,
        channelName,
        notificationSettings: settings,
      })
      if (result.success) {
        setSavedSuccess(true)
        setTimeout(() => setSavedSuccess(false), 3000)
      } else if (result.error) {
        setLocalError(result.error)
      }
      setSaving(false)
    } else {
      try {
        const res = await fetch('/api/integrations/slack/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            channelId: selectedChannelId,
            channelName,
            notificationSettings: settings,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to save settings.')
        }

        setSavedSuccess(true)
        setTimeout(() => setSavedSuccess(false), 3000)
      } catch (err) {
        setLocalError(
          err instanceof Error ? err.message : 'Error saving settings',
        )
      } finally {
        setSaving(false)
      }
    }
  }

  const handleDisconnect = async () => {
    if (
      !confirm('Are you sure you want to disconnect Slack from this workspace?')
    )
      return
    setDisconnecting(true)
    setLocalError(null)

    if (detail) {
      const result = await detail.disconnectSlack()
      if (result.error) {
        setLocalError(result.error)
      }
      setDisconnecting(false)
    } else {
      try {
        const res = await fetch('/api/integrations/slack/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to disconnect Slack.')
        }

        setLocalStatus({ connected: false })
      } catch (err) {
        setLocalError(
          err instanceof Error ? err.message : 'Error disconnecting',
        )
      } finally {
        setDisconnecting(false)
      }
    }
  }

  const toggleSetting = (key: SlackPreferenceKey) => {
    // `=== false` rather than `!prev[key]`, so a key a stored connection has
    // never carried (it reads as on everywhere else) turns OFF on first click
    // instead of staying on.
    setSettings(prev => ({ ...prev, [key]: prev[key] === false }))
  }

  return (
    <SettingsCard
      iconNode={<SlackLogo className="h-[15px] w-[15px]" />}
      title="Slack"
      className={className}
      action={
        canManage &&
        status?.connected && (
          <Button
            variant="ghost"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="px-2.5 py-1.5 text-red-500 hover:bg-red-500/10 hover:text-red-600"
          >
            {disconnecting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <LogOut size={13} />
            )}
            Disconnect
          </Button>
        )
      }
    >
      {error && <ErrorBanner variant="flush">{error}</ErrorBanner>}

      {loading && !status ? (
        <div className="space-y-3 px-5 py-4">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      ) : !status?.connected ? (
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs leading-5 text-muted">
            Connect your Slack workspace to receive automatic OnTask
            notifications for task assignments, completions, blockers, and
            work-session updates directly inside your Slack channel.
          </p>
          {canManage ? (
            <button
              type="button"
              onClick={handleConnect}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#4A154B] px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#39103A]"
            >
              <SlackLogo className="h-4 w-4" />
              Add to Slack
            </button>
          ) : (
            <p className="text-[10px] text-muted">
              Only workspace owners and admins can connect Slack.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="divide-y divide-line/70">
            <Row label="Workspace">
              <span className="inline-flex min-w-0 items-center justify-end gap-1.5">
                <SlackLogo className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {status.slack_team_name || 'Slack Workspace'}
                </span>
              </span>
            </Row>
            <Row label="Channel">
              {status.channel_name ? (
                <span>#{status.channel_name}</span>
              ) : (
                <span className="font-normal text-muted">Not chosen yet</span>
              )}
            </Row>
            <Row label="Status">
              {status.connection_status === 'connected' ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <Check size={13} /> Connected
                </span>
              ) : (
                <span className="font-semibold text-amber-700">
                  {status.connection_status === 'invalid_token'
                    ? 'Authorization expired'
                    : status.connection_status === 'channel_missing'
                      ? 'Channel missing'
                      : status.connection_status === 'configuration_incomplete'
                        ? 'Choose a channel'
                        : 'Needs attention'}
                </span>
              )}
            </Row>
          </div>

          {canManage && (
            <div className="space-y-3 border-t border-line/70 px-5 py-4">
              {status.connection_status === 'invalid_token' && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800">
                  <span>Authorization expired or revoked.</span>
                  <button
                    type="button"
                    onClick={handleConnect}
                    className={LINK_CLASS}
                  >
                    <RefreshCw size={12} /> Reconnect
                  </button>
                </div>
              )}

              {status.connection_status === 'channel_missing' && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800">
                  Selected channel is no longer accessible. Choose a valid Slack
                  channel below.
                </p>
              )}

              {status.connection_status === 'configuration_incomplete' && (
                <p className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2.5 text-xs text-blue-800">
                  Slack is connected. Select a destination channel below to
                  activate notifications.
                </p>
              )}

              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs font-semibold tracking-tight text-ink">
                  <span className="flex items-center gap-1.5">
                    <Hash size={13} className="text-accent" />
                    Destination Channel
                  </span>
                  {loadingChannels && (
                    <span className="flex items-center gap-1 text-[10px] text-muted">
                      <Loader2 size={11} className="animate-spin" /> Fetching...
                    </span>
                  )}
                </label>
                <div className="relative flex items-center">
                  <div className="pointer-events-none absolute left-3 text-muted">
                    <Hash size={13} />
                  </div>
                  <select
                    value={selectedChannelId}
                    onChange={e => setSelectedChannelId(e.target.value)}
                    disabled={!canManage || loadingChannels}
                    className="w-full appearance-none rounded-xl border border-line bg-panel pl-8 pr-8 py-2 text-xs font-semibold text-ink shadow-xs transition-all hover:border-line-hover focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">-- Select a Slack channel --</option>
                    {channels.map(channel => (
                      <option key={channel.id} value={channel.id}>
                        #{channel.name} {channel.is_private ? '(private)' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute right-3 text-muted">
                    <svg
                      className="h-3.5 w-3.5 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                    </svg>
                  </div>
                </div>
                {status.channel_name && !selectedChannelId && (
                  <p className="text-[10px] text-muted">
                    Currently posting to{' '}
                    <span className="font-semibold text-ink">
                      #{status.channel_name}
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-ink">
                  Notification Types
                </p>
                <div className="max-h-[115px] overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-line scrollbar-track-transparent">
                  {NOTIFICATION_TYPES.map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 rounded-lg border border-line/50 px-2.5 py-1.5 text-xs text-ink hover:bg-subtle/40 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={settings[key] !== false}
                        onChange={() => toggleSetting(key)}
                        disabled={!canManage}
                        className="h-3.5 w-3.5 rounded border-line text-accent focus:ring-ring"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <Button
                variant="primary"
                onClick={handleSave}
                disabled={saving || !selectedChannelId}
                className="gap-2 text-xs py-1.5 px-3.5 shadow-xs"
              >
                {saving ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : savedSuccess ? (
                  <Check size={12} />
                ) : (
                  <RefreshCw size={12} />
                )}
                {savedSuccess ? 'Saved!' : 'Save Settings'}
              </Button>
            </div>
          )}
        </>
      )}
    </SettingsCard>
  )
}
