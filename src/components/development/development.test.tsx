import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodeTrackingPanel } from '@/components/development/CodeTrackingPanel'
import {
  BranchCollisionNotice,
  DevelopmentTaskForm,
} from '@/components/development/DevelopmentTaskForm'
import { branchCollision } from '@/lib/development/branchName'
import { DevelopmentTaskCreated } from '@/components/development/DevelopmentTaskCreated'
import { SelectMenu } from '@/components/ui/SelectMenu'
import { WorkspaceActivityFeed } from '@/components/workspaces/WorkspaceActivityFeed'
import { notificationHref } from '@/lib/workspaceNotifications'
import type {
  GithubConnection,
  TaskDevelopment,
  WorkspaceMember,
  WorkspaceTaskStatus,
} from '@/types/workspace'

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

const withPr = (
  prState: TaskDevelopment['prState'],
  trackingStatus: TaskDevelopment['trackingStatus'],
) =>
  development({
    repositoryFullName: 'acme/ontask',
    branchDetectedAt: '2026-09-26T09:00:00Z',
    prNumber: 142,
    prUrl: 'https://github.com/acme/ontask/pull/142',
    prTitle: 'Implement Google OAuth',
    prState,
    trackingStatus,
  })

const panel = (
  dev: TaskDevelopment,
  {
    status = 'queued',
    connection = connected,
    suggested,
  }: {
    status?: WorkspaceTaskStatus
    connection?: GithubConnection | null
    suggested?: string
  } = {},
) =>
  renderToStaticMarkup(
    <CodeTrackingPanel
      task={{ status }}
      development={dev}
      connection={connection}
      suggestedBranchName={suggested}
      onUseBranchName={() => {}}
    />,
  )

describe('CodeTrackingPanel', () => {
  it('before the branch exists: the exact name to copy, and waiting (not an error)', () => {
    const html = panel(development())
    expect(html).toContain('Branch not detected')
    expect(html).toContain('feature/google-oauth-abrar')
    expect(html).toContain('Copy')
    expect(html).toContain('acme/ontask')
    expect(html).toContain('Waiting for your branch')
    expect(html).toContain('How does tracking work?')
    expect(html).not.toContain('Branch connected')
    expect(html).not.toContain('role="alert"')
  })

  it('says GitHub is not connected instead of waiting forever', () => {
    const html = panel(development(), { connection: null })
    expect(html).not.toContain('Waiting for your branch')
    expect(html).toContain('GitHub isn&#x27;t connected')
  })

  it('offers the regenerated name only while the branch is untracked', () => {
    const suggested = 'feature/google-oauth-iqra'
    expect(panel(development(), { suggested })).toContain(`Use ${suggested}`)
    expect(
      panel(development({ branchDetectedAt: '2026-09-26T09:00:00Z' }), {
        suggested,
      }),
    ).not.toContain(`Use ${suggested}`)
    // A -02 added for uniqueness is not a change of name.
    expect(
      panel(development({ branchName: `${suggested}-02` }), { suggested }),
    ).not.toContain(`Use ${suggested}`)
  })

  it('branch detected: connected, linked, no PR yet', () => {
    const html = panel(
      development({
        repositoryFullName: 'acme/ontask',
        branchDetectedAt: '2026-09-26T09:00:00Z',
        trackingStatus: 'branch_detected',
      }),
    )
    expect(html).toContain('Branch connected')
    expect(html).toContain(
      'https://github.com/acme/ontask/tree/feature/google-oauth-abrar',
    )
    expect(html).toContain('Not created yet')
  })

  it('PR open: In Review with a link to the PR', () => {
    const html = panel(withPr('open', 'in_review'), { status: 'working' })
    expect(html).toContain('#142 — Implement Google OAuth')
    expect(html).toContain('https://github.com/acme/ontask/pull/142')
    expect(html).toContain('In Review')
  })

  it('PR closed without merging: Needs Attention with what to do, never completed', () => {
    const html = panel(withPr('closed', 'pr_closed'), { status: 'paused' })
    expect(html).toContain(
      'Needs Attention — Pull request was closed without being merged.',
    )
    expect(html).toContain('Open a new Pull Request')
    expect(html).toContain('#142 — Implement Google OAuth')
    expect(html).not.toContain('Completed')
  })

  it('branch deleted before a PR: Needs Attention, the name to push again, no dead link', () => {
    const html = panel(
      development({
        repositoryFullName: 'acme/ontask',
        branchDetectedAt: '2026-09-26T09:00:00Z',
        branchDeletedAt: '2026-09-26T10:00:00Z',
        trackingStatus: 'branch_detected',
      }),
      { status: 'working' },
    )
    expect(html).toContain(
      'Needs Attention — Tracked branch was deleted or is no longer accessible.',
    )
    expect(html).toContain('Branch deleted on GitHub')
    expect(html).toContain('Copy: feature/google-oauth-abrar')
    expect(html).not.toContain('/tree/feature/google-oauth-abrar')
    expect(html).not.toContain('Branch connected')
  })

  it('branch deleted while the PR is open: still In Review, no alarm', () => {
    const html = panel(
      {
        ...withPr('open', 'in_review'),
        branchDeletedAt: '2026-09-26T10:00:00Z',
      },
      { status: 'working' },
    )
    expect(html).toContain('In Review')
    expect(html).not.toContain('Needs Attention')
  })

  it('branch deleted after the merge: still Completed', () => {
    const html = panel(
      {
        ...withPr('merged', 'merged'),
        branchDeletedAt: '2026-09-26T10:00:00Z',
      },
      { status: 'completed' },
    )
    expect(html).toContain('Completed — Pull Request #142')
    expect(html).not.toContain('Needs Attention')
  })

  it('repository access removed: Needs Attention explaining the repository', () => {
    const html = panel(withPr('open', 'in_review'), {
      status: 'working',
      connection: { ...connected, status: 'repository_access_lost' },
    })
    expect(html).toContain(
      'The repository is no longer accessible through the connected GitHub installation.',
    )
  })

  it('PR merged: completed, and says why', () => {
    const html = panel(withPr('merged', 'merged'), { status: 'completed' })
    expect(html).toContain('Completed — Pull Request #142')
    expect(html).toContain('was merged.')
  })

  it('PR merged on a blocked task: explains why it is not completed', () => {
    const html = panel(withPr('merged', 'merged'), { status: 'blocked' })
    expect(html).toContain('Pull Request #142 was merged.')
    expect(html).toContain('active blocker')
    expect(html).not.toContain('Completed')
  })
})

const member = (userId: string, fullName: string): WorkspaceMember => ({
  id: `m-${userId}`,
  workspaceId: 'w1',
  userId,
  role: 'member',
  joinedAt: '2026-01-01',
  fullName,
  email: null,
  avatarUrl: null,
})

const feed = (eventType: string, metadata: Record<string, unknown>) =>
  renderToStaticMarkup(
    <WorkspaceActivityFeed
      members={[member('u-abrar', 'Abrar')]}
      events={[
        {
          id: 'e1',
          taskId: 't1',
          goalId: null,
          actorId: 'u-abrar',
          eventType,
          metadata,
          createdAt: new Date().toISOString(),
        },
      ]}
    />,
  )

describe('Activity — development events', () => {
  const title = 'Implement Google OAuth'

  it('reads the GitHub timeline without opening GitHub', () => {
    expect(
      feed('development_branch_detected', {
        title,
        branch: 'feature/google-oauth-abrar',
      }),
    ).toContain('Abrar&#x27;s branch feature/google-oauth-abrar was detected')
    expect(feed('development_pr_opened', { title, pr_number: 142 })).toContain(
      'Pull Request #142 was opened — &quot;Implement Google OAuth&quot; moved to In Review',
    )
    expect(feed('development_pr_closed', { title, pr_number: 142 })).toContain(
      'closed without merging',
    )
  })

  it('attributes a merge completion to the PR, not to a person', () => {
    const html = feed('completed', { title, source: 'github', pr_number: 142 })
    expect(html).toContain(
      '&quot;Implement Google OAuth&quot; was completed — Pull Request #142 was merged',
    )
    expect(html).not.toContain('Abrar completed')
  })

  it('leaves an ordinary completion as it was', () => {
    expect(feed('completed', { title })).toContain(
      'Abrar completed &quot;Implement Google OAuth&quot;',
    )
  })
})

describe('notificationHref — development', () => {
  it('opens the task in the Overview’s Development section', () => {
    expect(
      notificationHref({
        workspaceSlug: 'team',
        entityType: 'task',
        entityId: 't1',
        notificationType: 'development_pr_merged',
      }),
    ).toBe('/workspaces/team?devtask=t1')
  })

  it('keeps other task notifications on the overview', () => {
    expect(
      notificationHref({
        workspaceSlug: 'team',
        entityType: 'task',
        entityId: 't1',
        notificationType: 'assigned',
      }),
    ).toBe('/workspaces/team?task=t1')
  })
})

describe('DevelopmentTaskForm', () => {
  const html = renderToStaticMarkup(
    <DevelopmentTaskForm
      members={[member('u-abrar', 'Abrar Ahmed')]}
      goals={[]}
      currentUserId="u-abrar"
      branchHolders={[]}
      onCreate={async () => ({ success: true })}
      onCancel={() => {}}
    />,
  )

  it('always creates a new task (no "existing task" option)', () => {
    expect(html).not.toContain('Existing task')
    expect(html).toContain('Create Development Task')
  })

  it('asks what kind of change it is, defaulting to Feature', () => {
    expect(html).toContain('aria-label="Type"')
    expect(html).toContain('Feature')
  })

  it('has no branch box before the task exists', () => {
    expect(html).not.toContain('Type a title to see the branch name')
  })

  it('uses OnTask pickers, not native selects', () => {
    expect(html).not.toContain('<select')
    for (const label of ['Type', 'Goal', 'Assignee', 'Priority']) {
      expect(html).toContain(`aria-label="${label}"`)
    }
  })
})

describe('BranchCollisionNotice', () => {
  const name = 'feature/google-oauth-abrar'
  const notice = (finished: boolean, takeOver = false) =>
    renderToStaticMarkup(
      <BranchCollisionNotice
        collision={branchCollision(name, [
          {
            branchName: name,
            taskId: 't-old',
            title: 'Implement Google OAuth',
            finished,
          },
        ])!}
        takeOver={takeOver}
        onTakeOverChange={() => {}}
      />,
    )

  it('names the task that already has the branch, and gives this one a numbered name', () => {
    const html = notice(false)
    expect(html).toContain(
      'This branch is already linked to another Development Task',
    )
    expect(html).toContain('Implement Google OAuth')
    expect(html).toContain(`${name}-02`)
    // An active task's branch is never offered.
    expect(html).not.toContain('type="checkbox"')
  })

  it('offers a finished task’s name, and says what reusing it means', () => {
    expect(notice(true)).toContain('type="checkbox"')
    const html = notice(true, true)
    expect(html).toContain('keeps its history')
    expect(html).not.toContain(`${name}-02`)
  })
})

describe('SelectMenu', () => {
  it('shows the chosen option on a closed listbox trigger', () => {
    const html = renderToStaticMarkup(
      <SelectMenu
        label="Priority"
        value="high"
        options={[
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' },
        ]}
        onChange={() => {}}
      />,
    )
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('High')
    expect(html).not.toContain('role="listbox"')
  })

  it('shows the placeholder when nothing matches', () => {
    const html = renderToStaticMarkup(
      <SelectMenu
        label="Goal"
        value="missing"
        placeholder="Pick a goal"
        options={[{ value: 'g1', label: 'Launch' }]}
        onChange={() => {}}
      />,
    )
    expect(html).toContain('Pick a goal')
  })
})

describe('DevelopmentTaskCreated', () => {
  const html = renderToStaticMarkup(
    <DevelopmentTaskCreated
      title="Implement Google OAuth"
      branchName="feature/google-oauth-abrar-02"
      onOpenTask={() => {}}
      onDone={() => {}}
    />,
  )

  it('shows the final branch name with a copy button', () => {
    expect(html).toContain('feature/google-oauth-abrar-02')
    expect(html).toContain('Copy: feature/google-oauth-abrar-02')
  })

  it('offers the git command, copyable too', () => {
    expect(html).toContain('git checkout -b feature/google-oauth-abrar-02')
    expect(html).toContain(
      'Copy: git checkout -b feature/google-oauth-abrar-02',
    )
  })
})
