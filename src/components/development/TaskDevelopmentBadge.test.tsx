import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  TaskCodeBadge,
  TaskDevelopmentBadge,
  TaskDevelopmentSummary,
} from '@/components/development/TaskDevelopmentBadge'
import type { GithubConnection, TaskDevelopment } from '@/types/workspace'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}))

const connected: GithubConnection = {
  workspaceId: 'w1',
  accountLogin: 'acme',
  repositoryFullName: 'acme/ontask',
  repositoryUrl: 'https://github.com/acme/ontask',
  status: 'connected',
  updatedAt: '2026-09-26T00:00:00Z',
}

const development = (
  overrides: Partial<TaskDevelopment> = {},
): TaskDevelopment => ({
  taskId: 't1',
  workspaceId: 'w1',
  branchName: 'feature/google-oauth-abrar',
  workType: 'feature',
  repositoryFullName: null,
  branchDetectedAt: null,
  prNumber: null,
  prUrl: null,
  prTitle: null,
  prState: null,
  prOpenedAt: null,
  prClosedAt: null,
  prMergedAt: null,
  trackingStatus: 'waiting',
  createdAt: '2026-09-26T00:00:00Z',
  ...overrides,
})

const task = { id: 't1', status: 'working' as const }

describe('TaskDevelopmentBadge', () => {
  it('marks the task as code work, with its stage for screen readers', () => {
    const html = renderToStaticMarkup(
      <TaskDevelopmentBadge
        task={task}
        development={development({ trackingStatus: 'in_review' })}
        connection={connected}
      />,
    )
    expect(html).toContain('Code')
    expect(html).toContain('Code task, In Review')
    // Closed until hovered or clicked.
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('feature/google-oauth-abrar')
  })

  it('renders nothing for a task that is not a Development Task here', () => {
    expect(renderToStaticMarkup(<TaskCodeBadge task={task} />)).toBe('')
  })
})

describe('TaskDevelopmentSummary', () => {
  it('says the branch is awaited before it is created', () => {
    const html = renderToStaticMarkup(
      <TaskDevelopmentSummary
        task={task}
        development={development()}
        connection={connected}
      />,
    )
    expect(html).toContain('feature/google-oauth-abrar')
    expect(html).toContain('Waiting for this branch to be created.')
    expect(html).toContain('Not opened yet.')
    expect(html).toContain('Queued')
  })

  it('says tracking is off while GitHub is not connected', () => {
    const html = renderToStaticMarkup(
      <TaskDevelopmentSummary
        task={task}
        development={development()}
        connection={null}
      />,
    )
    expect(html).toContain('GitHub isn’t connected')
  })

  it('shows the repository and the open Pull Request', () => {
    const html = renderToStaticMarkup(
      <TaskDevelopmentSummary
        task={task}
        development={development({
          trackingStatus: 'in_review',
          branchDetectedAt: '2026-09-26T01:00:00Z',
          repositoryFullName: 'acme/ontask',
          prNumber: 42,
          prTitle: 'Google sign-in',
          prState: 'open',
          prUrl: 'https://github.com/acme/ontask/pull/42',
        })}
        connection={connected}
        onOpen={() => {}}
      />,
    )
    expect(html).toContain(
      'href="https://github.com/acme/ontask/tree/feature/google-oauth-abrar"',
    )
    expect(html).toContain('#42 — Google sign-in')
    expect(html).toContain('href="https://github.com/acme/ontask/pull/42"')
    expect(html).toContain('In Review')
    expect(html).toContain('Open Development Task')
  })

  it('reads Completed once the task is finished after a merge', () => {
    const html = renderToStaticMarkup(
      <TaskDevelopmentSummary
        task={{ status: 'completed' }}
        development={development({
          trackingStatus: 'merged',
          branchDetectedAt: '2026-09-26T01:00:00Z',
          repositoryFullName: 'acme/ontask',
          prNumber: 42,
          prState: 'merged',
        })}
        connection={connected}
      />,
    )
    expect(html).toContain('Completed')
    // A merged branch is usually deleted, so it isn't linked.
    expect(html).not.toContain('/tree/feature/google-oauth-abrar')
  })
})
