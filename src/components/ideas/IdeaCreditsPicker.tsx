'use client'

import { KeyboardEvent, useRef, useState } from 'react'
import { AtSign, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { MemberMentionPicker } from '@/components/mentions/MemberMentionPicker'
import { filterMembers, mentionLabel } from '@/lib/mentions'
import type { WorkspaceMember } from '@/types/workspace'

export function IdeaCreditsPicker({
  members,
  creditedUserIds,
  onChange,
}: {
  members: WorkspaceMember[]
  creditedUserIds: string[]
  onChange: (userIds: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const creditedMembers = members.filter(m =>
    creditedUserIds.includes(m.userId),
  )
  const filtered = filterMembers(members, query.replace(/^@/, ''), {
    exclude: creditedUserIds,
  })

  const removeUser = (userId: string) => {
    onChange(creditedUserIds.filter(id => id !== userId))
  }

  const selectUser = (member: WorkspaceMember) => {
    if (!creditedUserIds.includes(member.userId)) {
      onChange([...creditedUserIds, member.userId])
    }
    setQuery('')
    setIsOpen(false)
    setActiveIndex(0)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || filtered.length === 0) {
      if (e.key === 'ArrowDown' || e.key === '@') {
        setIsOpen(true)
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => (prev + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => (prev - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (filtered[activeIndex]) {
        selectUser(filtered[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-muted">
        Credits To{' '}
        <span className="font-normal text-muted/80">
          (who came up with this idea?)
        </span>
      </label>

      {/* Selected Member Chips */}
      {creditedMembers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {creditedMembers.map(member => (
            <span
              key={member.userId}
              className="inline-flex items-center gap-1.5 rounded-full border border-sage-dark/30 bg-sage/15 px-2.5 py-1 text-xs font-medium text-sage-dark"
            >
              <Avatar person={member} className="h-4 w-4" />
              <span>{mentionLabel(member)}</span>
              <button
                type="button"
                onClick={() => removeUser(member.userId)}
                className="rounded-full p-0.5 hover:bg-sage/30 hover:text-ink transition"
                title={`Remove ${mentionLabel(member)}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input Field with Dropdown */}
      <div className="relative">
        <div className="relative flex items-center">
          <AtSign className="absolute left-3 h-4 w-4 text-muted/60" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onFocus={() => setIsOpen(true)}
            onBlur={() => {
              // Delay blur so click on dropdown works
              setTimeout(() => setIsOpen(false), 200)
            }}
            onChange={e => {
              setQuery(e.target.value)
              setIsOpen(true)
              setActiveIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type @ or search member name..."
            className="w-full rounded-lg border border-line bg-white pl-9 pr-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-sage focus:ring-4 focus:ring-sage/15"
          />
        </div>

        {isOpen && filtered.length > 0 && (
          <MemberMentionPicker
            id="idea-credits-picker"
            members={filtered}
            activeIndex={activeIndex}
            onSelect={selectUser}
            onHover={setActiveIndex}
          />
        )}
      </div>
    </div>
  )
}
