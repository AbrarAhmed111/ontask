import { describe, expect, it } from 'vitest'
import { buildDailyReportWorkContext } from './dailyReportWorkContext'
import { abrar, event, sharedSnapshot, snapshot } from './dailyReportTestData'

describe('buildDailyReportWorkContext', () => {
  it('sends work sessions as context for the relevant member', () => {
    const context = buildDailyReportWorkContext(
      snapshot({
        members: [
          abrar({
            work_sessions: [
              {
                session_id: 'session-1',
                started_at: '2026-09-18T12:10:00Z',
                ended_at: '2026-09-18T16:10:00Z',
                status_at_report_end: 'working',
                current_break_started_at: null,
                total_break_seconds: 900,
                overlapped_seconds: 14400,
                active_seconds: 13500,
                still_active_at_report_end: false,
              },
            ],
          }),
        ],
      }),
    )

    expect(context.members[0].work_sessions).toEqual([
      {
        session_id: 'session-1',
        started_at: '2026-09-18T12:10:00Z',
        ended_at: '2026-09-18T16:10:00Z',
        status_at_report_end: 'working',
        active_seconds: 13500,
        break_seconds: 900,
        still_active_at_report_end: false,
      },
    ])
    expect(context.members[0].has_meaningful_work).toBe(true)
  })

  it('includes tasks worked on but excludes raw activity-event noise', () => {
    const context = buildDailyReportWorkContext(
      snapshot({
        members: [
          abrar({
            events: [
              event('created', 0),
              event('deleted', 1),
              event('resumed', 2),
            ],
          }),
        ],
      }),
    )
    const text = JSON.stringify(context)

    expect(context.members[0].tasks_worked_on).toHaveLength(2)
    expect(text).toContain('Working on OnTask Evolution')
    expect(text).not.toContain('"events"')
    expect(text).not.toContain('"created"')
    expect(text).not.toContain('"deleted"')
  })

  it('keeps Daily Updates separate from authoritative task completion', () => {
    const context = buildDailyReportWorkContext(
      sharedSnapshot({
        daily_updates: [
          {
            user_id: 'user-abrar',
            display_name: 'Abrar Ahmed',
            report_date: '2026-09-18',
            submitted_at: '2026-09-18T16:00:00Z',
            edited_at: null,
            items: [
              {
                type: 'done',
                content: 'Finished the booking flow',
                task_id: 'task-booking',
                task_title: 'Calendar Booking System',
                parent_title: null,
                goal_name: null,
                task_status: 'working',
                mentioned: [],
              },
            ],
          },
        ],
      }),
    )

    expect(context.members[0].daily_updates.done[0]).toMatchObject({
      content: 'Finished the booking flow',
      task_status: 'working',
    })
    expect(
      context.members[0].completed_work.some(
        task => task.title === 'Calendar Booking System',
      ),
    ).toBe(false)
  })
})
