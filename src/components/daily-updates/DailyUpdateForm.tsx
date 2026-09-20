'use client'

import {
  ClipboardEvent,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { ChevronDown, ChevronUp, Link2, Plus, X } from 'lucide-react'
import { MentionTextarea } from '@/components/mentions/MentionTextarea'
import { TaskContext } from '@/components/daily-updates/TaskReference'
import { TaskReferencePicker } from '@/components/daily-updates/TaskReferencePicker'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import {
  DAILY_UPDATE_SECTIONS,
  DraftItem,
  DraftUpdate,
  DailyUpdateSection,
  MAX_ITEMS_PER_SECTION,
  MAX_ITEM_LENGTH,
  TASK_UNAVAILABLE_LABEL,
  TaskCandidate,
  clearDraft,
  draftItemCount,
  draftProblem,
  draftToPayload,
  moveItem,
  newDraftItem,
  sameContent,
  saveDraft,
  splitPastedText,
  taskRefFromCandidate,
  SubmitItem,
} from '@/lib/dailyUpdates'
import type { MentionValue } from '@/components/mentions/MentionTextarea'
import type { DailyUpdateItemType, WorkspaceMember } from '@/types/workspace'

const rowId = (key: string) => `daily-update-${key}`

function ItemRow({
  item,
  index,
  count,
  section,
  members,
  excludeUserIds,
  workspaceId,
  onChange,
  onEnter,
  onBackspaceEmpty,
  onPaste,
  onMove,
  onRemove,
  onSubmit,
}: {
  item: DraftItem
  index: number
  count: number
  section: DailyUpdateSection
  members: readonly WorkspaceMember[]
  excludeUserIds: readonly string[]
  workspaceId: string
  onChange: (next: DraftItem) => void
  onEnter: () => void
  onBackspaceEmpty: () => void
  onPaste: (text: string) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
  onSubmit: () => void
}) {
  const [picking, setPicking] = useState(false)
  const label = `${section.title} item ${index + 1}`

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME composing text must not have its Enter taken as "next item".
    if (event.nativeEvent.isComposing) return
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      // One line per item: Enter starts the next one instead of a line break.
      event.preventDefault()
      onEnter()
    } else if (event.key === 'Backspace' && item.text === '' && count > 1) {
      event.preventDefault()
      onBackspaceEmpty()
    }
  }
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text')
    if (!/[\r\n]/.test(text)) return
    // Several lines in one go become several items.
    event.preventDefault()
    onPaste(text)
  }

  return (
    <li className="group flex items-start gap-1.5">
      <div className="min-w-0 flex-1">
        <MentionTextarea
          id={rowId(item.key)}
          ariaLabel={label}
          value={{ text: item.text, mentions: item.mentions }}
          onChange={(next: MentionValue) =>
            onChange({ ...item, text: next.text, mentions: next.mentions })
          }
          members={members}
          exclude={excludeUserIds}
          placeholder={section.placeholder}
          maxLength={MAX_ITEM_LENGTH}
          rows={Math.min(4, Math.max(1, Math.ceil(item.text.length / 64)))}
          onSubmitShortcut={onSubmit}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <div className="relative mt-1.5 flex flex-wrap items-center gap-1.5">
          {item.task ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-white/70 py-0.5 pl-2 pr-1 text-[11px]">
              {item.task.title === null ? (
                <span className="italic text-muted">
                  {TASK_UNAVAILABLE_LABEL}
                </span>
              ) : (
                <TaskContext
                  title={item.task.title}
                  goalName={item.task.goalName}
                  parentTitle={item.task.parentTitle}
                  kind={item.task.kind}
                />
              )}
              <button
                type="button"
                aria-label="Remove task reference"
                onClick={() => onChange({ ...item, task: null })}
                className="rounded p-0.5 text-muted transition hover:bg-slate-100 hover:text-ink"
              >
                <X size={11} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted transition hover:bg-slate-100 hover:text-ink"
            >
              <Link2 size={11} /> Link a task
            </button>
          )}
          {picking && (
            <TaskReferencePicker
              workspaceId={workspaceId}
              itemType={section.type}
              onSelect={(candidate: TaskCandidate) => {
                onChange({ ...item, task: taskRefFromCandidate(candidate) })
                setPicking(false)
              }}
              onClose={() => setPicking(false)}
            />
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col pt-1 text-muted">
        <button
          type="button"
          aria-label={`Move ${label} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className="rounded p-0.5 transition hover:bg-slate-100 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronUp size={13} />
        </button>
        <button
          type="button"
          aria-label={`Move ${label} down`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          className="rounded p-0.5 transition hover:bg-slate-100 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronDown size={13} />
        </button>
      </div>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="mt-1.5 shrink-0 rounded p-1 text-muted transition hover:bg-slate-100 hover:text-ink"
      >
        <X size={14} />
      </button>
    </li>
  )
}

// The pre-standup form: three lists -- What Is Done?, Any Blocker?, What's Next?
// -- each a run of separate items you type straight into. Enter starts the next
// item, Backspace on an empty one goes back, a pasted block becomes one item per
// line, and each item can carry a task and @mentions. Nothing here changes a
// task: a blocker item is only what you are reporting.
//
// What you have typed is kept in this browser as a draft until you submit (it is
// not "submitted" until then); editing something already submitted is not
// drafted, the submitted version simply stays until you save.
export function DailyUpdateForm({
  workspaceId,
  currentUserId,
  members,
  initial,
  submitted,
  draftKey,
  onSubmit,
  onCancel,
}: {
  workspaceId: string
  currentUserId: string
  members: readonly WorkspaceMember[]
  initial: DraftUpdate
  // The draft the update was submitted as, when editing one: what "changed" means.
  submitted: DraftUpdate | null
  draftKey: string
  onSubmit: (
    items: SubmitItem[],
  ) => Promise<{ success: boolean; error?: string }>
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState<DraftUpdate>(initial)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const editing = submitted !== null

  // Keep the draft (only for an update not yet submitted).
  useEffect(() => {
    if (!editing) saveDraft(draftKey, draft)
  }, [draft, draftKey, editing])

  // Move focus to the row a keystroke asked for, once it exists.
  useLayoutEffect(() => {
    const key = pendingFocus.current
    if (!key) return
    pendingFocus.current = null
    const element = document.getElementById(rowId(key))
    if (element instanceof HTMLTextAreaElement) {
      element.focus()
      element.setSelectionRange(element.value.length, element.value.length)
    }
  })

  const update = (type: DailyUpdateItemType, items: DraftItem[]) =>
    setDraft(current => ({ ...current, [type]: items }))

  const problem = draftProblem(draft)
  const unchanged = editing && sameContent(draft, submitted)

  const submit = async () => {
    if (submitting) return
    const blocked = draftProblem(draft)
    if (blocked) {
      setError(blocked)
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await onSubmit(draftToPayload(draft))
    setSubmitting(false)
    if (result.success) {
      clearDraft(draftKey)
    } else {
      setError(result.error || 'Could not submit your update.')
    }
  }

  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        void submit()
      }}
      className="space-y-5"
    >
      {DAILY_UPDATE_SECTIONS.map(section => {
        const items = draft[section.type]
        return (
          <fieldset key={section.type} className="min-w-0">
            <legend className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
              {section.title}
            </legend>
            <ul className="mt-2 space-y-3">
              {items.map((item, index) => (
                <ItemRow
                  key={item.key}
                  item={item}
                  index={index}
                  count={items.length}
                  section={section}
                  members={members}
                  excludeUserIds={[currentUserId]}
                  workspaceId={workspaceId}
                  onChange={next =>
                    update(
                      section.type,
                      items.map(candidate =>
                        candidate.key === item.key ? next : candidate,
                      ),
                    )
                  }
                  onEnter={() => {
                    // Enter on an empty row does nothing: no pile of blank rows.
                    if (
                      item.text.trim() === '' ||
                      items.length >= MAX_ITEMS_PER_SECTION
                    )
                      return
                    const next = newDraftItem()
                    pendingFocus.current = next.key
                    update(section.type, [
                      ...items.slice(0, index + 1),
                      next,
                      ...items.slice(index + 1),
                    ])
                  }}
                  onBackspaceEmpty={() => {
                    const previous = items[index - 1] ?? items[index + 1]
                    if (previous) pendingFocus.current = previous.key
                    update(
                      section.type,
                      items.filter(candidate => candidate.key !== item.key),
                    )
                  }}
                  onPaste={text => {
                    const lines = splitPastedText(text).slice(
                      0,
                      MAX_ITEMS_PER_SECTION,
                    )
                    if (lines.length === 0) return
                    const added = lines.map(line =>
                      newDraftItem(line.slice(0, MAX_ITEM_LENGTH)),
                    )
                    // An empty row is filled in rather than left behind.
                    const rest =
                      item.text.trim() === ''
                        ? [
                            ...items.slice(0, index),
                            ...added,
                            ...items.slice(index + 1),
                          ]
                        : [
                            ...items.slice(0, index + 1),
                            ...added,
                            ...items.slice(index + 1),
                          ]
                    pendingFocus.current = added[added.length - 1].key
                    update(section.type, rest.slice(0, MAX_ITEMS_PER_SECTION))
                  }}
                  onMove={delta =>
                    update(section.type, moveItem(items, index, delta))
                  }
                  onRemove={() => {
                    const remaining = items.filter(
                      candidate => candidate.key !== item.key,
                    )
                    // A section always keeps one row to type into.
                    update(
                      section.type,
                      remaining.length > 0 ? remaining : [newDraftItem()],
                    )
                  }}
                  onSubmit={() => void submit()}
                />
              ))}
            </ul>
            <button
              type="button"
              disabled={items.length >= MAX_ITEMS_PER_SECTION}
              onClick={() => {
                const next = newDraftItem()
                pendingFocus.current = next.key
                update(section.type, [...items, next])
              }}
              className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-muted transition hover:bg-slate-100 hover:text-ink disabled:opacity-40"
            >
              <Plus size={12} /> Add item
            </button>
          </fieldset>
        )
      })}

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-muted">
          {editing
            ? 'Saving replaces your submitted update.'
            : 'Nothing is shared until you submit.'}
        </span>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={
            submitting ||
            (!editing && draftItemCount(draft) === 0) ||
            Boolean(editing && (unchanged || problem))
          }
        >
          {submitting ? 'Saving…' : editing ? 'Save changes' : 'Submit update'}
        </Button>
      </div>
    </form>
  )
}
