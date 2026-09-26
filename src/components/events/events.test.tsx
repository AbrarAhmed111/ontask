import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { UpcomingEventView } from '@/components/events/UpcomingEventCard'
import { EventDetail } from '@/components/events/EventDetail'
import { EventListItem } from '@/components/events/EventParts'
import { EventForm } from '@/components/events/EventForm'
import { NotificationPreferencesView } from '@/components/settings/NotificationPreferencesCard'
import { NotificationPanel } from '@/components/notifications/NotificationPanel'
import { emptyEventForm } from '@/lib/events'
import type {
  NotificationWithWorkspace,
  WorkspaceEvent,
  WorkspaceMember,
} from '@/types/workspace'

const noop = () => {}
const at = (iso: string) => Date.parse(iso)

function event(overrides: Partial<WorkspaceEvent> = {}): WorkspaceEvent {
  return {
    id: 'e1',
    workspaceId: 'ws',
    workspaceName: 'Growducts',
    workspaceSlug: 'growducts',
    workspaceType: 'shared',
    scope: 'workspace',
    createdBy: 'abrar',
    title: 'Daily Standup',
    description: 'Daily team standup.',
    startsOn: '2026-09-28',
    startTime: '09:00:00',
    timezone: 'UTC',
    durationMinutes: null,
    recurrence: 'weekdays',
    reminderOffsets: [15],
    audience: 'everyone',
    audienceUserIds: [],
    dailyUpdatePrompt: false,
    status: 'scheduled',
    cancelledAt: null,
    upcomingOccurrences: [
      '2026-10-01T09:00:00.000Z',
      '2026-10-02T09:00:00.000Z',
    ],
    lastOccurrenceAt: '2026-09-30T09:00:00.000Z',
    createdAt: '2026-09-26T00:00:00Z',
    updatedAt: '2026-09-26T00:00:00Z',
    ...overrides,
  }
}

const members = [
  { userId: 'abrar', fullName: 'Abrar', email: null },
  { userId: 'iqra', fullName: 'Iqra', email: null },
] as WorkspaceMember[]

describe('the Overview’s Upcoming Event card', () => {
  const standup = event()
  const upcoming = {
    event: standup,
    phase: 'upcoming' as const,
    occurrenceAt: '2026-10-01T09:00:00.000Z',
  }

  it('counts down in days, hours, minutes and seconds', () => {
    // 14h 32m 08s before the standup.
    const now = at('2026-10-01T09:00:00Z') - (14 * 3600 + 32 * 60 + 8) * 1000
    const html = renderToStaticMarkup(
      <UpcomingEventView
        featured={upcoming}
        now={now}
        showCountdown
        emptyMessage=""
        createHref={null}
      />,
    )
    expect(html).toContain('Upcoming event')
    expect(html).toContain('Daily Standup')
    expect(html).toContain('Every weekday · 9:00 AM')
    expect(html).toContain('Starts in')
    for (const value of ['00', '14', '32', '08'])
      expect(html).toContain(`>${value}<`)
    expect(html).toContain('href="/workspaces/growducts/events?event=e1"')
    expect(html).toContain('View Event')
  })

  it('leaves the countdown out when the owner turned it off', () => {
    const html = renderToStaticMarkup(
      <UpcomingEventView
        featured={upcoming}
        now={at('2026-10-01T00:00:00Z')}
        showCountdown={false}
        emptyMessage=""
        createHref={null}
      />,
    )
    expect(html).toContain('Daily Standup')
    expect(html).not.toContain('Starts in')
    expect(html).not.toContain('role="timer"')
  })

  it('switches to Live now once it starts', () => {
    const html = renderToStaticMarkup(
      <UpcomingEventView
        featured={{ ...upcoming, phase: 'live' }}
        now={at('2026-10-01T09:02:14Z')}
        showCountdown
        emptyMessage=""
        createHref={null}
      />,
    )
    expect(html).toContain('Live now')
    expect(html).toContain('Started 02:14 ago')
    expect(html).toContain('Open Event')
    expect(html).not.toContain('Starts in')
  })

  it('has an empty state, with Create Event only for those who may', () => {
    const canCreate = renderToStaticMarkup(
      <UpcomingEventView
        featured={null}
        now={0}
        showCountdown
        emptyMessage="No upcoming events."
        createHref="/workspaces/growducts/events?new"
      />,
    )
    expect(canCreate).toContain('No upcoming events.')
    expect(canCreate).toContain('Create Event')
    const cannot = renderToStaticMarkup(
      <UpcomingEventView
        featured={null}
        now={0}
        showCountdown
        emptyMessage="No upcoming workspace events."
        createHref={null}
      />,
    )
    expect(cannot).toContain('No upcoming workspace events.')
    expect(cannot).not.toContain('Create Event')
  })
})

describe('an event in the list', () => {
  const render = (e: WorkspaceEvent, now: number, showWorkspace = false) =>
    renderToStaticMarkup(
      <ul>
        <EventListItem
          event={e}
          now={now}
          members={members}
          showWorkspace={showWorkspace}
          onOpen={noop}
        />
      </ul>,
    )

  it('answers what, when, who and when I’ll be reminded', () => {
    const html = render(event(), at('2026-10-01T00:00:00Z'))
    expect(html).toContain('Daily Standup')
    expect(html).toContain('9:00 AM')
    expect(html).toContain('Every weekday')
    expect(html).toContain('Everyone')
    expect(html).toContain('15 minutes before')
    expect(html).toContain('Workspace')
  })

  it('marks live and cancelled events', () => {
    expect(render(event(), at('2026-10-01T09:05:00Z'))).toContain('Live now')
    const cancelled = render(
      event({ status: 'cancelled', cancelledAt: '2026-09-30T00:00:00Z' }),
      at('2026-10-01T00:00:00Z'),
    )
    expect(cancelled).toContain('Cancelled')
    expect(cancelled).toContain('line-through')
    expect(cancelled).not.toContain('15 minutes before')
  })

  it('names where a personal event lives on the Personal Workspace page', () => {
    const personal = event({
      scope: 'personal',
      audience: 'self',
      title: 'Interview',
    })
    expect(render(personal, at('2026-10-01T00:00:00Z'), true)).toContain(
      'in Growducts',
    )
    expect(render(personal, at('2026-10-01T00:00:00Z'), true)).toContain(
      'Only you',
    )
  })
})

describe('the event detail', () => {
  const render = (canManage: boolean, e: WorkspaceEvent = event()) =>
    renderToStaticMarkup(
      <EventDetail
        event={e}
        now={at('2026-10-01T00:00:00Z')}
        members={members}
        creatorName="Abrar"
        canManage={canManage}
        dailyUpdatesHref="/workspaces/growducts/daily-updates"
        onEdit={noop}
        onCancelEvent={noop}
        onDelete={noop}
      />,
    )

  it('shows the schedule, next occurrence, audience, reminder and creator', () => {
    const html = render(false)
    expect(html).toContain('Every weekday · 9:00 AM')
    expect(html).toContain('Next')
    expect(html).toContain('Today · 9:00 AM')
    expect(html).toContain('Growducts')
    expect(html).toContain('15 minutes before')
    expect(html).toContain('Abrar')
    expect(html).toContain('Daily team standup.')
  })

  it('offers Edit, Cancel and Delete only to those who may manage it', () => {
    expect(render(false)).not.toContain('Edit')
    const html = render(true)
    expect(html).toContain('Edit')
    expect(html).toContain('Cancel event')
    expect(html).toContain('Delete')
  })

  it('links to Daily Updates when the event asks for one', () => {
    expect(render(false)).not.toContain('Write Daily Update')
    expect(render(false, event({ dailyUpdatePrompt: true }))).toContain(
      'href="/workspaces/growducts/daily-updates"',
    )
  })
})

describe('the event form', () => {
  const render = (
    allowWorkspaceScope: boolean,
    scope: 'personal' | 'workspace',
  ) =>
    renderToStaticMarkup(
      <EventForm
        mode="create"
        initial={emptyEventForm({
          scope,
          timezone: 'UTC',
          now: at('2026-10-01T00:00:00Z'),
        })}
        allowWorkspaceScope={allowWorkspaceScope}
        showDailyUpdatePrompt
        members={members}
        timezones={['UTC']}
        onSubmit={async () => ({ ok: true })}
        onCancel={noop}
      />,
    )

  it('offers Personal or Workspace to those who may create workspace events', () => {
    const html = render(true, 'workspace')
    expect(html).toContain('Event type')
    expect(html).toContain('Everyone in workspace')
    expect(html).toContain('Selected members')
    expect(html).toContain('15 minutes before')
    expect(html).toContain('Create Event')
  })

  it('is personal-only otherwise, with no audience to choose', () => {
    const html = render(false, 'personal')
    expect(html).not.toContain('Event type')
    expect(html).not.toContain('Everyone in workspace')
    expect(html).not.toContain('Daily Update')
  })
})

describe('notification preferences', () => {
  it('lists only real categories, with required ones explained', () => {
    const html = renderToStaticMarkup(
      <NotificationPreferencesView
        ready
        error={null}
        preferences={{ event_workspace_reminders: false }}
        permission="default"
        onChange={noop}
      />,
    )
    for (const title of [
      'Personal event reminders',
      'Workspace event reminders',
      'Event changes',
      'Event cancellations',
      'Task assigned to me',
      'Pull Request merged',
      'Mentions',
      'Browser notifications',
      'In-app notifications',
    ])
      expect(html).toContain(title)
    // Nothing OnTask doesn't send.
    expect(html).not.toContain('due soon')
    expect(html).not.toContain('Pull Request review')
    expect(html).toContain('always delivered')
    // Off only where the user turned it off.
    expect(html.match(/checked=""/g)?.length).toBe(
      html.match(/type="checkbox"/g)!.length - 1,
    )
  })

  it('explains a browser that blocks notifications', () => {
    const html = renderToStaticMarkup(
      <NotificationPreferencesView
        ready
        error={null}
        preferences={{}}
        permission="denied"
        onChange={noop}
      />,
    )
    expect(html).toContain('Blocked in your browser')
  })
})

describe('event notifications in the bell', () => {
  const reminder = (
    overrides: Partial<NotificationWithWorkspace> = {},
  ): NotificationWithWorkspace => ({
    id: 'n-1',
    userId: 'iqra',
    workspaceId: 'ws',
    eventId: null,
    goalId: null,
    notificationType: 'event_reminder',
    entityType: 'event',
    entityId: 'e1',
    title: 'Daily Standup starts in 15 minutes.',
    body: 'Workspace Event · Thu, Oct 1 · 9:00 AM',
    actorId: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    metadata: {
      occurrenceAt: '2099-10-01T09:00:00+00:00',
      timezone: 'UTC',
      scope: 'workspace',
      dailyUpdatePrompt: true,
    },
    workspaceSlug: 'growducts',
    workspaceName: 'Growducts',
    workspaceType: 'shared',
    workspaceAccent: 'ocean',
    ...overrides,
  })
  const render = (n: NotificationWithWorkspace) =>
    renderToStaticMarkup(
      <NotificationPanel
        notifications={[n]}
        ready
        unreadCount={1}
        groupByWorkspace={false}
        onMarkRead={noop}
        onMarkAllRead={noop}
        onNavigate={noop}
      />,
    )

  it('opens the event, and offers the Daily Update when the event asks', () => {
    const html = render(reminder())
    expect(html).toContain('Daily Standup starts in 15 minutes.')
    expect(html).toContain('href="/workspaces/growducts/events?event=e1"')
    expect(html).toContain('Make sure your Daily Update is ready.')
    expect(html).toContain('href="/workspaces/growducts/daily-updates"')
    expect(html).toContain('Write Daily Update')
  })

  it('offers no Daily Update action when the event doesn’t ask for one', () => {
    const html = render(
      reminder({
        metadata: {
          occurrenceAt: '2099-10-01T09:00:00+00:00',
          timezone: 'UTC',
          scope: 'workspace',
        },
      }),
    )
    expect(html).toContain('Workspace Event · ')
    expect(html).not.toContain('Write Daily Update')
    expect(html).not.toContain('Make sure your Daily Update')
  })

  it('words a personal reminder as personal, with no Daily Update action', () => {
    const html = render(
      reminder({
        notificationType: 'personal_event_reminder',
        title: 'Interview starts in 30 minutes.',
        metadata: {
          occurrenceAt: '2099-10-01T15:00:00+00:00',
          timezone: 'UTC',
          scope: 'personal',
        },
      }),
    )
    expect(html).toContain('Personal Event · ')
    expect(html).toContain('3:00 PM')
    expect(html).not.toContain('Write Daily Update')
  })

  it('shows a change notice’s own body', () => {
    const html = render(
      reminder({
        notificationType: 'event_updated',
        title: 'Daily Standup has been moved.',
        body: 'New time: Every weekday · 9:30 AM',
        metadata: { scope: 'workspace' },
      }),
    )
    expect(html).toContain('New time: Every weekday · 9:30 AM')
  })
})
