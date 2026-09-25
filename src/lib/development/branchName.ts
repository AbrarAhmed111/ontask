// The branch name a Development Task asks its developer to create. OnTask never
// creates the branch -- this exact name is what lets it recognise the branch,
// and the Pull Request opened from it, when GitHub reports them.
//
//   "Implement Google OAuth" + Abrar Ahmed  ->  feature/google-oauth-abrar
//   a Bug "Login button broken" + Iqra      ->  fix/login-button-broken-iqra
//
// Deterministic (same title and assignee, same name), lowercase, and limited to
// letters, digits, "-" and "/" -- the same rule the database enforces
// (claim_development_branch_name), which is also what makes the name unique in
// the workspace by adding -02, -03, ... when it is already taken.

import { workTypeInfo } from '@/lib/development/tracking'
import type { DevelopmentWorkType } from '@/types/workspace'

// Longest task part, before the assignee is added. Cut at a word boundary.
const TASK_SLUG_MAX = 40
const ASSIGNEE_SLUG_MAX = 20

// Mirrors the database CHECK (task_development.branch_name) and leaves room
// for a -N suffix under its 100-character limit.
const BRANCH_NAME_PATTERN = /^[a-z0-9]+([-/][a-z0-9]+)*$/
export const BRANCH_NAME_MAX = 90

// A task title usually starts with what to do; the branch already says it is a
// feature, so a leading "Implement"/"Add"/... says nothing ("Implement Google
// OAuth" -> google-oauth). Only one, and only when something is left after it.
const LEADING_VERBS = new Set([
  'implement',
  'add',
  'build',
  'create',
  'make',
  'develop',
  'introduce',
  'support',
])

const FILLER_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'for',
  'of',
  'and',
  'in',
  'on',
  'with',
  'into',
])

// Lowercase ASCII words: accents folded (é -> e), everything else a separator.
function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// Whole words up to `max` characters; a single overlong word is cut.
function joinWithin(parts: string[], max: number): string {
  let out = ''
  for (const part of parts) {
    const next = out ? `${out}-${part}` : part
    if (next.length > max) break
    out = next
  }
  return out || (parts[0] ?? '').slice(0, max)
}

// For a fix the branch already starts with fix/ (or hotfix/), so a leading
// "Fix"/"Resolve" repeats it: "Fix login button" -> fix/login-button.
const FIX_VERBS = new Set(['fix', 'resolve', 'repair'])

export function taskSlug(
  title: string,
  workType: DevelopmentWorkType = 'feature',
): string {
  let parts = words(title)
  const isFix = workType === 'bug' || workType === 'hotfix'
  if (
    parts.length > 1 &&
    (LEADING_VERBS.has(parts[0]) || (isFix && FIX_VERBS.has(parts[0])))
  )
    parts = parts.slice(1)
  const meaningful = parts.filter(part => !FILLER_WORDS.has(part))
  return joinWithin(meaningful.length > 0 ? meaningful : parts, TASK_SLUG_MAX)
}

// The assignee's first name ("Abrar Ahmed" -> abrar), else the start of their
// email address.
export function assigneeSlug(
  person: { fullName?: string | null; email?: string | null } | null,
): string {
  if (!person) return ''
  const fromName = words(person.fullName ?? '')[0]
  const fromEmail = words((person.email ?? '').split('@')[0])[0]
  return (fromName ?? fromEmail ?? '').slice(0, ASSIGNEE_SLUG_MAX)
}

export function generateBranchName(
  title: string,
  assignee: { fullName?: string | null; email?: string | null } | null,
  workType: DevelopmentWorkType = 'feature',
): string {
  const task = taskSlug(title, workType) || 'task'
  const person = assigneeSlug(assignee)
  return `${workTypeInfo(workType).branchPrefix}${person ? `${task}-${person}` : task}`
}

export function isValidBranchName(name: string): boolean {
  return (
    name.length >= 3 &&
    name.length <= BRANCH_NAME_MAX &&
    BRANCH_NAME_PATTERN.test(name)
  )
}

// What a developer runs to start. Shown next to the name, never executed.
export function checkoutCommand(branchName: string): string {
  return `git checkout -b ${branchName}`
}

// The name the database will give a new task: `base` if it is free in the
// workspace, else base-02, base-03, ... -- the same rule as
// claim_development_branch_name (migration 20260926160000). Only a preview:
// the server decides, and says the final name after creating the task.
export function numberedBranchName(
  base: string,
  taken: Iterable<string>,
): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${String(n).padStart(2, '0')}`
    if (!used.has(candidate)) return candidate
  }
}

// Whether `name` is `base` with a number the database added (base-02, ...),
// i.e. the same name, not a different one.
export function isNumberedVariant(name: string, base: string): boolean {
  return (
    name.startsWith(`${base}-`) && /^\d{2,}$/.test(name.slice(base.length + 1))
  )
}
