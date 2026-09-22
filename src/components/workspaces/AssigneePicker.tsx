'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, UserRound, X } from 'lucide-react'
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

function AssigneeStack({ members }: { members: WorkspaceMember[] }) {
  const shown = members.slice(0, 3)
  const overflow = members.length - shown.length

  if (members.length === 0) return <AssigneeAvatar />
  if (members.length === 1) return <AssigneeAvatar member={members[0]} />

  return (
    <span className="flex shrink-0 items-center pl-0.5">
      <span className="flex -space-x-1.5">
        {shown.map(member => (
          <Avatar
            key={member.userId}
            person={member}
            title={member.fullName || member.email || 'Member'}
            className="h-[22px] w-[22px] border-2 border-white text-[8px]"
          />
        ))}
      </span>
      {overflow > 0 && (
        <span className="-ml-1.5 grid h-[22px] w-[22px] place-items-center rounded-full border-2 border-white bg-slate-200 font-mono text-[8px] font-bold text-muted">
          +{overflow}
        </span>
      )}
    </span>
  )
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
  const propSelectedAssignees = assignees ?? (assignee ? [assignee] : [])
  const propSelectedIds = propSelectedAssignees.map(member => member.userId)
  const propSelectedKey = propSelectedIds.join('|')
  const [draftSelectedIds, setDraftSelectedIds] =
    useState<string[]>(propSelectedIds)
  const selectedIds = multiSelect && open ? draftSelectedIds : propSelectedIds
  const selectedAssignees = selectedIds
    .map(userId => members.find(member => member.userId === userId))
    .filter((member): member is WorkspaceMember => Boolean(member))

  useEffect(() => {
    if (!open)
      setDraftSelectedIds(propSelectedKey ? propSelectedKey.split('|') : [])
  }, [open, propSelectedKey])

  const label =
    selectedAssignees.length > 1
      ? `${selectedAssignees.length} assigned`
      : selectedAssignees.length === 1
        ? (
            selectedAssignees[0].fullName ||
            selectedAssignees[0].email ||
            'Member'
          ).split(' ')[0]
        : 'Unassigned'

  const toggleAssignee = (userId: string) => {
    if (!onReassignMany) return
    const nextIds = draftSelectedIds.includes(userId)
      ? draftSelectedIds.filter(id => id !== userId)
      : [...draftSelectedIds, userId]
    if (!canUnassign && nextIds.length === 0) return
    setDraftSelectedIds(nextIds)
    onReassignMany(nextIds)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() =>
          setOpen(current => {
            if (!current) setDraftSelectedIds(propSelectedIds)
            return !current
          })
        }
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
        <AssigneeStack members={selectedAssignees} />
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
                if (onReassignMany) {
                  setDraftSelectedIds([])
                  onReassignMany([])
                } else onReassign(null)
                if (!multiSelect) setOpen(false)
              }}
              type="button"
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition hover:bg-slate-100 ${selectedIds.length === 0 ? 'text-[var(--ws-accent,#375b4b)]' : 'text-ink'}`}
            >
              <AssigneeAvatar />
              Unassigned
            </button>
          )}
          {multiSelect && selectedAssignees.length > 0 && (
            <div className="mb-1 flex items-center gap-1.5 border-b border-line/70 px-1 pb-2">
              <AssigneeStack members={selectedAssignees} />
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">
                {selectedAssignees.length === 1
                  ? selectedAssignees[0].fullName ||
                    selectedAssignees[0].email ||
                    'Member'
                  : `${selectedAssignees.length} collaborators`}
              </span>
              {canUnassign && (
                <button
                  type="button"
                  aria-label="Clear assignees"
                  onClick={() => {
                    setDraftSelectedIds([])
                    onReassignMany?.([])
                  }}
                  className="grid h-6 w-6 place-items-center rounded-md text-muted transition hover:bg-slate-100 hover:text-coral"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}
          {members.map(member => {
            const selected = selectedIds.includes(member.userId)
            return (
              <button
                type="button"
                key={member.userId}
                onClick={() => {
                  if (onReassignMany) toggleAssignee(member.userId)
                  else {
                    onReassign(member.userId)
                    setOpen(false)
                  }
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition hover:bg-slate-100 ${selected ? 'bg-[var(--ws-accent-soft,#e9f0ec)] text-[var(--ws-accent,#375b4b)]' : 'text-ink'}`}
              >
                <AssigneeAvatar member={member} />
                <span className="truncate">
                  {member.fullName || member.email || 'Member'}
                </span>
                {multiSelect && selected && (
                  <span className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--ws-accent,#375b4b)] text-white">
                    <Check size={12} />
                  </span>
                )}
              </button>
            )
          })}
          {multiSelect && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-1 w-full rounded-lg border border-line px-2.5 py-2 text-center text-xs font-bold text-ink transition hover:border-[var(--ws-accent,#375b4b)] hover:bg-slate-50"
            >
              Done
            </button>
          )}
        </DropdownPanel>
      )}
    </div>
  )
}
