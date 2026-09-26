import {
  MentionRange,
  mentionedUserIds,
  mentionLabel,
  mentionsFromText,
} from '@/lib/mentions'
import type {
  DailyUpdate,
  DailyUpdateItem,
  DailyUpdateItemType,
  DailyUpdateTaskKind,
  DailyUpdateTaskRef,
  WorkspaceMember,
  WorkspaceTaskStatus,
} from '@/types/workspace'

// The pure half of Daily Updates: what the three sections are, how a member's
// draft becomes what the server stores (and back), who the page lists and in
// what order, the workspace-local calendar day, and the local draft. The hooks
// and components on top of this hold no rules of their own.
//
// A Daily Update is a REPORT of what a member says -- distinct from Activity
// (what actually happened) and from the Daily Report (the AI summary of it).
// Nothing here reads or changes a task: an item may reference one by id, and
// that is all. Whether a reference is allowed (same workspace, real member
// mentions) is decided by the server (submit_daily_update, migration 0049);
// this file only shapes the request and reads the answer.

export const MAX_ITEMS_PER_SECTION = 20
export const MAX_ITEM_LENGTH = 500

export type DailyUpdateSection = {
  type: DailyUpdateItemType
  title: string
  placeholder: string
  // What the card says when the member reported nothing under it.
  empty: string
}

// In the order they are asked -- the order every card and the form use.
export const DAILY_UPDATE_SECTIONS: readonly DailyUpdateSection[] = [
  {
    type: 'done',
    title: 'What Is Done?',
    placeholder: 'Completed…',
    empty: 'Nothing reported',
  },
  {
    type: 'blocker',
    title: 'Any Blocker?',
    placeholder: 'Waiting on… (type @ to ask someone)',
    empty: 'No blockers',
  },
  {
    type: 'next',
    title: "What's Next?",
    placeholder: 'Working on…',
    empty: 'Nothing planned',
  },
]

// ── the draft ───────────────────────────────────────────────────────────────

// A task an item points at. `title` is null when the task no longer exists: the
// reference is kept (so editing the update never silently drops it) but there is
// nothing to show for it.
export type DraftTaskRef = {
  id: string
  title: string | null
  kind: DailyUpdateTaskKind
  status: WorkspaceTaskStatus | null
  goalName: string | null
  parentTitle: string | null
}

export type DraftItem = {
  // Only for React keys and focus -- never sent anywhere.
  key: string
  text: string
  mentions: MentionRange[]
  task: DraftTaskRef | null
}

export type DraftUpdate = Record<DailyUpdateItemType, DraftItem[]>

let keySequence = 0
export function newItemKey(): string {
  keySequence += 1
  return `draft-item-${keySequence}`
}

export function newDraftItem(
  text = '',
  task: DraftTaskRef | null = null,
): DraftItem {
  return { key: newItemKey(), text, mentions: [], task }
}

// One empty row per section, so typing can start straight away.
export function emptyDraft(): DraftUpdate {
  return {
    done: [newDraftItem()],
    blocker: [newDraftItem()],
    next: [newDraftItem()],
  }
}

// Empty rows are only placeholders for typing: they are neither stored nor
// counted.
function meaningful(item: DraftItem): boolean {
  return normalizeText(item.text) !== ''
}

// One line per item: a line break (pasted, or from an odd keyboard) is a space.
export function normalizeText(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

export function draftItemCount(draft: DraftUpdate): number {
  return DAILY_UPDATE_SECTIONS.reduce(
    (total, section) => total + draft[section.type].filter(meaningful).length,
    0,
  )
}

// What submit_daily_update takes: every non-empty item, section by section, in
// the order the member arranged them, with task and mentions by id.
export type SubmitItem = {
  type: DailyUpdateItemType
  content: string
  task_id: string | null
  mentioned_user_ids: string[]
}

export function draftToPayload(draft: DraftUpdate): SubmitItem[] {
  return DAILY_UPDATE_SECTIONS.flatMap(section =>
    draft[section.type].filter(meaningful).map(item => ({
      type: section.type,
      content: normalizeText(item.text),
      task_id: item.task?.id ?? null,
      mentioned_user_ids: mentionedUserIds(item.mentions),
    })),
  )
}

// Why a draft can't be submitted, in words for the member; null when it can.
export function draftProblem(draft: DraftUpdate): string | null {
  if (draftItemCount(draft) === 0) return 'Add at least one item to submit.'
  for (const section of DAILY_UPDATE_SECTIONS) {
    const items = draft[section.type].filter(meaningful)
    if (items.length > MAX_ITEMS_PER_SECTION) {
      return `"${section.title}" can hold ${MAX_ITEMS_PER_SECTION} items at most.`
    }
    if (items.some(item => normalizeText(item.text).length > MAX_ITEM_LENGTH)) {
      return `Each item can be ${MAX_ITEM_LENGTH} characters at most.`
    }
  }
  return null
}

// Whether the draft differs from what was submitted -- so "Update" is only
// offered when there is something to update.
export function sameContent(a: DraftUpdate, b: DraftUpdate): boolean {
  return JSON.stringify(draftToPayload(a)) === JSON.stringify(draftToPayload(b))
}

// A pasted block becomes one item per line. Blank lines separate items just as
// line breaks do, and a leading bullet, tick or number ("- ", "* ", "✓ ",
// "1. ") is the list formatting, not part of the item.
export function splitPastedText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•‣▪✓✔]|\d+[.)])\s+/, '').trim())
    .filter(line => line !== '')
}

// Move an item within its section; out-of-range moves leave it where it is.
export function moveItem(
  items: readonly DraftItem[],
  index: number,
  delta: -1 | 1,
): DraftItem[] {
  const target = index + delta
  if (
    index < 0 ||
    index >= items.length ||
    target < 0 ||
    target >= items.length
  ) {
    return [...items]
  }
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function taskRefFromTask(task: DailyUpdateTaskRef): DraftTaskRef {
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    status: task.status,
    goalName: task.goalName,
    parentTitle: task.parentTitle,
  }
}

// Rebuild a draft from a submitted update, to edit it. Only user ids are stored
// for mentions, so each is found again by its "@Name" in the text (see
// mentionsFromText); a mentioned person who has since left the workspace isn't
// in `members` and simply isn't carried into the edit.
export function draftFromUpdate(
  update: DailyUpdate,
  members: readonly Pick<WorkspaceMember, 'userId' | 'fullName' | 'email'>[],
): DraftUpdate {
  const draft: DraftUpdate = { done: [], blocker: [], next: [] }
  for (const item of update.items) {
    const mentioned = item.mentionedUserIds.flatMap(userId => {
      const member = members.find(m => m.userId === userId)
      return member ? [member] : []
    })
    draft[item.type].push({
      key: newItemKey(),
      text: item.content,
      mentions: mentionsFromText(item.content, mentioned),
      task: item.task
        ? taskRefFromTask(item.task)
        : item.taskSnapshot
          ? taskRefFromTask(item.taskSnapshot)
          : item.taskId
            ? {
                id: item.taskId,
                title: null,
                kind: 'task',
                status: null,
                goalName: null,
                parentTitle: null,
              }
            : null,
    })
  }
  // A section with nothing keeps one empty row to type into.
  for (const section of DAILY_UPDATE_SECTIONS) {
    if (draft[section.type].length === 0)
      draft[section.type].push(newDraftItem())
  }
  return draft
}

// ── reading what the server returns ─────────────────────────────────────────

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null
const ITEM_TYPES: readonly string[] = ['done', 'blocker', 'next']
const TASK_KINDS: readonly string[] = ['task', 'goal_task', 'goal_subtask']
const TASK_STATUSES: readonly string[] = [
  'queued',
  'working',
  'paused',
  'blocked',
  'completed',
  'skipped',
]

function readTask(value: unknown): DailyUpdateTaskRef | null {
  if (!isObject(value)) return null
  const id = asString(value.id)
  const title = asString(value.title)
  if (!id || title === null) return null
  const status = asString(value.status)
  const kind = asString(value.kind)
  return {
    id,
    title,
    status: (status && TASK_STATUSES.includes(status)
      ? status
      : 'queued') as WorkspaceTaskStatus,
    kind: (kind && TASK_KINDS.includes(kind)
      ? kind
      : 'task') as DailyUpdateTaskKind,
    goalId: asString(value.goal_id),
    goalName: asString(value.goal_name),
    parentTaskId: asString(value.parent_task_id),
    parentTitle: asString(value.parent_title),
  }
}

function readItem(value: unknown): DailyUpdateItem | null {
  if (!isObject(value)) return null
  const id = asString(value.id)
  const type = asString(value.type)
  const content = asString(value.content)
  // An item without words, or in a section that doesn't exist, is left out
  // rather than shown half-formed.
  if (!id || !type || !ITEM_TYPES.includes(type) || !content?.trim())
    return null
  return {
    id,
    type: type as DailyUpdateItemType,
    content,
    position: typeof value.position === 'number' ? value.position : 0,
    taskId: asString(value.task_id),
    taskSnapshot: readTask(value.task_snapshot),
    task: readTask(value.task),
    mentionedUserIds: Array.isArray(value.mentioned_user_ids)
      ? value.mentioned_user_ids.filter(
          (id): id is string => typeof id === 'string',
        )
      : [],
  }
}

// get_daily_updates' answer -> updates. Anything malformed or null is skipped,
// never thrown on: a bad row must not take the page down.
export function readUpdates(value: unknown): DailyUpdate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    if (!isObject(entry)) return []
    const id = asString(entry.id)
    const userId = asString(entry.user_id)
    const reportDate = asString(entry.report_date)
    const submittedAt = asString(entry.submitted_at)
    if (!id || !userId || !reportDate || !submittedAt) return []
    const items = Array.isArray(entry.items)
      ? entry.items.flatMap(item => {
          const read = readItem(item)
          return read ? [read] : []
        })
      : []
    return [
      {
        id,
        userId,
        reportDate,
        submittedAt,
        editedAt: asString(entry.edited_at),
        items,
      },
    ]
  })
}

export function itemsOfType(
  update: DailyUpdate,
  type: DailyUpdateItemType,
): DailyUpdateItem[] {
  return update.items
    .filter(item => item.type === type)
    .sort((a, b) => a.position - b.position)
}

// ── who the page lists, and in what order ───────────────────────────────────

export type MemberDay = {
  member: WorkspaceMember
  // null = Not Reported: they have not submitted an update for this date. It says
  // nothing about their work, activity, blockers or availability.
  update: DailyUpdate | null
}

const byName = (a: WorkspaceMember, b: WorkspaceMember) =>
  mentionLabel(a).localeCompare(mentionLabel(b), undefined, {
    sensitivity: 'base',
  })

// You first, then the owner, then everyone else by when they joined -- and by
// name and id as tie-breakers, so the order never depends on the order members
// happen to arrive in and never changes between renders (a card must not jump
// because someone else just submitted).
export function orderMembers(
  members: readonly WorkspaceMember[],
  currentUserId: string,
): WorkspaceMember[] {
  const rank = (member: WorkspaceMember) =>
    member.userId === currentUserId ? 0 : member.role === 'owner' ? 1 : 2
  return [...members].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Date.parse(a.joinedAt) - Date.parse(b.joinedAt) ||
      byName(a, b) ||
      a.userId.localeCompare(b.userId),
  )
}

// One entry for EVERY member, reported or not. An update from someone who is no
// longer a member has no card (the page is about the current team).
export function buildDay(
  members: readonly WorkspaceMember[],
  updates: readonly DailyUpdate[],
  currentUserId: string,
): MemberDay[] {
  const byUser = new Map(updates.map(update => [update.userId, update]))
  return orderMembers(members, currentUserId).map(member => ({
    member,
    update: byUser.get(member.userId) ?? null,
  }))
}

export type ReportingSummary = {
  reported: number
  notReported: number
  total: number
}

export function summarizeDay(day: readonly MemberDay[]): ReportingSummary {
  const reported = day.filter(entry => entry.update !== null).length
  return {
    reported,
    notReported: day.length - reported,
    total: day.length,
  }
}

// ── task references, as they read ───────────────────────────────────────────

export type TaskReferenceView =
  // The task is there: what to call it, and where in a Goal it sits.
  | {
      state: 'available'
      taskId: string
      title: string
      goalName: string | null
      parentTitle: string | null
      kind: DailyUpdateTaskKind
    }
  // The item pointed at a task that has since been deleted.
  | {
      state: 'unavailable'
      title: string | null
      goalName: string | null
      parentTitle: string | null
      kind: DailyUpdateTaskKind
    }

export function referenceOf(item: DailyUpdateItem): TaskReferenceView | null {
  if (item.task) {
    return {
      state: 'available',
      taskId: item.task.id,
      title: item.task.title,
      goalName: item.task.goalName,
      parentTitle: item.task.parentTitle,
      kind: item.task.kind,
    }
  }
  return item.taskId
    ? {
        state: 'unavailable',
        title: item.taskSnapshot?.title ?? null,
        goalName: item.taskSnapshot?.goalName ?? null,
        parentTitle: item.taskSnapshot?.parentTitle ?? null,
        kind: item.taskSnapshot?.kind ?? 'task',
      }
    : null
}

export const TASK_UNAVAILABLE_LABEL = 'Referenced task no longer available'

// Where the reference leads: the overview, which brings that task into view
// (and opens its Goal) -- the same deep link a notification uses, so there is
// no second task detail.
export function taskHref(workspaceSlug: string, taskId: string): string {
  return `/workspaces/${workspaceSlug}?task=${encodeURIComponent(taskId)}`
}

// ── dates and times ─────────────────────────────────────────────────────────

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidDay(value: string): boolean {
  const match = DAY_RE.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

// Today's calendar day (YYYY-MM-DD) on the workspace's clock -- the same one
// the server uses to decide which day an update belongs to (an update is always
// for the workspace-local day, whatever the reader's own timezone says).
export function workspaceToday(
  timeZone: string,
  now: Date = new Date(),
): string {
  const zone = timeZone || 'UTC'
  try {
    // en-CA renders numeric dates as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    // An unknown zone name: fall back to UTC, as the server's coalesce does.
    return now.toISOString().slice(0, 10)
  }
}

export function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, date + delta))
  return shifted.toISOString().slice(0, 10)
}

// "September 20, 2026" -- a calendar day is not an instant, so it is formatted
// as itself in UTC and never shifted by the reader's timezone.
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, date)))
}

// "9:42 AM" in the reader's own locale and zone, like every other timestamp in
// the workspace (the Daily Report's, the activity feed's).
export function formatClock(iso: string): string {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return ''
  return time.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

// "Submitted at 9:42 AM", and once it was changed, "Updated at 10:15 AM" too.
export function submissionLabels(update: DailyUpdate): string[] {
  const labels = [`Submitted at ${formatClock(update.submittedAt)}`]
  if (update.editedAt) labels.push(`Updated at ${formatClock(update.editedAt)}`)
  return labels
}

// ── the local draft ─────────────────────────────────────────────────────────
// Half-typed content is a browser-only draft (it is never "submitted" and never
// reaches the server until the member submits). Kept per person, workspace and
// day, in localStorage; every access is guarded because storage can be missing,
// full or blocked, and the form has to work without it.

type StoredItem = {
  text: string
  mentions: MentionRange[]
  task: DraftTaskRef | null
}
type StoredDraft = Record<DailyUpdateItemType, StoredItem[]>

export function draftStorageKey(
  userId: string,
  workspaceId: string,
  day: string,
): string {
  return `ontask:daily-update-draft:${userId}:${workspaceId}:${day}`
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function saveDraft(
  key: string,
  draft: DraftUpdate,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    // Nothing worth keeping: don't leave an empty draft behind.
    if (draftItemCount(draft) === 0) {
      storage.removeItem(key)
      return
    }
    const stored: StoredDraft = { done: [], blocker: [], next: [] }
    for (const section of DAILY_UPDATE_SECTIONS) {
      stored[section.type] = draft[section.type].map(item => ({
        text: item.text,
        mentions: item.mentions,
        task: item.task,
      }))
    }
    storage.setItem(key, JSON.stringify(stored))
  } catch {
    // Storage full or blocked: the draft just isn't kept.
  }
}

export function clearDraft(
  key: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(key)
  } catch {
    // Nothing to do.
  }
}

const isMentionRange = (value: unknown): value is MentionRange =>
  isObject(value) &&
  typeof value.userId === 'string' &&
  typeof value.label === 'string' &&
  typeof value.start === 'number' &&
  typeof value.end === 'number'

const isTaskRef = (value: unknown): value is DraftTaskRef =>
  isObject(value) &&
  typeof value.id === 'string' &&
  (value.title === null || typeof value.title === 'string') &&
  typeof value.kind === 'string' &&
  TASK_KINDS.includes(value.kind)

// The saved draft, or null when there is none or it can't be trusted (corrupt,
// from another version of the app). Mentions of people who are no longer members
// are dropped: the server would refuse them.
export function loadDraft(
  key: string,
  members: readonly Pick<WorkspaceMember, 'userId'>[],
  storage: StorageLike | null = defaultStorage(),
): DraftUpdate | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)) return null
    const knownUsers = new Set(members.map(member => member.userId))
    const draft: DraftUpdate = { done: [], blocker: [], next: [] }
    for (const section of DAILY_UPDATE_SECTIONS) {
      const stored = parsed[section.type]
      if (!Array.isArray(stored)) continue
      for (const entry of stored) {
        if (!isObject(entry) || typeof entry.text !== 'string') continue
        draft[section.type].push({
          key: newItemKey(),
          text: entry.text,
          mentions: Array.isArray(entry.mentions)
            ? entry.mentions
                .filter(isMentionRange)
                .filter(mention => knownUsers.has(mention.userId))
            : [],
          task: isTaskRef(entry.task) ? entry.task : null,
        })
      }
    }
    for (const section of DAILY_UPDATE_SECTIONS) {
      if (draft[section.type].length === 0) {
        draft[section.type].push(newDraftItem())
      }
    }
    return draftItemCount(draft) === 0 ? null : draft
  } catch {
    return null
  }
}

// ── the task picker's suggestions ───────────────────────────────────────────

export type TaskCandidateReason =
  'match' | 'completed' | 'blocked' | 'in_progress' | 'assigned' | 'worked_on'

// One task offered for a reference: what daily_update_task_candidates returns
// (already limited and ranked for the section by the server).
export type TaskCandidate = {
  taskId: string
  title: string
  status: WorkspaceTaskStatus
  kind: DailyUpdateTaskKind
  goalId: string | null
  goalName: string | null
  parentTaskId: string | null
  parentTitle: string | null
  assignedTo: string | null
  reason: TaskCandidateReason
}

const REASONS: readonly string[] = [
  'match',
  'completed',
  'blocked',
  'in_progress',
  'assigned',
  'worked_on',
]

export function readCandidates(value: unknown): TaskCandidate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(row => {
    if (!isObject(row)) return []
    const taskId = asString(row.task_id)
    const title = asString(row.title)
    if (!taskId || !title?.trim()) return []
    const status = asString(row.status)
    const kind = asString(row.kind)
    const reason = asString(row.reason)
    return [
      {
        taskId,
        title,
        status: (status && TASK_STATUSES.includes(status)
          ? status
          : 'queued') as WorkspaceTaskStatus,
        kind: (kind && TASK_KINDS.includes(kind)
          ? kind
          : 'task') as DailyUpdateTaskKind,
        goalId: asString(row.goal_id),
        goalName: asString(row.goal_name),
        parentTaskId: asString(row.parent_task_id),
        parentTitle: asString(row.parent_title),
        assignedTo: asString(row.assigned_to),
        reason: (reason && REASONS.includes(reason)
          ? reason
          : 'worked_on') as TaskCandidateReason,
      },
    ]
  })
}

export function taskRefFromCandidate(candidate: TaskCandidate): DraftTaskRef {
  return {
    id: candidate.taskId,
    title: candidate.title,
    kind: candidate.kind,
    status: candidate.status,
    goalName: candidate.goalName,
    parentTitle: candidate.parentTitle,
  }
}

// The small line under a suggestion saying why it is offered.
export const REASON_LABELS: Record<TaskCandidateReason, string> = {
  match: 'Search result',
  completed: 'Completed',
  blocked: 'Blocked',
  in_progress: 'In progress',
  assigned: 'Assigned to you',
  worked_on: 'You worked on this',
}

// ── an item's words, with its mentions marked ───────────────────────────────

export type TextSegment = { text: string; mention: boolean }

// The item's text split so a tagged member's "@Name" can be highlighted. Only
// members still in the workspace can be found (the text of a mention of someone
// who has left just reads as ordinary text). Identity is the user id -- the
// "@Name" is only how it reads.
export function mentionSegments(
  content: string,
  mentioned: readonly Pick<WorkspaceMember, 'userId' | 'fullName' | 'email'>[],
): TextSegment[] {
  const anchored = mentionsFromText(content, mentioned)
    .filter(mention => mention.start >= 0)
    .sort((a, b) => a.start - b.start)
  const segments: TextSegment[] = []
  let cursor = 0
  for (const mention of anchored) {
    if (mention.start < cursor) continue
    if (mention.start > cursor) {
      segments.push({
        text: content.slice(cursor, mention.start),
        mention: false,
      })
    }
    segments.push({
      text: content.slice(mention.start, mention.end),
      mention: true,
    })
    cursor = mention.end
  }
  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor), mention: false })
  }
  return segments
}
