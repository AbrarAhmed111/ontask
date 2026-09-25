import { describe, expect, it } from 'vitest'
import {
  assigneeSlug,
  generateBranchName,
  isNumberedVariant,
  isValidBranchName,
  numberedBranchName,
  taskSlug,
} from '@/lib/development/branchName'
import { WORK_TYPES, developmentStage } from '@/lib/development/tracking'
import type {
  DevelopmentTrackingStatus,
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
  const stage = (
    status: WorkspaceTaskStatus,
    trackingStatus: DevelopmentTrackingStatus,
  ) => developmentStage({ status }, { trackingStatus })

  it('follows GitHub while the task is open', () => {
    expect(stage('queued', 'waiting')).toBe('queued')
    expect(stage('queued', 'branch_detected')).toBe('in_development')
    expect(stage('working', 'in_review')).toBe('in_review')
  })

  it('treats a PR closed without merging as back in development, not done', () => {
    expect(stage('paused', 'pr_closed')).toBe('in_development')
  })

  it('does not call a still-open task completed just because its PR merged', () => {
    expect(stage('blocked', 'merged')).toBe('in_development')
  })

  it('shows a finished task as completed whatever GitHub says', () => {
    expect(stage('completed', 'waiting')).toBe('completed')
    expect(stage('completed', 'merged')).toBe('completed')
    expect(stage('skipped', 'in_review')).toBe('completed')
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
