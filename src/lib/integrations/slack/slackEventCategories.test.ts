import { describe, expect, it } from 'vitest'
import {
  SLACK_PREFERENCE_KEYS,
  isSlackEventEnabled,
  slackPreferenceKeyFor,
} from './slackEventCategories'

// Every Slack event type dispatch_slack_from_task_event() (0047, extended by
// 0048 with task deletion) can produce,
// plus the Daily Report's own. If the trigger learns a new one it belongs
// here, and this list failing is the cheap version of finding out in Slack.
const DISPATCHED_EVENT_TYPES = [
  'task_created',
  'task_deleted',
  'goal_task_created',
  'goal_subtask_created',
  'assigned',
  'reassigned',
  'unassigned',
  'started',
  'resumed',
  'paused',
  'completed',
  'skipped',
  'reopened',
  'note_added',
  'goal_created',
  'goal_completed',
  'goal_archived',
  'goal_deleted',
  'blocker_created',
  'blocker_resolved',
  'mentioned',
  'task_unblocked',
  'resource_added',
  'resource_updated',
  'resource_deleted',
  'member_invited',
  'member_joined',
  'member_removed',
  'work_session_started',
  'work_session_ended',
  // Development Tasks (migration 20260926180000).
  'development_status_changed',
  'daily_report_ready',
]

describe('slackPreferenceKeyFor', () => {
  it('maps every dispatched event type to a real preference key', () => {
    for (const eventType of DISPATCHED_EVENT_TYPES) {
      const key = slackPreferenceKeyFor(eventType)
      expect(key, `no preference key for "${eventType}"`).not.toBeNull()
      expect(SLACK_PREFERENCE_KEYS).toContain(key)
    }
  })

  it('leaves no preference key without at least one event behind it', () => {
    const covered = new Set(DISPATCHED_EVENT_TYPES.map(slackPreferenceKeyFor))
    for (const key of SLACK_PREFERENCE_KEYS) {
      expect(covered, `"${key}" is a switch nothing can turn off`).toContain(
        key,
      )
    }
  })

  it('gives Development Task status changes their own switch', () => {
    expect(slackPreferenceKeyFor('development_status_changed')).toBe(
      'development',
    )
    expect(
      isSlackEventEnabled({ development: false }, 'development_status_changed'),
    ).toBe(false)
    // A workspace that saved its settings before the switch existed hears it.
    expect(
      isSlackEventEnabled({ completed: true }, 'development_status_changed'),
    ).toBe(true)
  })

  it('keeps the 0045 preference keys pointing at the same events', () => {
    expect(slackPreferenceKeyFor('assigned')).toBe('assigned')
    expect(slackPreferenceKeyFor('reassigned')).toBe('assigned')
    expect(slackPreferenceKeyFor('completed')).toBe('completed')
    expect(slackPreferenceKeyFor('reopened')).toBe('completed')
    expect(slackPreferenceKeyFor('blocker_created')).toBe('blockers')
    expect(slackPreferenceKeyFor('blocker_resolved')).toBe('resolutions')
    expect(slackPreferenceKeyFor('task_unblocked')).toBe('resolutions')
    expect(slackPreferenceKeyFor('mentioned')).toBe('mentions')
    expect(slackPreferenceKeyFor('work_session_started')).toBe('work_sessions')
    expect(slackPreferenceKeyFor('work_session_ended')).toBe('work_sessions')
    expect(slackPreferenceKeyFor('daily_report_ready')).toBe('daily_reports')
  })

  it('returns null for an event type it has never heard of', () => {
    expect(slackPreferenceKeyFor('task_exploded')).toBeNull()
  })
})

describe('isSlackEventEnabled', () => {
  it('treats a missing key as on, so a connection stored before a category existed still notifies', () => {
    expect(isSlackEventEnabled({}, 'note_added')).toBe(true)
    expect(isSlackEventEnabled(null, 'goal_created')).toBe(true)
    expect(isSlackEventEnabled(undefined, 'resource_added')).toBe(true)
  })

  it('only false switches an event off', () => {
    expect(isSlackEventEnabled({ notes: false }, 'note_added')).toBe(false)
    expect(isSlackEventEnabled({ notes: true }, 'note_added')).toBe(true)
  })

  it('switches off every event in the group, not just the one that named it', () => {
    expect(isSlackEventEnabled({ resources: false }, 'resource_added')).toBe(
      false,
    )
    expect(isSlackEventEnabled({ resources: false }, 'resource_updated')).toBe(
      false,
    )
    expect(isSlackEventEnabled({ resources: false }, 'resource_deleted')).toBe(
      false,
    )
  })

  it('leaves the other groups alone', () => {
    const settings = { goals: false }
    expect(isSlackEventEnabled(settings, 'goal_completed')).toBe(false)
    expect(isSlackEventEnabled(settings, 'completed')).toBe(true)
    expect(isSlackEventEnabled(settings, 'blocker_created')).toBe(true)
  })

  it('lets teams switch work session login/logout updates off together', () => {
    const settings = { work_sessions: false }
    expect(isSlackEventEnabled(settings, 'work_session_started')).toBe(false)
    expect(isSlackEventEnabled(settings, 'work_session_ended')).toBe(false)
    expect(isSlackEventEnabled(settings, 'started')).toBe(true)
  })

  it('lets an unmapped event through rather than dropping it silently', () => {
    expect(isSlackEventEnabled({ goals: false }, 'something_new')).toBe(true)
  })
})
