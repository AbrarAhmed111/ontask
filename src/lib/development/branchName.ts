// The branch name a Development Task asks its developer to create. OnTask never
// creates the branch -- this exact name is what lets it recognise the branch,
// and the Pull Request opened from it, when GitHub reports them.
//
//   <type>/<task ID>-<task title>-<assignee>
//
//   OT-123 "Phase 2 — LLM DM Generation" + Abrar Ahmed
//     ->  feature/OT-123-phase-2-llm-dm-generation-abrar
//   OT-124 a Bug "Phase 2 Web UI Bugs" + Iqra
//     ->  fix/OT-124-phase-2-web-ui-bugs-iqra
//
// The task ID is the Development Task's own sequential number in its workspace
// (task_development.task_number, migration 20260928120000). The server writes
// that number into the name it stores, so the one the form previews is only a
// guess until the task exists.
//
// Deterministic (same task, title and assignee, same name), lowercase apart
// from the "OT" of the ID, and limited to letters, digits, "-" and "/" -- the
// same rule the database enforces (claim_development_branch_name), which also
// makes the name unique in the workspace by adding -02, -03, ... when taken.

import { workTypeInfo } from '@/lib/development/tracking'
import type { DevelopmentWorkType } from '@/types/workspace'

export const TASK_ID_PREFIX = 'OT'
const ASSIGNEE_SLUG_MAX = 20

// Mirrors the database CHECK (task_development.branch_name) and leaves room
// for a -N suffix under its 100-character limit. The OT-<n> segment is
// optional only so names from before task IDs stay valid.
const BRANCH_NAME_PATTERN = /^[a-z0-9]+(\/OT-[0-9]+)?([-/][a-z0-9]+)*$/
export const BRANCH_NAME_MAX = 90

// "OT-123". Only ever the number the task was given -- never made up.
export function taskIdLabel(taskNumber: number): string {
  if (!Number.isSafeInteger(taskNumber) || taskNumber < 1)
    throw new RangeError(`Invalid task number: ${taskNumber}`)
  return `${TASK_ID_PREFIX}-${taskNumber}`
}

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

// The whole title in kebab-case -- no words dropped, so the branch reads like
// the task. Only a title too long for the branch is cut, at a word boundary.
export function taskSlug(title: string, max = BRANCH_NAME_MAX): string {
  return joinWithin(words(title), max)
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
  taskNumber: number,
  title: string,
  assignee: { fullName?: string | null; email?: string | null } | null,
  workType: DevelopmentWorkType = 'feature',
): string {
  const start = `${workTypeInfo(workType).branchPrefix}${taskIdLabel(taskNumber)}-`
  const person = assigneeSlug(assignee)
  const end = person ? `-${person}` : ''
  const task =
    taskSlug(title, BRANCH_NAME_MAX - start.length - end.length) || 'task'
  return `${start}${task}${end}`
}

// The number the next Development Task in the workspace will probably get,
// for the form's preview. The server allocates the real one (a deleted
// task's number is never reused, so it can be higher).
export function nextTaskNumber(
  taskNumbers: Iterable<number | null | undefined>,
): number {
  let max = 0
  for (const n of taskNumbers) if (n && n > max) max = n
  return max + 1
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

// A Development Task that currently holds a branch name in the workspace (a
// finished task whose name was handed on no longer does).
export type BranchHolder = {
  branchName: string
  taskId: string
  title: string
  // Completed or skipped: its name may be reused, on purpose only.
  finished: boolean
}

export type BranchCollision = {
  holder: BranchHolder
  // What the new task gets unless the name is reused.
  numberedName: string
  // Only a finished task's name can be taken over -- never an active one's.
  canTakeOver: boolean
}

// Whether `name` is already linked to another Development Task, and what the
// server will do about it (claim_development_branch_name, migration
// 20260926200000): one branch is never linked to two tasks.
export function branchCollision(
  name: string,
  holders: BranchHolder[],
): BranchCollision | null {
  const holder = holders.find(h => h.branchName === name)
  if (!holder) return null
  return {
    holder,
    numberedName: numberedBranchName(
      name,
      holders.map(h => h.branchName),
    ),
    canTakeOver: holder.finished,
  }
}
