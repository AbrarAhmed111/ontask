'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWorkspaceSnapshot } from '@/hooks/useWorkspaceSnapshot'
import { useFetchStatus } from '@/hooks/useFetchStatus'
import { SNAPSHOTS } from '@/lib/cache/workspaceSnapshots'
import type { AuthUser } from '@/hooks/useAuth'
import type { SlackChannel } from '@/lib/integrations/slack/slackClient'
import type {
  SlackNotificationSettings,
  SlackStatusData,
} from '@/types/workspace'

export function useWorkspaceSlack(
  workspaceId: string,
  user: AuthUser | null,
  isPersonal = false,
) {
  const userId = user?.id
  const enabled = Boolean(userId && workspaceId && !isPersonal)

  const snapshot = useWorkspaceSnapshot<SlackStatusData | null>({
    userId: enabled ? userId : null,
    workspaceId,
    descriptor: SNAPSHOTS.slackStatus,
    initial: null,
  })

  const { data: status, setData: setStatus, confirm } = snapshot
  const [error, setError] = useState<string | null>(null)
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [loadingChannels, setLoadingChannels] = useState(false)

  const fetchKey = enabled ? `${userId}|${workspaceId}` : null
  const fetchStatus = useFetchStatus(snapshot, fetchKey, {
    load: '',
    refresh: '',
  })
  const { succeeded, failed } = fetchStatus

  const fetchSlackStatus = useCallback(async () => {
    if (!workspaceId || isPersonal || !userId) return
    setError(null)
    try {
      const res = await fetch(
        `/api/integrations/slack/status?workspace_id=${workspaceId}`,
      )
      if (!res.ok) {
        throw new Error('Failed to load Slack integration status.')
      }
      const data: SlackStatusData = await res.json()
      confirm(data)
      succeeded()
    } catch (err) {
      failed()
      setError(err instanceof Error ? err.message : 'Error fetching status')
    }
  }, [workspaceId, isPersonal, userId, confirm, succeeded, failed])

  const fetchChannels = useCallback(async () => {
    if (!workspaceId || isPersonal || !status?.connected) {
      setChannels([])
      return
    }
    setLoadingChannels(true)
    try {
      const res = await fetch(
        `/api/integrations/slack/channels?workspace_id=${workspaceId}`,
      )
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to fetch Slack channels.')
      }
      const data = await res.json()
      setChannels(data.channels || [])
    } catch (err) {
      console.error('[Slack UI] Failed to fetch channels:', err)
    } finally {
      setLoadingChannels(false)
    }
  }, [workspaceId, isPersonal, status?.connected])

  useEffect(() => {
    if (enabled && workspaceId) {
      void fetchSlackStatus()
    }
  }, [enabled, workspaceId, fetchSlackStatus])

  useEffect(() => {
    if (enabled && status?.connected) {
      void fetchChannels()
    }
  }, [enabled, status?.connected, fetchChannels])

  const saveSlackSettings = useCallback(
    async (params: {
      channelId: string
      channelName: string
      notificationSettings: SlackNotificationSettings
    }) => {
      if (!workspaceId)
        return { success: false as const, error: 'Workspace ID missing' }
      setError(null)
      try {
        const res = await fetch('/api/integrations/slack/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            channelId: params.channelId,
            channelName: params.channelName,
            notificationSettings: params.notificationSettings,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to save settings.')
        }

        const updatedStatus: SlackStatusData = {
          ...(status ?? { connected: true }),
          connected: true,
          channel_id: params.channelId,
          channel_name: params.channelName,
          notification_settings: params.notificationSettings,
          connection_status: 'connected',
        }
        confirm(updatedStatus)
        return { success: true as const }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Error saving settings'
        setError(message)
        return { success: false as const, error: message }
      }
    },
    [workspaceId, status, confirm],
  )

  const disconnectSlack = useCallback(async () => {
    if (!workspaceId)
      return { success: false as const, error: 'Workspace ID missing' }
    setError(null)
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

      const disconnectedStatus: SlackStatusData = {
        connected: false,
        connection_status: 'disconnected',
      }
      confirm(disconnectedStatus)
      setChannels([])
      return { success: true as const }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error disconnecting'
      setError(message)
      return { success: false as const, error: message }
    }
  }, [workspaceId, confirm])

  const updateSlackStatus = useCallback(
    (newStatus: SlackStatusData | null) => {
      confirm(newStatus)
    },
    [confirm],
  )

  return {
    slackStatus: enabled ? status : null,
    slackLoading: enabled ? !fetchStatus.ready : false,
    slackError: enabled ? error : null,
    channels: enabled ? channels : [],
    loadingChannels: enabled ? loadingChannels : false,
    refetchSlackStatus: fetchSlackStatus,
    refetchChannels: fetchChannels,
    updateSlackStatus,
    saveSlackSettings,
    disconnectSlack,
  }
}
