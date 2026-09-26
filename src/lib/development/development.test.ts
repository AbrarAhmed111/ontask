import { describe, expect, it } from 'vitest'
import {
  assigneeSlug,
  generateBranchName,
  isNumberedVariant,
  branchCollision,
  isValidBranchName,
  numberedBranchName,
  taskSlug,
} from '@/lib/development/branchName'
import {
  WORK_TYPES,
  developmentAttention,
  developmentStage,
} from '@/lib/development/tracking'
import type {
  DevelopmentTrackingStatus,
  GithubConnection,
  TaskDevelopment,
  WorkspaceTaskStatus,
} from '@/types/workspace'

const abrar = { fullName: 'Abrar Ahmed', email: 'abrar@example.com' }

describe('generateBranchName', () => {
  it.each([
    ['Implement Google OAuth', abrar, 'feature/google-oauth-abrar'],
    [
      'Workspace invites',
      { fullName: 'Iqra' },
      'feature/workspace-invites-iqra',
    ],
    [
      'Realtime presence',
      { fullName: 'Araysh Khan' },
      'feature/realtime-presence-araysh',
    ],
  ])('%s -> %s', (title, person, expected) => {
    expect(generateBranchName(title, person)).toBe(expected)
  })

  it('takes its prefix from the task type', () => {
    expect(generateBranchName('Login button broken', abrar, 'bug')).toBe(
      'fix/login-button-broken-abrar',
    )
    expect(generateBranchName('Payments down', abrar, 'hotfix')).toBe(
      'hotfix/payments-down-abrar',
    )
    expect(generateBranchName('Update setup guide', abrar, 'docs')).toBe(
      'docs/update-setup-guide-abrar',
    )
  })

  it('drops a leading "Fix" for a fix, so it is not fix/fix-...', () => {
    expect(generateBranchName('Fix login button', abrar, 'bug')).toBe(
      'fix/login-button-abrar',
    )
    // ...but keeps it for other types, where it carries meaning.
    expect(generateBranchName('Fix login button', abrar)).toBe(
      'feature/fix-login-button-abrar',
    )
  })

  it('produces a valid name for every type', () => {
    for (const type of WORK_TYPES) {
      expect(
        isValidBranchName(generateBranchName('A title', abrar, type.value)),
      ).toBe(true)
    }
  })

  it('is deterministic', () => {
    expect(generateBranchName('Add session handling', abrar)).toBe(
      generateBranchName('Add session handling', abrar),
    )
  })

  it('leaves the assignee out when there is none', () => {
    expect(generateBranchName('Add logout flow', null)).toBe(
      'feature/logout-flow',
    )
  })

  it('removes special characters and folds accents', () => {
    expect(
      generateBranchName('Fix: "café" menu & login (v2)!', {
        fullName: 'Zoë',
      }),
    ).toBe('feature/fix-cafe-menu-login-v2-zoe')
  })

  it('keeps an accented word whole', () => {
    expect(taskSlug('Naïve résumé parser')).toBe('naive-resume-parser')
  })

  it('keeps a lone verb rather than producing nothing', () => {
    expect(taskSlug('Implement')).toBe('implement')
  })

  it('falls back to a placeholder for a title with no usable characters', () => {
    expect(generateBranchName('!!!', null)).toBe('feature/task')
  })

  it('limits length at a word boundary', () => {
    const slug = taskSlug(
      'Build the extremely detailed quarterly analytics export pipeline for enterprise customers',
    )
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug).toBe('extremely-detailed-quarterly-analytics')
  })

  it('uses the email name when there is no full name', () => {
    expect(assigneeSlug({ fullName: null, email: 'dev.ops@example.com' })).toBe(
      'dev',
    )
  })

  it('always produces a name the database accepts', () => {
    for (const title of [
      'Implement Google OAuth',
      '   ',
      'ÄÖÜ ß ñ',
      'a'.repeat(300),
      '日本語のタイトル',
      '--- / ---',
    ]) {
      expect(isValidBranchName(generateBranchName(title, abrar))).toBe(true)
    }
  })
})

describe('isValidBranchName', () => {
  it.each([
    ['feature/google-oauth-abrar', true],
    ['Feature/Upper', false],
    ['feature/has space', false],
    ['feature//double', false],
    ['feature/trailing-', false],
    ['-leading', false],
    ['ab', false],
    [`feature/${'a'.repeat(90)}`, false],
  ])('%s -> %s', (name, valid) => {
    expect(isValidBranchName(name)).toBe(valid)
  })
})

describe('developmentStage', () => {
  const tracked = (
    trackingStatus: DevelopmentTrackingStatus,
    overrides: Partial<TaskDevelopment> = {},
  ) => ({
    trackingStatus,
    branchDeletedAt: null,
    repositoryId: 22,
    repositoryFullName: 'acme/ontask',
    ...overrides,
  })
  const stage = (
    status: WorkspaceTaskStatus,
    trackingStatus: DevelopmentTrackingStatus,
    overrides: Partial<TaskDevelopment> = {},
    connection: Pick<
      GithubConnection,
      'status' | 'repositoryId' | 'repositoryFullName'
    > | null = null,
  ) =>
    developmentStage({ status }, tracked(trackingStatus, overrides), connection)
  const connected = {
    status: 'connected' as const,
    repositoryId: 22,
    repositoryFullName: 'acme/ontask',
  }
  const deleted = { branchDeletedAt: '2026-09-26T10:00:00Z' }

  it('follows GitHub while the task is open', () => {
    expect(stage('queued', 'waiting')).toBe('queued')
    expect(stage('working', 'in_review')).toBe('in_review')
  })

  // However the branch came to exist -- created, pushed from local Git,
  // made in an IDE, renamed to the expected name -- the database records the
  // same 'branch_detected'; the stage only reads that.
  it('a matching branch moves a Queued task to In Development', () => {
    expect(stage('queued', 'branch_detected', {}, connected)).toBe(
      'in_development',
    )
  })

  it('a branch deleted before any PR: Needs Attention, the task kept', () => {
    expect(stage('working', 'branch_detected', deleted, connected)).toBe(
      'needs_attention',
    )
    expect(
      developmentAttention(
        { status: 'working' },
        tracked('branch_detected', deleted),
        connected,
      ),
    ).toBe('branch_deleted')
  })

  it('a branch deleted while its PR is open stays In Review', () => {
    expect(stage('working', 'in_review', deleted, connected)).toBe('in_review')
  })

  it('a branch deleted after the merge never un-completes the task', () => {
    expect(stage('completed', 'merged', deleted, connected)).toBe('completed')
    expect(
      developmentAttention(
        { status: 'completed' },
        tracked('merged', deleted),
        connected,
      ),
    ).toBeNull()
  })

  it('a PR closed without merging is Needs Attention, not done', () => {
    expect(stage('paused', 'pr_closed', {}, connected)).toBe('needs_attention')
    expect(
      developmentAttention(
        { status: 'paused' },
        tracked('pr_closed'),
        connected,
      ),
    ).toBe('pr_closed')
  })

  it('lost repository access is Needs Attention for unfinished tasks only', () => {
    for (const status of [
      'repository_access_lost',
      'suspended',
      'disconnected',
    ] as const) {
      const connection = {
        status,
        repositoryId: 22,
        repositoryFullName: 'acme/ontask',
      }
      expect(stage('working', 'in_review', {}, connection)).toBe(
        'needs_attention',
      )
      expect(stage('completed', 'merged', {}, connection)).toBe('completed')
    }
    // Tracked in a repository the workspace no longer points at.
    expect(
      stage(
        'working',
        'branch_detected',
        {},
        {
          status: 'connected',
          repositoryId: 23,
          repositoryFullName: 'acme/other',
        },
      ),
    ).toBe('needs_attention')
  })

  it('a renamed repository with the same stable id is still accessible', () => {
    expect(
      stage(
        'working',
        'branch_detected',
        { repositoryId: 22, repositoryFullName: 'acme/old-name' },
        {
          status: 'connected',
          repositoryId: 22,
          repositoryFullName: 'acme/new-name',
        },
      ),
    ).toBe('in_development')
  })

  it('no connection at all is "not tracked", not an alarm on every task', () => {
    expect(stage('working', 'branch_detected', {}, null)).toBe('in_development')
  })

  it('does not call a still-open task completed just because its PR merged', () => {
    expect(stage('blocked', 'merged', deleted, connected)).toBe(
      'in_development',
    )
  })

  it('shows a finished task as completed whatever GitHub says', () => {
    expect(stage('completed', 'waiting')).toBe('completed')
    expect(stage('completed', 'merged')).toBe('completed')
    expect(stage('skipped', 'in_review')).toBe('completed')
    expect(stage('completed', 'pr_closed', deleted, connected)).toBe(
      'completed',
    )
  })
})

describe('branchCollision (mirrors claim_development_branch_name)', () => {
  const name = 'feature/google-oauth-abrar'
  const holder = (finished: boolean) => ({
    branchName: name,
    taskId: 't-old',
    title: 'Implement Google OAuth',
    finished,
  })

  it('is nothing while the name is free', () => {
    expect(branchCollision(name, [])).toBeNull()
  })

  it('names the active task and numbers the new one -- never shared', () => {
    expect(branchCollision(name, [holder(false)])).toEqual({
      holder: holder(false),
      numberedName: `${name}-02`,
      canTakeOver: false,
    })
  })

  it('lets a finished task hand its name over, on purpose', () => {
    expect(branchCollision(name, [holder(true)])?.canTakeOver).toBe(true)
  })
})

describe('numberedBranchName (mirrors claim_development_branch_name)', () => {
  const base = 'feature/google-oauth-abrar'

  it('keeps the plain name while it is free', () => {
    expect(numberedBranchName(base, ['feature/other'])).toBe(base)
  })

  it('numbers a repeat -02, then -03', () => {
    expect(numberedBranchName(base, [base])).toBe(`${base}-02`)
    expect(numberedBranchName(base, [base, `${base}-02`])).toBe(`${base}-03`)
  })

  it('reuses a gap left by a deleted task', () => {
    expect(numberedBranchName(base, [base, `${base}-03`])).toBe(`${base}-02`)
  })

  it('numbers past 99 without breaking the pattern', () => {
    const taken = [base]
    for (let n = 2; n <= 99; n++)
      taken.push(`${base}-${String(n).padStart(2, '0')}`)
    expect(numberedBranchName(base, taken)).toBe(`${base}-100`)
    expect(isValidBranchName(`${base}-100`)).toBe(true)
  })
})

describe('isNumberedVariant', () => {
  it('recognises only a number the database added', () => {
    expect(
      isNumberedVariant('feature/login-abrar-02', 'feature/login-abrar'),
    ).toBe(true)
    expect(
      isNumberedVariant('feature/login-abrar-v2', 'feature/login-abrar'),
    ).toBe(false)
    expect(
      isNumberedVariant('feature/login-abrar-iqra', 'feature/login-abrar'),
    ).toBe(false)
  })
})
