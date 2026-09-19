import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@/test/renderHook'
import { stubBrowser } from '@/test/fakeSupabase'
import { useWorkspaceSlack } from '@/hooks/useWorkspaceSlack'
import { clearAllCache } from '@/lib/cache/cacheStore'

const ME = 'user-me'
const userOf = (id: string) => ({
  id,
  email: `${id}@example.com`,
  fullName: id,
  avatarUrl: null,
})

describe('useWorkspaceSlack', () => {
  beforeEach(async () => {
    stubBrowser()
    await clearAllCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches Slack status on workspace load and stores it in state', async () => {
    const mockStatus = {
      connected: true,
      slack_team_name: 'Acme Corp',
      channel_id: 'C123',
      channel_name: 'general',
      notification_settings: {
        assigned: true,
        completed: true,
        blockers: true,
        resolutions: true,
        mentions: true,
        daily_reports: true,
      },
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: string | URL | Request) => {
        const urlString = url.toString()
        if (urlString.includes('/api/integrations/slack/status')) {
          return new Response(JSON.stringify(mockStatus), { status: 200 })
        }
        if (urlString.includes('/api/integrations/slack/channels')) {
          return new Response(
            JSON.stringify({ channels: [{ id: 'C123', name: 'general' }] }),
            { status: 200 },
          )
        }
        return new Response('Not found', { status: 404 })
      },
    )

    const { result } = renderHook(
      ({ wsId }) => useWorkspaceSlack(wsId, userOf(ME), false),
      { wsId: 'ws-1' },
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.slackStatus).toEqual(mockStatus)
    expect(result.current.slackStatus?.connected).toBe(true)
    expect(result.current.channels).toEqual([{ id: 'C123', name: 'general' }])
  })

  it('isolated per workspace: switching from Workspace A to Workspace B updates Slack state clean', async () => {
    const mockStatusA = {
      connected: true,
      slack_team_name: 'Team A',
      channel_id: 'C1',
      channel_name: 'team-a',
    }

    const mockStatusB = {
      connected: false,
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: string | URL | Request) => {
        const urlString = url.toString()
        if (urlString.includes('workspace_id=ws-a')) {
          return new Response(JSON.stringify(mockStatusA), { status: 200 })
        }
        if (urlString.includes('workspace_id=ws-b')) {
          return new Response(JSON.stringify(mockStatusB), { status: 200 })
        }
        return new Response(JSON.stringify({ channels: [] }), { status: 200 })
      },
    )

    const { result, rerender } = renderHook(
      ({ wsId }) => useWorkspaceSlack(wsId, userOf(ME), false),
      { wsId: 'ws-a' },
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.slackStatus?.slack_team_name).toBe('Team A')

    rerender({ wsId: 'ws-b' })

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.slackStatus?.connected).toBe(false)
    expect(result.current.slackStatus?.slack_team_name).toBeUndefined()
  })

  it('saveSlackSettings updates workspace Slack state directly', async () => {
    const mockStatus = {
      connected: true,
      slack_team_name: 'Acme',
      channel_id: 'C1',
      channel_name: 'general',
      notification_settings: {
        assigned: true,
        completed: true,
        blockers: true,
        resolutions: true,
        mentions: true,
        daily_reports: true,
      },
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: string | URL | Request) => {
        const urlString = url.toString()
        if (urlString.includes('/api/integrations/slack/status')) {
          return new Response(JSON.stringify(mockStatus), { status: 200 })
        }
        if (urlString.includes('/api/integrations/slack/channels')) {
          return new Response(JSON.stringify({ channels: [] }), { status: 200 })
        }
        if (urlString.includes('/api/integrations/slack/settings')) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
          })
        }
        return new Response('Not found', { status: 404 })
      },
    )

    const { result } = renderHook(
      ({ wsId }) => useWorkspaceSlack(wsId, userOf(ME), false),
      { wsId: 'ws-1' },
    )

    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      const res = await result.current.saveSlackSettings({
        channelId: 'C2',
        channelName: 'project-updates',
        notificationSettings: mockStatus.notification_settings,
      })
      expect(res.success).toBe(true)
    })

    expect(result.current.slackStatus?.channel_id).toBe('C2')
    expect(result.current.slackStatus?.channel_name).toBe('project-updates')
  })

  it('disconnectSlack updates workspace Slack status to disconnected', async () => {
    const mockStatus = {
      connected: true,
      slack_team_name: 'Acme',
      channel_id: 'C1',
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: string | URL | Request) => {
        const urlString = url.toString()
        if (urlString.includes('/api/integrations/slack/status')) {
          return new Response(JSON.stringify(mockStatus), { status: 200 })
        }
        if (urlString.includes('/api/integrations/slack/disconnect')) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
          })
        }
        return new Response(JSON.stringify({ channels: [] }), { status: 200 })
      },
    )

    const { result } = renderHook(
      ({ wsId }) => useWorkspaceSlack(wsId, userOf(ME), false),
      { wsId: 'ws-1' },
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.slackStatus?.connected).toBe(true)

    await act(async () => {
      const res = await result.current.disconnectSlack()
      expect(res.success).toBe(true)
    })

    expect(result.current.slackStatus?.connected).toBe(false)
  })

  it('is disabled for personal workspace', async () => {
    const { result } = renderHook(
      ({ wsId }) => useWorkspaceSlack(wsId, userOf(ME), true),
      { wsId: 'ws-personal' },
    )

    expect(result.current.slackStatus).toBeNull()
    expect(result.current.slackLoading).toBe(false)
  })
})
