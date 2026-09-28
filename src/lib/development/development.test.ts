import { describe, expect, it } from 'vitest'
import {
  BRANCH_NAME_MAX,
  assigneeSlug,
  generateBranchName,
  isNumberedVariant,
  branchCollision,
  isValidBranchName,
  nextTaskNumber,
  numberedBranchName,
  taskIdLabel,
  taskSlug,
} from '@/lib/development/branchName'
import {
  WORK_TYPES,
  developmentAttention,
  developmentStage,
  isClearedFromBoard,
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
    [
      123,
      'Phase 2 — LLM DM Generation',
      abrar,
      'feature',
      'feature/OT-123-phase-2-llm-dm-generation-abrar',
    ],
    [
      124,
      'Phase 2 LLM Call Scripts',
      abrar,
      'feature',
      'feature/OT-124-phase-2-llm-call-scripts-abrar',
    ],
    [
      125,
      'Phase 2 Web UI Bugs',
      { fullName: 'Iqra' },
      'bug',
      'fix/OT-125-phase-2-web-ui-bugs-iqra',
    ],
    [
      126,
      'Refactor current web code',
      { fullName: 'Iqra' },
      'refactor',
      'refactor/OT-126-refactor-current-web-code-iqra',
    ],
    [
      127,
      'Improve task notifications',
      abrar,
      'improvement',
      'improvement/OT-127-improve-task-notifications-abrar',
    ],
    [
      128,
      'Update CI config',
      { fullName: 'Araysh Khan' },
      'chore',
      'chore/OT-128-update-ci-config-araysh',
    ],
  ] as const)('OT-%i %s -> %s', (id, title, person, type, expected) => {
    expect(generateBranchName(id, title, person, type)).toBe(expected)
  })

  it('takes its prefix from the task type', () => {
    expect(generateBranchName(1, 'Payments down', abrar, 'hotfix')).toBe(
      'hotfix/OT-1-payments-down-abrar',
    )
    expect(generateBranchName(1, 'Setup guide', abrar, 'docs')).toBe(
      'docs/OT-1-setup-guide-abrar',
    )
    expect(generateBranchName(1, 'Setup guide', abrar)).toBe(
      'feature/OT-1-setup-guide-abrar',
    )
  })

  it('keeps the exact task number', () => {
    expect(generateBranchName(1, 'Task', null)).toBe('feature/OT-1-task')
    expect(generateBranchName(1000042, 'Task', null)).toBe(
      'feature/OT-1000042-task',
    )
  })

  it('keeps every word of the title, verbs and small words included', () => {
    expect(generateBranchName(9, 'Fix login button', abrar, 'bug')).toBe(
      'fix/OT-9-fix-login-button-abrar',
    )
    expect(
      generateBranchName(9, 'Implement a way to add the logo', abrar),
    ).toBe('feature/OT-9-implement-a-way-to-add-the-logo-abrar')
  })

  it('refuses a missing or invalid task number', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => generateBranchName(bad, 'Task', abrar)).toThrow(RangeError)
    }
  })

  it('produces a valid name for every type', () => {
    for (const type of WORK_TYPES) {
      expect(
        isValidBranchName(generateBranchName(5, 'A title', abrar, type.value)),
      ).toBe(true)
    }
  })

  it('is deterministic', () => {
    expect(generateBranchName(3, 'Add session handling', abrar)).toBe(
      generateBranchName(3, 'Add session handling', abrar),
    )
  })

  it('leaves the assignee out when there is none', () => {
    expect(generateBranchName(4, 'Add logout flow', null)).toBe(
      'feature/OT-4-add-logout-flow',
    )
    expect(generateBranchName(4, 'Add logout flow', { fullName: '  ' })).toBe(
      'feature/OT-4-add-logout-flow',
    )
  })

  it('removes special characters and spaces, and folds accents', () => {
    expect(
      generateBranchName(12, '  Fix: "café"   menu & login (v2)! ', {
        fullName: 'Zoë',
      }),
    ).toBe('feature/OT-12-fix-cafe-menu-login-v2-zoe')
    expect(generateBranchName(12, 'feat/../x..y~^:?*[@{', null)).toBe(
      'feature/OT-12-feat-x-y',
    )
  })

  it('keeps an accented word whole', () => {
    expect(taskSlug('Naïve résumé parser')).toBe('naive-resume-parser')
  })

  it('falls back to a placeholder for a title with no usable characters', () => {
    expect(generateBranchName(2, '!!!', null)).toBe('feature/OT-2-task')
    expect(generateBranchName(2, '日本語のタイトル', abrar)).toBe(
      'feature/OT-2-task-abrar',
    )
  })

  it('cuts only a title too long for a branch, at a word boundary, and keeps the ID and assignee', () => {
    const title =
      'Build the extremely detailed quarterly analytics export pipeline for enterprise customers across every region'
    const name = generateBranchName(123, title, abrar, 'improvement')
    expect(name.length).toBeLessThanOrEqual(BRANCH_NAME_MAX)
    expect(name).toBe(
      'improvement/OT-123-build-the-extremely-detailed-quarterly-analytics-export-pipeline-abrar',
    )
    expect(isValidBranchName(name)).toBe(true)
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
      'word '.repeat(60),
      '日本語のタイトル',
      '--- / ---',
    ]) {
      for (const id of [1, 99999999]) {
        const name = generateBranchName(id, title, abrar, 'improvement')
        expect(isValidBranchName(name)).toBe(true)
        // Room left for the -02, -03, ... the server may add.
        expect(`${name}-100`.length).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('taskIdLabel', () => {
  it('formats the task number as OT-<n>', () => {
    expect(taskIdLabel(123)).toBe('OT-123')
  })
})

describe('nextTaskNumber', () => {
  it('previews one past the highest known number', () => {
    expect(nextTaskNumber([3, 9, 4])).toBe(10)
  })

  it('starts at 1, ignoring tasks without a number yet', () => {
    expect(nextTaskNumber([])).toBe(1)
    expect(nextTaskNumber([null, undefined])).toBe(1)
  })
})

describe('isValidBranchName', () => {
  it.each([
    ['feature/google-oauth-abrar', true],
    ['feature/OT-123-phase-2-llm-dm-generation-abrar', true],
    ['fix/OT-124-phase-2-web-ui-bugs-iqra-02', true],
    ['feature/OT-x-task', false],
    ['feature/OT--task', false],
    ['feature/ot-1-task/OT-2-task', false],
    ['OT-1/task', false],
    ['feature/Ot-1-task', false],
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

describe('isClearedFromBoard', () => {
  const cleared = { completedClearedAt: '2026-09-27T10:00:00Z' }

  it.each<[WorkspaceTaskStatus, boolean]>([
    ['completed', true],
    ['skipped', true],
    ['queued', false],
    ['working', false],
    ['blocked', false],
    ['paused', false],
  ])('a cleared %s task -> %s', (status, hidden) => {
    expect(isClearedFromBoard({ status }, cleared)).toBe(hidden)
  })

  it('keeps a finished task that was never cleared', () => {
    expect(
      isClearedFromBoard({ status: 'completed' }, { completedClearedAt: null }),
    ).toBe(false)
    // Cached before migration 20260927120000: no field at all.
    expect(isClearedFromBoard({ status: 'completed' }, {})).toBe(false)
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
