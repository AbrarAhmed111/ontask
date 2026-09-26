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
  repositoryId: 22,
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
  repositoryId: null,
  repositoryFullName: null,
  repositoryUrl: null,
  branchDetectedAt: null,
  branchDeletedAt: null,
  branchReleasedAt: null,
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

  // The same badge a Goal's task list shows: the Goal Task IS the Development
  // Task (one row), so its stage comes from the one record.
  it('shows Needs Attention on a Goal Task whose branch was deleted before a PR', () => {
    const html = renderToStaticMarkup(
      <TaskDevelopmentBadge
        task={task}
        development={development({
          trackingStatus: 'branch_detected',
          branchDetectedAt: '2026-09-26T01:00:00Z',
          branchDeletedAt: '2026-09-26T02:00:00Z',
          repositoryId: 22,
          repositoryFullName: 'acme/ontask',
        })}
        connection={connected}
      />,
    )
    expect(html).toContain('Code task, Needs Attention')
  })

  it('shows In Development once the matching branch is detected', () => {
    const html = renderToStaticMarkup(
      <TaskDevelopmentBadge
        task={{ id: 't1', status: 'queued' }}
        development={development({
          trackingStatus: 'branch_detected',
          branchDetectedAt: '2026-09-26T01:00:00Z',
          repositoryId: 22,
          repositoryFullName: 'acme/ontask',
        })}
        connection={connected}
      />,
    )
    expect(html).toContain('Code task, In Development')
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
          repositoryId: 22,
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

  it('uses the refreshed repository name when the stable id matches after a rename', () => {
    const html = renderToStaticMarkup(
      <TaskDevelopmentSummary
        task={task}
        development={development({
          trackingStatus: 'branch_detected',
          branchDetectedAt: '2026-09-26T01:00:00Z',
          repositoryId: 22,
          repositoryFullName: 'acme/old-name',
        })}
        connection={{
          ...connected,
          repositoryFullName: 'acme/new-name',
          repositoryUrl: 'https://github.com/acme/new-name',
        }}
      />,
    )
    expect(html).toContain('acme/new-name')
    expect(html).not.toContain(
      'The repository is no longer accessible through the connected GitHub installation.',
    )
  })

  it('gives the reason when the task Needs Attention', () => {
    const html = renderToStaticMarkup(
      <TaskDevelopmentSummary
        task={task}
        development={development({
          trackingStatus: 'branch_detected',
          branchDetectedAt: '2026-09-26T01:00:00Z',
          branchDeletedAt: '2026-09-26T02:00:00Z',
          repositoryId: 22,
          repositoryFullName: 'acme/ontask',
        })}
        connection={connected}
      />,
    )
    expect(html).toContain('Needs Attention')
    expect(html).toContain(
      'Tracked branch was deleted or is no longer accessible.',
    )
    expect(html).toContain('Deleted on GitHub.')
    expect(html).not.toContain('/tree/feature/google-oauth-abrar')
  })

  it('reads Completed once the task is finished after a merge', () => {
    const html = renderToStaticMarkup(
      <TaskDevelopmentSummary
        task={{ status: 'completed' }}
        development={development({
          trackingStatus: 'merged',
          branchDetectedAt: '2026-09-26T01:00:00Z',
          repositoryId: 22,
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
