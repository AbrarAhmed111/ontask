'use client'

import {
  ChangeEvent,
  ClipboardEvent,
  KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import {
  MemberMentionPicker,
  mentionOptionId,
} from '@/components/mentions/MemberMentionPicker'
import {
  MentionRange,
  applyTextEdit,
  filterMembers,
  findMentionQuery,
  insertMention,
  mentionLabel,
  removeMention,
} from '@/lib/mentions'
import type { WorkspaceMember } from '@/types/workspace'

function renderMentionText(text: string, mentions: readonly MentionRange[]) {
  const anchored = mentions
    .filter(
      mention =>
        mention.start >= 0 &&
        mention.end > mention.start &&
        mention.end <= text.length &&
        text.slice(mention.start, mention.end) === `@${mention.label}`,
    )
    .sort((a, b) => a.start - b.start)

  const parts: React.ReactNode[] = []
  let cursor = 0
  anchored.forEach((mention, index) => {
    if (mention.start < cursor) return
    if (mention.start > cursor) parts.push(text.slice(cursor, mention.start))
    parts.push(
      <mark
        key={`${mention.userId}-${mention.start}-${index}`}
        className="rounded bg-sage/20 font-bold text-[var(--ws-accent,#375b4b)]"
      >
        {text.slice(mention.start, mention.end)}
      </mark>,
    )
    cursor = mention.end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

export type MentionValue = { text: string; mentions: MentionRange[] }

// A textarea where typing "@" offers the workspace's members. Choosing one puts
// "@Name" in the text and records that member — by userId — as a mention at
// those characters; the mentions are kept in step as the text is edited (see
// lib/mentions.ts), and are also listed as removable chips underneath, so who
// is being mentioned is always visible and never only implied by the wording.
//
// It knows nothing about blockers: it is a controlled field over
// { text, mentions }, given the members to choose from. `exclude` keeps people
// out of the list (the person typing, for one).
export function MentionTextarea({
  id,
  value,
  onChange,
  members,
  exclude,
  placeholder,
  maxLength,
  rows = 3,
  autoFocus,
  ariaLabel,
  onSubmitShortcut,
  onKeyDown,
  onPaste,
}: {
  id?: string
  value: MentionValue
  onChange: (next: MentionValue) => void
  members: readonly WorkspaceMember[]
  exclude?: readonly string[]
  placeholder?: string
  maxLength?: number
  rows?: number
  autoFocus?: boolean
  ariaLabel?: string
  // Ctrl/Cmd + Enter — submit without leaving the keyboard.
  onSubmitShortcut?: () => void
  // Every other key, while the member list is NOT open (with it open, the arrow
  // keys, Enter, Tab and Escape belong to the list). For a caller that wants
  // its own keys -- Enter to start the next item, say.
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void
}) {
  const listId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  // The "@" offset of a list the user dismissed with Escape, so it stays shut
  // for that mention instead of reopening on the next keystroke.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  // Where the caret should land once React has written the new value.
  const pendingCaret = useRef<number | null>(null)

  const query =
    caret === null ? null : findMentionQuery(value.text, caret, value.mentions)
  const suggestions = query
    ? filterMembers(members, query.query, { exclude })
    : []
  const open =
    query !== null && suggestions.length > 0 && dismissedAt !== query.start
  const active = Math.min(activeIndex, Math.max(suggestions.length - 1, 0))

  useLayoutEffect(() => {
    const target = pendingCaret.current
    if (target === null) return
    pendingCaret.current = null
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(target, target)
  })

  const syncCaret = () => setCaret(textareaRef.current?.selectionStart ?? null)

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value
    onChange({
      text,
      mentions: applyTextEdit(value.text, text, value.mentions),
    })
    setCaret(event.target.selectionStart)
    setDismissedAt(null)
    setActiveIndex(0)
  }

  const choose = (member: WorkspaceMember) => {
    if (!query) return
    const inserted = insertMention(
      value.text,
      value.mentions,
      query,
      member,
      maxLength,
    )
    if (!inserted) return
    onChange({ text: inserted.text, mentions: inserted.mentions })
    pendingCaret.current = inserted.caret
    setCaret(inserted.caret)
    setActiveIndex(0)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey) &&
      onSubmitShortcut
    ) {
      event.preventDefault()
      onSubmitShortcut()
      return
    }
    if (!open) {
      onKeyDown?.(event)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((active + step + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      choose(suggestions[active])
    } else if (event.key === 'Escape') {
      // Closes the list only — not the dialog the field is in.
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      setDismissedAt(query?.start ?? null)
    }
  }

  const removeUser = (userId: string) => {
    let state: MentionValue = value
    for (;;) {
      const index = state.mentions.findIndex(m => m.userId === userId)
      if (index === -1) break
      const next = removeMention(state.text, state.mentions, index)
      state = { text: next.text, mentions: next.mentions }
    }
    onChange(state)
    textareaRef.current?.focus()
  }

  // One chip per person, however many times they were tagged.
  const chips = Array.from(
    new Map(value.mentions.map(mention => [mention.userId, mention])).values(),
  )

  return (
    <div>
      <div className="relative">
        {value.text && (
          <div
            aria-hidden
            style={{ transform: `translateY(-${scrollTop}px)` }}
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-lg px-3 py-2.5 text-sm leading-6 text-ink"
          >
            {renderMentionText(value.text, value.mentions)}
          </div>
        )}
        <textarea
          ref={textareaRef}
          id={id}
          value={value.text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onSelect={syncCaret}
          onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
          onBlur={() => setCaret(null)}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={rows}
          autoFocus={autoFocus}
          aria-label={ariaLabel}
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open ? mentionOptionId(listId, active) : undefined
          }
          className="relative z-10 w-full resize-none rounded-lg border border-line bg-transparent px-3 py-2.5 text-sm leading-6 text-transparent caret-ink outline-none transition selection:bg-sage/20 selection:text-transparent placeholder:text-muted/60 focus:border-sage focus:ring-4 focus:ring-sage/15"
        />
        {open && (
          <MemberMentionPicker
            id={listId}
            members={suggestions}
            activeIndex={active}
            onSelect={choose}
            onHover={setActiveIndex}
          />
        )}
        <span role="status" aria-live="polite" className="sr-only">
          {open
            ? `${suggestions.length} ${suggestions.length === 1 ? 'member' : 'members'} available. Use the up and down arrow keys, then Enter to choose.`
            : ''}
        </span>
      </div>

      {chips.length > 0 && (
        <ul
          aria-label="Mentioned members"
          className="mt-2 flex flex-wrap gap-1.5"
        >
          {chips.map(mention => {
            const member = members.find(m => m.userId === mention.userId)
            const label = member ? mentionLabel(member) : mention.label
            return (
              <li
                key={mention.userId}
                className="flex items-center gap-1.5 rounded-full border border-line bg-white/70 py-0.5 pl-0.5 pr-1.5"
              >
                <Avatar
                  person={member ?? { fullName: mention.label }}
                  className="h-[18px] w-[18px] text-[8px]"
                />
                <span className="max-w-[140px] truncate text-[11px] font-semibold text-ink">
                  {label}
                </span>
                <button
                  type="button"
                  aria-label={`Remove mention of ${label}`}
                  onClick={() => removeUser(mention.userId)}
                  className="rounded-full p-0.5 text-muted transition hover:bg-slate-100 hover:text-ink"
                >
                  <X size={11} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
