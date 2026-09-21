'use client'

import { useState } from 'react'
import { Check, ChevronDown, UserRound, UsersRound } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { DropdownPanel } from '@/components/ui/DropdownPanel'
import { WorkspaceMember } from '@/types/workspace'

const AVATAR_CLASS = 'h-[22px] w-[22px] shrink-0 text-[9px]'

function AssigneeAvatar({ member }: { member?: WorkspaceMember }) {
  if (!member) {
    return (
      <span
        className={`grid place-items-center rounded-full border border-dashed border-line text-muted ${AVATAR_CLASS}`}
      >
        <UserRound size={12} />
      </span>
    )
  }
  return <Avatar person={member} className={AVATAR_CLASS} />
}

export function AssigneePicker({
  assignee,
  members,
  onReassign,
  assignees,
  onReassignMany,
  canUnassign = true,
}: {
  assignee: WorkspaceMember | undefined
  members: WorkspaceMember[]
  onReassign: (userId: string | null) => void
  assignees?: WorkspaceMember[]
  onReassignMany?: (userIds: string[]) => void
  canUnassign?: boolean
}) {
  const [open, setOpen] = useState(false)
  const multiSelect = Boolean(onReassignMany)
  const selectedAssignees = assignees ?? (assignee ? [assignee] : [])
  const selectedIds = selectedAssignees.map(member => member.userId)
  const label =
    selectedAssignees.length > 1
      ? `${selectedAssignees.length} assigned`
      : assignee
        ? (assignee.fullName || assignee.email || 'Member').split(' ')[0]
        : 'Unassigned'

  const toggleAssignee = (userId: string) => {
    if (!onReassignMany) return
    const nextIds = selectedIds.includes(userId)
      ? selectedIds.filter(id => id !== userId)
      : [...selectedIds, userId]
    if (!canUnassign && nextIds.length === 0) return
    onReassignMany(nextIds)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-label="Change assignee"
        title={
          selectedAssignees.length > 1
            ? selectedAssignees
                .map(member => member.fullName || member.email || 'Member')
                .join(', ')
            : assignee
              ? assignee.fullName || assignee.email || ''
              : 'Unassigned'
        }
        className="flex items-center gap-1.5 rounded-full border border-line bg-white/70 py-1 pl-1 pr-2 transition hover:border-[var(--ws-accent,#375b4b)]"
      >
        {selectedAssignees.length > 1 ? (
          <span
            className={`grid place-items-center rounded-full border border-line bg-[var(--ws-accent-soft,#e9f0ec)] text-[var(--ws-accent,#375b4b)] ${AVATAR_CLASS}`}
          >
            <UsersRound size={12} />
          </span>
        ) : (
          <AssigneeAvatar member={assignee} />
        )}
        <span className="max-w-[90px] truncate text-[11px] font-semibold text-ink">
          {label}
        </span>
        <ChevronDown
          size={12}
          className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <DropdownPanel
          onClose={() => setOpen(false)}
          align="left"
          className="w-56 p-1.5"
        >
          {canUnassign && (
            <button
              onClick={() => {
                if (onReassignMany) onReassignMany([])
                else onReassign(null)
                if (!multiSelect) setOpen(false)
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition hover:bg-slate-100 ${selectedIds.length === 0 ? 'text-[var(--ws-accent,#375b4b)]' : 'text-ink'}`}
            >
              <AssigneeAvatar />
              Unassigned
            </button>
          )}
          {members.map(member => {
            const selected = selectedIds.includes(member.userId)
            return (
              <button
                key={member.userId}
                onClick={() => {
                  if (onReassignMany) toggleAssignee(member.userId)
                  else {
                    onReassign(member.userId)
                    setOpen(false)
                  }
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition hover:bg-slate-100 ${selected ? 'text-[var(--ws-accent,#375b4b)]' : 'text-ink'}`}
              >
                <AssigneeAvatar member={member} />
                <span className="truncate">
                  {member.fullName || member.email || 'Member'}
                </span>
                {multiSelect && selected && (
                  <Check size={13} className="ml-auto shrink-0" />
                )}
              </button>
            )
          })}
        </DropdownPanel>
      )}
    </div>
  )
}
