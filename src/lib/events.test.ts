import { describe, expect, it } from 'vitest'
import {
  EventRow,
  audienceLabel,
  canCreateWorkspaceEvents,
  canManageEvent,
  countdownParts,
  elapsedLabel,
  emptyEventForm,
  eventFormProblem,
  eventToForm,
  filterEvents,
  formToRpcArgs,
  formatEventDay,
  groupEventsByDay,
  isPastEvent,
  liveOccurrence,
  nextOccurrence,
  pickOverviewEvent,
  recurrenceLabel,
  remindersLabel,
  rowToEvent,
  scheduleLabel,
  timingChanged,
} from '@/lib/events'
import type { WorkspaceEvent, WorkspaceMember } from '@/types/workspace'

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
    description: null,
    startsOn: '2026-09-28',
    startTime: '09:00:00',
    timezone: 'Asia/Karachi',
    durationMinutes: null,
    recurrence: 'weekdays',
    reminderOffsets: [15],
    audience: 'everyone',
    audienceUserIds: [],
    dailyUpdatePrompt: false,
    status: 'scheduled',
    cancelledAt: null,
    // 9:00 Karachi (UTC+5) = 04:00 UTC; Fri Oct 2 then Mon Oct 5.
    upcomingOccurrences: [
      '2026-10-01T04:00:00.000Z',
      '2026-10-02T04:00:00.000Z',
      '2026-10-05T04:00:00.000Z',
    ],
    lastOccurrenceAt: '2026-09-30T04:00:00.000Z',
    createdAt: '2026-09-26T00:00:00Z',
    updatedAt: '2026-09-26T00:00:00Z',
    ...overrides,
  }
}

const member = (userId: string, fullName: string) =>
  ({ userId, fullName, email: null }) as WorkspaceMember

describe('reading rows', () => {
  it('maps a list_workspace_events row, normalising Postgres timestamps', () => {
    const row: EventRow = {
      id: 'e1',
      workspace_id: 'ws',
      workspace_name: 'Me',
      workspace_slug: 'personal-abc',
      workspace_type: 'personal',
      scope: 'personal',
      created_by: 'u',
      title: 'Interview',
      description: null,
      starts_on: '2026-09-28',
      start_time: '15:00:00',
      timezone: 'UTC',
      duration_minutes: null,
      recurrence: 'none',
      reminder_offsets: [30],
      audience: 'self',
      audience_user_ids: null,
      daily_update_prompt: false,
      status: 'scheduled',
      cancelled_at: null,
      upcoming_occurrences: ['2026-09-28 15:00:00+00'],
      last_occurrence_at: null,
      created_at: 'x',
      updated_at: 'x',
    }
    const mapped = rowToEvent(row)
    expect(mapped.upcomingOccurrences).toEqual(['2026-09-28T15:00:00.000Z'])
    expect(mapped.audienceUserIds).toEqual([])
    // A personal workspace is routed by its alias, never its stored slug.
    expect(mapped.workspaceSlug).toBe('personal-workspace')
  })
})

describe('wording', () => {
  it('names reminders, largest first', () => {
    expect(remindersLabel([5, 60, 0])).toBe(
      '1 hour before, 5 minutes before, At event time',
    )
    expect(remindersLabel([])).toBe('No reminder')
    expect(remindersLabel([1440])).toBe('1 day before')
  })

  it('names recurrences for the start date', () => {
    expect(recurrenceLabel('weekly', '2026-09-28')).toBe('Every Monday')
    expect(recurrenceLabel('monthly', '2026-10-01')).toBe(
      'First day of every month',
    )
    expect(recurrenceLabel('monthly', '2026-10-22')).toBe(
      'Every month on the 22nd',
    )
    expect(recurrenceLabel('monthly', '2026-10-11')).toBe(
      'Every month on the 11th',
    )
    expect(recurrenceLabel('none', '2026-10-11')).toBe('Does not repeat')
  })

  it('reads a schedule on the event’s own clock', () => {
    expect(scheduleLabel(event())).toBe('Every weekday · 9:00 AM')
    expect(
      scheduleLabel(
        event({
          recurrence: 'none',
          startsOn: '2026-09-28',
          startTime: '15:00:00',
        }),
        at('2026-09-28T01:00:00Z'),
      ),
    ).toBe('Today · 3:00 PM')
  })

  it('says Today/Tomorrow on the given timezone’s calendar', () => {
    // 20:00 UTC on the 27th is already the 28th in Karachi.
    const now = at('2026-09-27T20:00:00Z')
    expect(formatEventDay('2026-09-28T04:00:00Z', 'Asia/Karachi', now)).toBe(
      'Today',
    )
    expect(formatEventDay('2026-09-28T04:00:00Z', 'UTC', now)).toBe('Tomorrow')
    expect(formatEventDay('2026-10-05T04:00:00Z', 'UTC', now)).toBe(
      'Mon, Oct 5',
    )
  })

  it('names the audience', () => {
    const members = [member('a', 'Abrar'), member('i', 'Iqra')]
    expect(audienceLabel(event({ audience: 'self' }), members)).toBe('Only you')
    expect(audienceLabel(event(), members)).toBe('Everyone')
    expect(
      audienceLabel(
        event({ audience: 'selected', audienceUserIds: ['a', 'i'] }),
        members,
      ),
    ).toBe('Abrar, Iqra')
  })
})

describe('occurrences', () => {
  it('picks the next one still ahead', () => {
    expect(nextOccurrence(event(), at('2026-10-01T03:00:00Z'))).toBe(
      '2026-10-01T04:00:00.000Z',
    )
    // Past Thursday's: Friday's, then over the weekend to Monday's.
    expect(nextOccurrence(event(), at('2026-10-01T04:00:00Z'))).toBe(
      '2026-10-02T04:00:00.000Z',
    )
    expect(nextOccurrence(event(), at('2026-10-03T00:00:00Z'))).toBe(
      '2026-10-05T04:00:00.000Z',
    )
    expect(nextOccurrence(event({ status: 'cancelled' }), 0)).toBeNull()
  })

  it('is live from its start for its duration, or 15 minutes without one', () => {
    expect(liveOccurrence(event(), at('2026-10-01T04:14:59Z'))).toBe(
      '2026-10-01T04:00:00.000Z',
    )
    expect(liveOccurrence(event(), at('2026-10-01T04:15:00Z'))).toBeNull()
    expect(
      liveOccurrence(
        event({ durationMinutes: 60 }),
        at('2026-10-01T04:45:00Z'),
      ),
    ).toBe('2026-10-01T04:00:00.000Z')
    // The occurrence that had started when the list was fetched counts too.
    expect(liveOccurrence(event(), at('2026-09-30T04:05:00Z'))).toBe(
      '2026-09-30T04:00:00.000Z',
    )
  })

  it('a one-off is past once it is over, and cancelled is always past', () => {
    const oneOff = event({
      recurrence: 'none',
      upcomingOccurrences: ['2026-10-01T04:00:00.000Z'],
      lastOccurrenceAt: null,
    })
    expect(isPastEvent(oneOff, at('2026-10-01T03:00:00Z'))).toBe(false)
    expect(isPastEvent(oneOff, at('2026-10-01T04:10:00Z'))).toBe(false)
    expect(isPastEvent(oneOff, at('2026-10-01T04:15:00Z'))).toBe(true)
    expect(isPastEvent(event({ status: 'cancelled' }), 0)).toBe(true)
  })
})

describe('the Overview event', () => {
  const now = at('2026-10-01T00:00:00Z')

  it('is the soonest workspace event for this person', () => {
    const later = event({ id: 'later' })
    const sooner = event({
      id: 'sooner',
      title: 'Sprint Planning',
      recurrence: 'none',
      upcomingOccurrences: ['2026-10-01T02:00:00.000Z'],
    })
    const notMine = event({
      id: 'not-mine',
      audience: 'selected',
      audienceUserIds: ['someone-else'],
      upcomingOccurrences: ['2026-10-01T01:00:00.000Z'],
    })
    const personal = event({
      id: 'personal',
      scope: 'personal',
      audience: 'self',
      createdBy: 'abrar',
      upcomingOccurrences: ['2026-10-01T00:30:00.000Z'],
    })
    const picked = pickOverviewEvent([later, sooner, notMine, personal], {
      scope: 'workspace',
      userId: 'abrar',
      now,
    })
    expect(picked?.event.id).toBe('sooner')
    expect(picked?.phase).toBe('upcoming')
  })

  it('shows a live event, then moves to the next occurrence', () => {
    const standup = event()
    const live = pickOverviewEvent([standup], {
      scope: 'workspace',
      userId: 'x',
      now: at('2026-10-01T04:02:14Z'),
    })
    expect(live).toMatchObject({
      phase: 'live',
      occurrenceAt: '2026-10-01T04:00:00.000Z',
    })
    const after = pickOverviewEvent([standup], {
      scope: 'workspace',
      userId: 'x',
      now: at('2026-10-01T04:15:00Z'),
    })
    expect(after).toMatchObject({
      phase: 'upcoming',
      occurrenceAt: '2026-10-02T04:00:00.000Z',
    })
  })

  it('ignores cancelled events and returns null when nothing is coming', () => {
    expect(
      pickOverviewEvent([event({ status: 'cancelled' })], {
        scope: 'workspace',
        userId: 'x',
        now,
      }),
    ).toBeNull()
    expect(
      pickOverviewEvent([], { scope: 'workspace', userId: 'x', now }),
    ).toBeNull()
  })

  it('the Personal Workspace shows only the user’s own personal events', () => {
    const mine = event({
      id: 'mine',
      scope: 'personal',
      audience: 'self',
      createdBy: 'me',
    })
    const picked = pickOverviewEvent([event(), mine], {
      scope: 'personal',
      userId: 'me',
      now,
    })
    expect(picked?.event.id).toBe('mine')
  })
})

describe('the countdown', () => {
  it('splits the time left into days, hours, minutes and seconds', () => {
    const ms = ((0 * 24 + 14) * 3600 + 32 * 60 + 8) * 1000 + 999
    expect(countdownParts(ms)).toEqual({
      days: 0,
      hours: 14,
      minutes: 32,
      seconds: 8,
    })
    expect(countdownParts(2 * 86_400_000 + 1000)).toEqual({
      days: 2,
      hours: 0,
      minutes: 0,
      seconds: 1,
    })
    expect(countdownParts(-5000)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    })
  })

  it('says how long ago an event started', () => {
    expect(elapsedLabel(134_000)).toBe('02:14')
    expect(elapsedLabel(3_734_000)).toBe('1:02:14')
  })
})

describe('the list', () => {
  const now = at('2026-10-01T00:00:00Z')
  const standup = event()
  const personal = event({
    id: 'p',
    scope: 'personal',
    audience: 'self',
    title: 'Interview',
    recurrence: 'none',
    upcomingOccurrences: ['2026-10-01T10:00:00.000Z'],
    lastOccurrenceAt: null,
  })
  const tomorrow = event({
    id: 't',
    title: 'Client Demo',
    recurrence: 'none',
    upcomingOccurrences: ['2026-10-02T11:00:00.000Z'],
    lastOccurrenceAt: null,
  })
  const cancelled = event({
    id: 'c',
    status: 'cancelled',
    cancelledAt: '2026-09-30T00:00:00Z',
  })

  it('filters', () => {
    const all = [standup, personal, tomorrow, cancelled]
    expect(filterEvents(all, 'personal', now).map(e => e.id)).toEqual(['p'])
    expect(filterEvents(all, 'workspace', now).map(e => e.id)).toEqual([
      'e1',
      't',
      'c',
    ])
    expect(filterEvents(all, 'upcoming', now).map(e => e.id)).toEqual([
      'e1',
      'p',
      't',
    ])
    expect(filterEvents(all, 'past', now).map(e => e.id)).toEqual(['c'])
  })

  it('groups by day, soonest first, then Past', () => {
    const groups = groupEventsByDay(
      [tomorrow, cancelled, personal, standup],
      'UTC',
      now,
    )
    expect(groups.map(g => g.label)).toEqual(['Today', 'Tomorrow', 'Past'])
    expect(groups[0].events.map(e => e.id)).toEqual(['e1', 'p'])
  })
})

describe('permissions (mirroring the RPCs)', () => {
  const shared = {
    type: 'shared' as const,
    eventsEnabled: true,
    eventsMembersCanCreate: true,
  }

  it('members create workspace events unless the owner turns it off', () => {
    expect(canCreateWorkspaceEvents(shared, false)).toBe(true)
    expect(
      canCreateWorkspaceEvents(
        { ...shared, eventsMembersCanCreate: false },
        false,
      ),
    ).toBe(false)
    expect(
      canCreateWorkspaceEvents(
        { ...shared, eventsMembersCanCreate: false },
        true,
      ),
    ).toBe(true)
    expect(
      canCreateWorkspaceEvents({ ...shared, eventsEnabled: false }, true),
    ).toBe(false)
    expect(
      canCreateWorkspaceEvents({ ...shared, type: 'personal' }, true),
    ).toBe(false)
  })

  it('only the creator manages a personal event; owner or creator a workspace one', () => {
    const options = { userId: 'amy', isOwner: false, membersCanCreate: true }
    expect(
      canManageEvent({ scope: 'personal', createdBy: 'amy' }, options),
    ).toBe(true)
    expect(
      canManageEvent(
        { scope: 'personal', createdBy: 'amy' },
        { ...options, userId: 'owner', isOwner: true },
      ),
    ).toBe(false)
    expect(
      canManageEvent({ scope: 'workspace', createdBy: 'amy' }, options),
    ).toBe(true)
    expect(
      canManageEvent(
        { scope: 'workspace', createdBy: 'amy' },
        { ...options, membersCanCreate: false },
      ),
    ).toBe(false)
    expect(
      canManageEvent({ scope: 'workspace', createdBy: 'ben' }, options),
    ).toBe(false)
    expect(
      canManageEvent(
        { scope: 'workspace', createdBy: 'ben' },
        { ...options, isOwner: true },
      ),
    ).toBe(true)
  })
})

describe('the form', () => {
  const now = at('2026-09-28T05:10:00Z')

  it('starts at the next whole hour on the event’s clock', () => {
    const values = emptyEventForm({
      scope: 'workspace',
      timezone: 'Asia/Karachi',
      now,
    })
    // 05:10 UTC is 10:10 in Karachi.
    expect(values.startsOn).toBe('2026-09-28')
    expect(values.startTime).toBe('11:00')
    expect(values.reminderOffsets).toEqual([15])
  })

  it('explains what is missing', () => {
    const base = emptyEventForm({ scope: 'workspace', timezone: 'UTC', now })
    expect(eventFormProblem({ ...base, title: ' ' }, now)).toBe(
      'Give the event a title.',
    )
    expect(
      eventFormProblem(
        { ...base, title: 'X', startsOn: '2026-09-28', startTime: '05:00' },
        now,
      ),
    ).toBe('Choose a time in the future.')
    // A recurring event may start on a past date.
    expect(
      eventFormProblem(
        {
          ...base,
          title: 'X',
          startsOn: '2026-09-01',
          startTime: '05:00',
          recurrence: 'daily',
        },
        now,
      ),
    ).toBeNull()
    expect(
      eventFormProblem(
        { ...base, title: 'X', audience: 'selected', audienceUserIds: [] },
        now,
      ),
    ).toBe('Choose at least one member.')
    // An edit that leaves a past one-off's time alone is allowed.
    expect(
      eventFormProblem(
        { ...base, title: 'X', startsOn: '2026-09-01' },
        now,
        false,
      ),
    ).toBeNull()
  })

  it('round-trips an event and builds the RPC arguments', () => {
    const values = eventToForm(
      event({ audience: 'selected', audienceUserIds: ['a'] }),
    )
    expect(values.startTime).toBe('09:00')
    expect(timingChanged(values, event())).toBe(false)
    expect(timingChanged({ ...values, startTime: '09:30' }, event())).toBe(true)
    expect(
      formToRpcArgs({ ...values, reminderOffsets: [5, 60] }),
    ).toMatchObject({
      p_title: 'Daily Standup',
      p_start_time: '09:00',
      p_reminder_offsets: [60, 5],
      p_audience: 'selected',
      p_audience_user_ids: ['a'],
      p_duration_minutes: null,
    })
    // A personal event is always for its creator only.
    expect(
      formToRpcArgs({ ...values, scope: 'personal', dailyUpdatePrompt: true }),
    ).toMatchObject({
      p_audience: 'self',
      p_audience_user_ids: [],
      p_daily_update_prompt: false,
    })
  })
})
