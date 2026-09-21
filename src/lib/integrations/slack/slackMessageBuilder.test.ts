import { describe, expect, it } from 'vitest'
import { buildSlackEventMessage } from './slackMessageBuilder'

describe('buildSlackEventMessage', () => {
  it('formats task assignment message correctly', () => {
    const message = buildSlackEventMessage({
      workspaceName: 'DevAbby',
      workspaceSlug: 'devabby',
      eventType: 'assigned',
      taskTitle: 'Student CRUD API',
      taskId: 'task-123',
      actorName: 'Abrar',
      recipientName: 'Araysh',
    })

    expect(message.fallbackText).toContain('Abrar assigned "Student CRUD API"')
    expect(message.blocks).toHaveLength(4)
    expect(JSON.stringify(message.blocks)).toContain('Task Assigned')
    expect(JSON.stringify(message.blocks)).toContain('*Workspace:* DevAbby')
    expect(JSON.stringify(message.blocks)).toContain(
      'http://localhost:3000/workspaces/devabby?task=task-123',
    )
  })

  it('formats task completion message correctly', () => {
    const message = buildSlackEventMessage({
      workspaceName: 'DevAbby',
      workspaceSlug: 'devabby',
      eventType: 'completed',
      taskTitle: 'Student CRUD API',
      taskId: 'task-123',
      actorName: 'Araysh',
    })

    expect(message.fallbackText).toContain(
      'Araysh completed "Student CRUD API"',
    )
    expect(JSON.stringify(message.blocks)).toContain('Task Completed')
    expect(JSON.stringify(message.blocks)).toContain('*Workspace:* DevAbby')
  })

  it('formats task blocker message correctly', () => {
    const message = buildSlackEventMessage({
      workspaceName: 'DevAbby',
      workspaceSlug: 'devabby',
      eventType: 'blocker_created',
      taskTitle: 'Payment Integration',
      taskId: 'task-456',
      actorName: 'Abrar',
      blockerReason: 'Waiting for Stripe credentials',
    })

    expect(message.fallbackText).toContain(
      'Task Blocked: "Payment Integration"',
    )
    expect(JSON.stringify(message.blocks)).toContain(
      'Waiting for Stripe credentials',
    )
    expect(JSON.stringify(message.blocks)).toContain('Task Blocked')
    expect(JSON.stringify(message.blocks)).toContain('*Workspace:* DevAbby')
  })

  it('formats mention message correctly', () => {
    const message = buildSlackEventMessage({
      workspaceName: 'DevAbby',
      workspaceSlug: 'devabby',
      eventType: 'mentioned',
      taskTitle: 'Payment Integration',
      taskId: 'task-456',
      actorName: 'Abrar',
      recipientName: 'Araysh',
      blockerReason: 'Waiting for Stripe credentials',
    })

    expect(message.fallbackText).toContain('Abrar mentioned Araysh')
    expect(JSON.stringify(message.blocks)).toContain('Mentioned in a Blocker')
    expect(JSON.stringify(message.blocks)).toContain(
      'Waiting for Stripe credentials',
    )
    expect(JSON.stringify(message.blocks)).toContain('*Workspace:* DevAbby')
  })

  it('formats Daily Report message correctly', () => {
    const message = buildSlackEventMessage({
      workspaceName: 'DevAbby',
      workspaceSlug: 'devabby',
      eventType: 'daily_report_ready',
      reportId: 'report-789',
      report: {
        paragraphs: ['Abrar completed 4 tasks and logged 5h 20m of focus.'],
        facts: ['5h 20m focused', '4 tasks completed'],
        shortened: false,
      },
    })

    expect(message.fallbackText).toContain(
      'Abrar completed 4 tasks and logged 5h 20m of focus.',
    )
    expect(JSON.stringify(message.blocks)).toContain('Daily Report')
    expect(JSON.stringify(message.blocks)).toContain(
      'http://localhost:3000/workspaces/devabby?report=report-789',
    )
  })
})

/**
 * The Daily Report message, which is the only one whose body is the thing it
 * announces rather than a pointer to it. What matters in every case below is
 * that the words came from the stored report: a message that reads well but was
 * composed here would be a second, disagreeing report.
 */
describe('buildSlackEventMessage — the Daily Report', () => {
  const NARRATION = [
    'Abrar completed 4 tasks, spent 5h 20m focused on implementation work, and finished the authentication and Slack integration work.',
    'The team also resolved 2 blockers during the period.',
  ]
  const base = {
    workspaceName: 'Products & AI Solutions',
    workspaceSlug: 'products-ai-solutions',
    eventType: 'daily_report_ready',
    reportId: 'report-789',
  }
  const digest = {
    paragraphs: NARRATION,
    facts: ['5h 20m focused', '4 tasks completed', '2 blockers resolved'],
    shortened: true,
  }

  const blockText = (
    message: ReturnType<typeof buildSlackEventMessage>,
    type: string,
  ) =>
    (
      message.blocks.find(b => (b as { type: string }).type === type) as
        { text?: { text?: string } } | undefined
    )?.text?.text ?? ''

  it('puts the stored narration in the message, not a notice that a report exists', () => {
    const message = buildSlackEventMessage({ ...base, report: digest })

    expect(blockText(message, 'section')).toBe(NARRATION.join('\n\n'))
    expect(JSON.stringify(message.blocks)).not.toContain('is ready')
  })

  it('names the workspace in the header', () => {
    const message = buildSlackEventMessage({ ...base, report: digest })

    expect(blockText(message, 'header')).toBe(
      '📊 Daily Report — Products & AI Solutions',
    )
  })

  it('carries the figures under the narration', () => {
    const message = buildSlackEventMessage({ ...base, report: digest })
    const context = message.blocks.find(
      b => (b as { type: string }).type === 'context',
    ) as { elements: { text: string }[] }

    expect(context.elements[0].text).toBe(
      '5h 20m focused · 4 tasks completed · 2 blockers resolved',
    )
  })

  it('links the button to that exact report', () => {
    const message = buildSlackEventMessage({ ...base, report: digest })
    const button = (
      message.blocks.find(b => (b as { type: string }).type === 'actions') as {
        elements: { text: { text: string }; url: string }[]
      }
    ).elements[0]

    expect(button.text.text).toBe('View Full Daily Report')
    expect(button.url).toBe(
      'http://localhost:3000/workspaces/products-ai-solutions?report=report-789',
    )
  })

  it('gives the notification preview the opening of the report', () => {
    const message = buildSlackEventMessage({ ...base, report: digest })

    expect(message.fallbackText).toBe(
      `[Products & AI Solutions] Daily Report: ${NARRATION[0]}`,
    )
  })

  // Slack reads < and > as the start of a link and & as an entity, so a report
  // that quotes a task called "<script> & co" must not be able to turn part of
  // the channel into a broken link.
  it('escapes Slack’s own markup out of the stored narration', () => {
    const message = buildSlackEventMessage({
      ...base,
      report: {
        paragraphs: [
          'Abrar finished "<Payments> & billing" and left 5 < 6 tasks open.',
        ],
        facts: ['R&D: 2h 0m focused'],
        shortened: false,
      },
    })

    const body = blockText(message, 'section')
    expect(body).toBe(
      'Abrar finished "&lt;Payments&gt; &amp; billing" and left 5 &lt; 6 tasks open.',
    )
    expect(body).not.toContain('<Payments>')
    expect(JSON.stringify(message.blocks)).toContain('R&amp;D')
  })

  it('sends the figures alone when a report stored no narration', () => {
    const message = buildSlackEventMessage({
      ...base,
      report: { paragraphs: [], facts: ['3h 0m focused'], shortened: false },
    })

    expect(blockText(message, 'section')).toBe('*3h 0m focused*')
    expect(message.fallbackText).toBe(
      '[Products & AI Solutions] Daily Report: 3h 0m focused',
    )
  })

  // Nothing on the real path reaches here: the dispatcher does not send a
  // report it could not read. This is the builder staying total rather than
  // throwing inside a notification.
  it('falls back to a pointer when it was handed no report at all', () => {
    const message = buildSlackEventMessage(base)

    expect(message.fallbackText).toBe(
      '[Products & AI Solutions] Daily Report is ready',
    )
    expect(blockText(message, 'section')).toContain('is ready')
  })

  it('keeps the header inside Slack’s limit for a long workspace name', () => {
    const message = buildSlackEventMessage({
      ...base,
      workspaceName: 'W'.repeat(300),
      report: digest,
    })

    expect(blockText(message, 'header').length).toBeLessThanOrEqual(150)
  })
  it('renders work-context reports as member narratives plus a summary', () => {
    const message = buildSlackEventMessage({
      ...base,
      report: {
        paragraphs: [
          'Abrar worked on Calendar Booking System.',
          'The team progressed Calendar Booking System.',
        ],
        sections: [
          {
            kind: 'member',
            userId: 'user-abrar',
            name: 'Abrar Ahmed',
            paragraphs: ['Abrar worked on Calendar Booking System.'],
          },
          {
            kind: 'summary',
            name: 'Summary',
            paragraphs: ['The team progressed Calendar Booking System.'],
          },
        ],
        facts: [],
        taskTitles: ['Calendar Booking System'],
        shortened: false,
      },
    })

    expect(blockText(message, 'section')).toBe(
      '*Abrar Ahmed*\n\nAbrar worked on `Calendar Booking System`.\n\n*Summary*\n\nThe team progressed `Calendar Booking System`.',
    )
  })
})

// The categories 0047 connected. Each one checks the words a reader sees and
// where the button goes -- a message that builds but links nowhere useful is
// the same dead end as no message at all.
describe('buildSlackEventMessage — task lifecycle', () => {
  const base = {
    workspaceName: 'DevAbby',
    workspaceSlug: 'devabby',
    taskTitle: 'Student CRUD API',
    taskId: 'task-123',
    actorName: 'Abrar',
  }

  it('announces a task creation and names the assignee when there is one', () => {
    const message = buildSlackEventMessage({
      ...base,
      eventType: 'task_created',
      recipientName: 'Araysh',
    })

    expect(message.fallbackText).toBe(
      '[DevAbby] Abrar created "Student CRUD API" and assigned it to Araysh',
    )
    expect(JSON.stringify(message.blocks)).toContain('Task Created')
    expect(JSON.stringify(message.blocks)).toContain('Assigned to *Araysh*')
    expect(JSON.stringify(message.blocks)).toContain(
      'http://localhost:3000/workspaces/devabby?task=task-123',
    )
  })

  it('leaves the assignee out of a task created without one', () => {
    const message = buildSlackEventMessage({
      ...base,
      eventType: 'task_created',
    })

    expect(message.fallbackText).toBe(
      '[DevAbby] Abrar created "Student CRUD API"',
    )
    expect(JSON.stringify(message.blocks)).not.toContain('Assigned to')
  })

  it('says who a task was taken from when it is unassigned', () => {
    const message = buildSlackEventMessage({
      ...base,
      eventType: 'unassigned',
      previousAssigneeName: 'Araysh',
    })

    expect(message.fallbackText).toContain(
      'Abrar unassigned "Student CRUD API" from Araysh',
    )
    expect(JSON.stringify(message.blocks)).toContain('Task Unassigned')
  })

  it('distinguishes started from resumed', () => {
    expect(
      buildSlackEventMessage({ ...base, eventType: 'started' }).fallbackText,
    ).toBe('[DevAbby] Abrar started "Student CRUD API"')
    expect(
      buildSlackEventMessage({ ...base, eventType: 'resumed' }).fallbackText,
    ).toBe('[DevAbby] Abrar resumed "Student CRUD API"')
    expect(
      JSON.stringify(
        buildSlackEventMessage({ ...base, eventType: 'resumed' }).blocks,
      ),
    ).toContain('Task Resumed')
  })

  it('builds paused and skipped messages', () => {
    expect(
      JSON.stringify(
        buildSlackEventMessage({ ...base, eventType: 'paused' }).blocks,
      ),
    ).toContain('Task Paused')
    expect(
      JSON.stringify(
        buildSlackEventMessage({ ...base, eventType: 'skipped' }).blocks,
      ),
    ).toContain('Task Skipped')
  })

  it('carries the goal as context on a task that belongs to one', () => {
    const message = buildSlackEventMessage({
      ...base,
      eventType: 'completed',
      goalName: 'School Management MVP',
    })

    expect(JSON.stringify(message.blocks)).toContain(
      '*Goal:* School Management MVP',
    )
  })
})

describe('buildSlackEventMessage — goal tasks and subtasks', () => {
  it('names the goal a task was added to', () => {
    const message = buildSlackEventMessage({
      workspaceName: 'DevAbby',
      workspaceSlug: 'devabby',
      eventType: 'goal_task_created',
      taskTitle: 'Dashboard UI',
      taskId: 'task-9',
      actorName: 'Abrar',
      goalName: 'School Management MVP',
    })

    expect(message.fallbackText).toBe(
      '[DevAbby] Abrar added "Dashboard UI" to the goal "School Management MVP"',
    )
    expect(JSON.stringify(message.blocks)).toContain('Goal Task Added')
    expect(JSON.stringify(message.blocks)).toContain(
      'http://localhost:3000/workspaces/devabby?task=task-9',
    )
  })

  it('keeps the Goal → Task → Subtask chain readable on a subtask', () => {
    const message = buildSlackEventMessage({
      workspaceName: 'DevAbby',
      workspaceSlug: 'devabby',
      eventType: 'goal_subtask_created',
      taskTitle: 'Chart legend',
      taskId: 'task-10',
      parentTitle: 'Dashboard UI',
      goalName: 'School Management MVP',
      actorName: 'Abrar',
    })

    const rendered = JSON.stringify(message.blocks)
    expect(rendered).toContain('Goal Subtask Added')
    expect(rendered).toContain('Chart legend')
    expect(rendered).toContain('under *Dashboard UI*')
    expect(rendered).toContain('*Goal:* School Management MVP')
  })
})

describe('buildSlackEventMessage — notes', () => {
  it('reports that a note was added without repeating what it said', () => {
    const message = buildSlackEventMessage({
      workspaceName: 'DevAbby',
      workspaceSlug: 'devabby',
      eventType: 'note_added',
      taskTitle: 'Student CRUD API',
      taskId: 'task-123',
      actorName: 'Abrar',
    })

    expect(message.fallbackText).toBe(
      '[DevAbby] Abrar added a note to "Student CRUD API"',
    )
    expect(JSON.stringify(message.blocks)).toContain('Note Added')
    expect(JSON.stringify(message.blocks)).toContain(
      'http://localhost:3000/workspaces/devabby?task=task-123',
    )
  })
})

describe('buildSlackEventMessage — goals', () => {
  const base = {
    workspaceName: 'DevAbby',
    workspaceSlug: 'devabby',
    actorName: 'Abrar',
    entityName: 'School Management MVP',
  }

  it('builds created, completed and archived messages from the goal name', () => {
    expect(
      buildSlackEventMessage({ ...base, eventType: 'goal_created' })
        .fallbackText,
    ).toBe('[DevAbby] Abrar created the goal "School Management MVP"')
    expect(
      JSON.stringify(
        buildSlackEventMessage({ ...base, eventType: 'goal_completed' }).blocks,
      ),
    ).toContain('Goal Completed')
    expect(
      JSON.stringify(
        buildSlackEventMessage({ ...base, eventType: 'goal_archived' }).blocks,
      ),
    ).toContain('Goal Archived')
  })

  // The goals row is already gone when this is built, so everything has to
  // come off the event itself.
  it('names a deleted goal from the event alone', () => {
    const message = buildSlackEventMessage({
      ...base,
      eventType: 'goal_deleted',
    })

    expect(message.fallbackText).toBe(
      '[DevAbby] Abrar deleted the goal "School Management MVP"',
    )
    expect(JSON.stringify(message.blocks)).toContain('Goal Deleted')
    expect(JSON.stringify(message.blocks)).toContain(
      'http://localhost:3000/workspaces/devabby',
    )
  })
})

describe('buildSlackEventMessage — resources', () => {
  const base = {
    workspaceName: 'DevAbby',
    workspaceSlug: 'devabby',
    actorName: 'Abrar',
    entityName: 'Project Requirements.pdf',
  }

  it('names the file that was added', () => {
    const message = buildSlackEventMessage({
      ...base,
      eventType: 'resource_added',
    })

    expect(message.fallbackText).toBe(
      '[DevAbby] Abrar uploaded "Project Requirements.pdf" to DevAbby',
    )
    expect(JSON.stringify(message.blocks)).toContain('Resource Added')
  })

  it('names the file that was updated or removed', () => {
    expect(
      buildSlackEventMessage({ ...base, eventType: 'resource_updated' })
        .fallbackText,
    ).toBe(
      '[DevAbby] Abrar updated resource "Project Requirements.pdf" in DevAbby',
    )
    expect(
      JSON.stringify(
        buildSlackEventMessage({ ...base, eventType: 'resource_deleted' })
          .blocks,
      ),
    ).toContain('Resource Removed')
  })

  it('keeps the goal a resource belongs to', () => {
    const message = buildSlackEventMessage({
      ...base,
      eventType: 'resource_added',
      goalName: 'School Management MVP',
    })

    expect(JSON.stringify(message.blocks)).toContain(
      'to the goal *School Management MVP*',
    )
  })
})

describe('buildSlackEventMessage — workspace membership', () => {
  const base = {
    workspaceName: 'DevAbby',
    workspaceSlug: 'devabby',
    actorName: 'Abrar',
  }

  it('names the invitee and links to the members page, never the invitation itself', () => {
    const message = buildSlackEventMessage({
      ...base,
      eventType: 'member_invited',
      entityName: 'Iqra',
    })

    expect(message.fallbackText).toBe(
      '[DevAbby] Abrar invited Iqra to the DevAbby workspace',
    )
    expect(JSON.stringify(message.blocks)).toContain('Workspace Invitation')
    expect(JSON.stringify(message.blocks)).toContain(
      'http://localhost:3000/workspaces/devabby/members',
    )
  })

  it('attributes a join to the person who joined', () => {
    const message = buildSlackEventMessage({
      ...base,
      eventType: 'member_joined',
      actorName: 'Iqra',
    })

    expect(message.fallbackText).toBe(
      '[DevAbby] Iqra joined the DevAbby workspace',
    )
    expect(JSON.stringify(message.blocks)).toContain('New Workspace Member')
  })

  it('tells a removal apart from someone leaving of their own accord', () => {
    const removed = buildSlackEventMessage({
      ...base,
      eventType: 'member_removed',
      entityName: 'Iqra',
    })
    expect(removed.fallbackText).toBe(
      '[DevAbby] Abrar removed Iqra from the DevAbby workspace',
    )
    expect(JSON.stringify(removed.blocks)).toContain('Member Removed')

    const left = buildSlackEventMessage({
      ...base,
      eventType: 'member_removed',
      actorName: 'Iqra',
      entityName: 'Iqra',
      selfRemoved: true,
    })
    expect(left.fallbackText).toBe('[DevAbby] Iqra left the DevAbby workspace')
    expect(JSON.stringify(left.blocks)).toContain('Member Left')
  })
})

describe('buildSlackEventMessage — work sessions', () => {
  const base = {
    workspaceName: 'DevAbby',
    workspaceSlug: 'devabby',
    actorName: 'Abrar',
    entityType: 'work_session' as const,
  }

  it('announces when a member logs in for work', () => {
    const message = buildSlackEventMessage({
      ...base,
      eventType: 'work_session_started',
    })

    expect(message.fallbackText).toBe('[DevAbby] Abrar logged in for work')
    expect(JSON.stringify(message.blocks)).toContain('Work Session Started')
    expect(JSON.stringify(message.blocks)).toContain(
      '*Abrar* logged in for work in *DevAbby*.',
    )
    expect(JSON.stringify(message.blocks)).toContain(
      'http://localhost:3000/workspaces/devabby',
    )
  })

  it('announces when a member logs out from work', () => {
    const message = buildSlackEventMessage({
      ...base,
      eventType: 'work_session_ended',
    })

    expect(message.fallbackText).toBe('[DevAbby] Abrar logged out from work')
    expect(JSON.stringify(message.blocks)).toContain('Work Session Ended')
    expect(JSON.stringify(message.blocks)).toContain(
      '*Abrar* logged out from work in *DevAbby*.',
    )
  })
})

describe('buildSlackEventMessage — escaping', () => {
  it('escapes Slack control characters in every name it is handed', () => {
    const message = buildSlackEventMessage({
      workspaceName: 'A & B',
      workspaceSlug: 'a-b',
      eventType: 'goal_created',
      actorName: '<script>',
      entityName: 'Ship <v2> & win',
    })

    const rendered = JSON.stringify(message.blocks)
    expect(rendered).toContain('&lt;script&gt;')
    expect(rendered).toContain('Ship &lt;v2&gt; &amp; win')
    expect(rendered).not.toContain('<script>')
  })
})
