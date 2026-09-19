'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  Hash,
  Loader2,
  LogOut,
  RefreshCw,
  Share2,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Skeleton } from '@/components/ui/Skeleton'
import { SlackChannel } from '@/lib/integrations/slack/slackClient'
import type {
  SlackNotificationSettings,
  SlackPreferenceKey,
} from '@/lib/integrations/slack/slackEventCategories'

import { useOptionalWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'

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
    <svg
      className={className}
      viewBox="0 0 122.8 122.8"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
        fill="#E01E5A"
      />
      <path
        d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
        fill="#36C5F0"
      />
      <path
        d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
        fill="#2EB67D"
      />
      <path
        d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
        fill="#ECB22E"
      />
    </svg>
  )
}

export function SlackIntegrationCard({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
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

  // Copy states for share section
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedEmbed, setCopiedEmbed] = useState(false)
  const [copiedMeta, setCopiedMeta] = useState(false)

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

  const getEmbedCode = () => {
    const authUrl = getAuthorizeUrl()
    return `<a href="${authUrl}"><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcSet="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>`
  }

  const getMetaTagCode = () => {
    return `<meta name="slack-app-id" content="${process.env.NEXT_PUBLIC_SLACK_CLIENT_ID || 'A00000000'}">`
  }

  const handleConnect = () => {
    window.location.href = getAuthorizeUrl()
  }

  const handleCopyShareUrl = () => {
    void navigator.clipboard.writeText(getAuthorizeUrl())
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2500)
  }

  const handleCopyEmbedCode = () => {
    void navigator.clipboard.writeText(getEmbedCode())
    setCopiedEmbed(true)
    setTimeout(() => setCopiedEmbed(false), 2500)
  }

  const handleCopyMetaTag = () => {
    void navigator.clipboard.writeText(getMetaTagCode())
    setCopiedMeta(true)
    setTimeout(() => setCopiedMeta(false), 2500)
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
    <div className="rounded-2xl border border-line bg-panel shadow-sm divide-y divide-line/70">
      {/* Card Header */}
      <div className="flex min-h-[52px] items-center justify-between px-5 py-3 shrink-0">
        <h2 className="flex items-center gap-2.5 text-sm font-bold tracking-tight text-ink">
          <SlackLogo className="h-5 w-5" /> Slack Integration
        </h2>
        {status?.connected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5 text-[11px] font-medium text-muted">
            Not Connected
          </span>
        )}
      </div>

      {error && <ErrorBanner variant="flush">{error}</ErrorBanner>}

      {loading && !status ? (
        <div className="space-y-3 px-5 py-5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-9 w-1/3" />
        </div>
      ) : (
        <div className="px-5 py-4">
          {/* Main Connection Status / Controls */}
          {!status?.connected ? (
            <div className="space-y-4">
              <p className="text-xs leading-5 text-muted">
                Connect your Slack workspace to receive automatic OnTask
                notifications for task assignments, completions, blockers, and
                Daily Reports directly inside your Slack channel.
              </p>

              {/* Feature highlights */}
              <div className="rounded-xl border border-line/60 bg-subtle/40 p-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink">
                  Integration Features
                </p>
                <ul className="space-y-1.5 text-[11px] text-muted">
                  <li className="flex items-center gap-2">
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                      ✓
                    </span>
                    <span>Real-time task assignment & status alerts</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                      ✓
                    </span>
                    <span>Automated Daily Team Activity Reports</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                      ✓
                    </span>
                    <span>Blocker creation & resolution notifications</span>
                  </li>
                </ul>
              </div>

              {canManage ? (
                <div className="pt-1">
                  {/* Official "Add to Slack" Button */}
                  <button
                    type="button"
                    onClick={handleConnect}
                    className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-[#4A154B] px-5 py-2.5 font-bold text-xs text-white shadow-xs transition-all hover:bg-[#39103A] hover:shadow-md active:scale-[0.99]"
                  >
                    <SlackLogo className="h-4.5 w-4.5" />
                    <span>Add to Slack</span>
                  </button>
                </div>
              ) : (
                <p className="text-[11px] italic text-muted">
                  Only workspace owners and admins can connect Slack.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3.5">
              {status.connection_status === 'invalid_token' && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3">
                  <span>
                    Authorization expired or revoked. Please reconnect Slack to
                    continue receiving updates.
                  </span>
                  {canManage && (
                    <Button
                      onClick={handleConnect}
                      className="shrink-0 text-xs py-1 px-2.5 bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      Reconnect
                    </Button>
                  )}
                </div>
              )}

              {status.connection_status === 'channel_missing' && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                  Selected channel is no longer accessible. Please choose a
                  valid Slack channel below.
                </div>
              )}

              {status.connection_status === 'configuration_incomplete' && (
                <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-2.5 text-xs text-blue-800 dark:text-blue-200">
                  Slack is connected! Select a destination channel below to
                  activate notifications.
                </div>
              )}

              <div className="flex items-center justify-between rounded-xl border border-line bg-subtle/50 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <SlackLogo className="h-5 w-5" />
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted">
                      Connected Workspace
                    </p>
                    <p className="text-xs font-bold text-ink">
                      {status.slack_team_name || 'Slack Workspace'}
                    </p>
                  </div>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="text-red-500 hover:bg-red-500/10 hover:text-red-600 gap-1 text-[11px] py-1 px-2"
                  >
                    {disconnecting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <LogOut size={12} />
                    )}
                    Disconnect
                  </Button>
                )}
              </div>

              {/* Channel Picker */}
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

              {/* Notification Preferences Toggles with Scrollbar */}
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
                        // A key a stored connection predates counts as on,
                        // matching the dispatcher's own `!== false`.
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

              {/* Save Action */}
              {canManage && (
                <div className="pt-1">
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}
