'use client'

import { ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ChevronDown,
  ClipboardList,
  Clock,
  LayoutDashboard,
  LayoutGrid,
  Lightbulb,
  Lock,
  Settings2,
  UserPlus,
  Users,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/Skeleton'
import { Avatar } from '@/components/ui/Avatar'
import { AccountMenu } from '@/components/layout/AccountMenu'
import { PresenceDot } from '@/components/workspaces/PresenceDot'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { TourAnchor, tourAnchor, tourInset } from '@/lib/tourAnchors'
import type { CachedWorkspaceIdentity } from '@/lib/redux/workspaceCacheSlice'
import type { AuthUser } from '@/hooks/useAuth'
import { Workspace, WorkspaceMember, WorkspaceRole } from '@/types/workspace'

export type WorkspaceSection =
  'overview' | 'daily-updates' | 'ideas' | 'members' | 'settings'

const NAV_ITEMS: {
  id: WorkspaceSection
  label: string
  icon: typeof LayoutDashboard
  // A personal workspace has no members to list, so it has no Members page.
  sharedOnly?: boolean
  // What an onboarding tour points at for this entry. It is rendered twice —
  // a sidebar icon from `sm:` up and a tab below it — and only one is ever
  // displayed (see lib/tourAnchors).
  tour?: TourAnchor
}[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  // What each member reports before standup. A personal workspace has nobody to
  // report to, so it has no such page.
  {
    id: 'daily-updates',
    label: 'Daily Updates',
    icon: ClipboardList,
    sharedOnly: true,
  },
  {
    id: 'ideas',
    label: 'Ideas',
    icon: Lightbulb,
  },
  {
    id: 'members',
    label: 'Members',
    icon: Users,
    sharedOnly: true,
    tour: 'workspace-members',
  },
  // Every member gets Settings: their own preferences are always there, and
  // the workspace's details are editable only by its owner (the page itself
  // gates that).
  { id: 'settings', label: 'Settings', icon: Settings2, tour: 'settings' },
]

const HEADER_PREVIEW_COUNT = 5
const COMPACT_PREVIEW_COUNT = 3

// The sidebar itself only exists from `sm:` up (mobile gets a horizontal tab
// bar instead), so below that breakpoint the rail column doesn't exist.
const RAIL_WIDTH = 'w-14 sm:w-[68px]'

// The "WORKSPACES" link back to the hub. A grid icon + an uppercase label (not
// a bare "Back") so it reads as "take me to my workspace hub".
const BACK_LINK_CLASS =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white/60 px-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted transition hover:border-[var(--ws-accent,#375b4b)] hover:text-[var(--ws-accent,#375b4b)] sm:px-3'

function MemberAvatar({
  member,
  online,
  className = 'h-7 w-7 text-[9px]',
}: {
  member: WorkspaceMember
  online: boolean
  className?: string
}) {
  return (
    <div
      title={member.fullName || member.email || 'Member'}
      className={`relative shrink-0 ${className}`}
    >
      <Avatar person={member} className="h-full w-full border-2 border-paper" />
      <PresenceDot online={online} />
    </div>
  )
}

// Avatar + first-name pill used in the header's centered member row — wide
// screens only, where there's room to actually name people instead of just
// showing faces.
function MemberChip({
  member,
  online,
}: {
  member: WorkspaceMember
  online: boolean
}) {
  const firstName = (member.fullName || member.email || 'Member').split(' ')[0]
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5">
      <MemberAvatar
        member={member}
        online={online}
        className="h-6 w-6 text-[9px]"
      />
      <span
        title={member.fullName || member.email || 'Member'}
        className="max-w-[88px] truncate text-[11px] font-semibold text-ink"
      >
        {firstName}
      </span>
    </div>
  )
}

// Full-bleed app-style shell for a single workspace: a workspace-context top
// bar (WORKSPACES link back to the hub, greeting, workspace detail line,
// member preview, quick invite, account menu) plus a collapsible icon rail
// for Overview/Daily Updates/Members/Settings — this is meant to feel like a dedicated
// workspace, not another page of the app. It's used for both shared
// workspaces and the user's Personal Workspace; `isPersonal` swaps the
// collaboration-only parts (members, invite, avatars) for a "Private • Only
// you" header. The shell itself is never centered in a max-width wrapper, so
// it stays aligned at any viewport width or browser zoom. The workspace accent
// isn't chosen here: it is set above the shell by WorkspaceThemeScope, so the
// dialogs the layout opens beside the shell inherit it too.
export function WorkspaceShell({
  workspaceId,
  workspace,
  paintIdentity,
  members,
  role,
  ready,
  user,
  onlineUserIds,
  section,
  onSectionChange,
  isPersonal = false,
  onInvite,
  onLogout,
  children,
}: {
  workspaceId: string
  workspace: Workspace | null
  // The workspace's identity as known before its row has loaded (read by the
  // server for this request, else remembered from an earlier visit) — lets the
  // header paint the real name/timezone immediately instead of a skeleton,
  // while `ready` (and everything gated on it, like members) still waits for
  // the actual network fetch. Chosen by the layout, which also takes its accent
  // from the same entry, so the two never disagree.
  paintIdentity?: CachedWorkspaceIdentity
  members: WorkspaceMember[]
  role: WorkspaceRole | null
  ready: boolean
  user: AuthUser
  onlineUserIds: Set<string>
  section: WorkspaceSection
  onSectionChange: (section: WorkspaceSection) => void
  isPersonal?: boolean
  onInvite?: () => void
  onLogout: () => void
  children: ReactNode
}) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 30000)
    return () => window.clearInterval(id)
  }, [])

  const isOwner = role === 'owner'
  const displayName = workspace?.name ?? paintIdentity?.name
  const displayTimezone = workspace?.timezone ?? paintIdentity?.timezone
  const showHeaderSkeleton = !isPersonal && !ready && !paintIdentity
  const items = NAV_ITEMS.filter(item => !item.sharedOnly || !isPersonal)
  const showMembers = !isPersonal && ready && members.length > 0
  const headerPreview = members.slice(0, HEADER_PREVIEW_COUNT)
  const headerOverflow = members.length - headerPreview.length
  const compactPreview = members.slice(0, COMPACT_PREVIEW_COUNT)
  const compactOverflow = members.length - compactPreview.length
  const workspaceTime =
    displayTimezone && now
      ? new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
          timeZone: displayTimezone,
        }).format(now)
      : null

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_80%_0%,#e4f0e6_0,transparent_30%),linear-gradient(135deg,#f8faf7_0%,#eff3ee_100%)] text-ink">
      <header
        {...tourInset('top')}
        className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur"
      >
        <div className="px-3 pt-2 sm:hidden">
          <Link href="/workspaces" className={BACK_LINK_CLASS}>
            <ArrowLeft size={13} />
            <LayoutGrid size={14} />
            Workspaces
          </Link>
        </div>
        <div className="relative flex h-20 items-stretch">
          <div className="hidden shrink-0 items-center pl-4 pr-3 sm:flex">
            <Link href="/workspaces" className={BACK_LINK_CLASS}>
              <ArrowLeft size={13} />
              <LayoutGrid size={14} />
              Workspaces
            </Link>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-3 pl-4 pr-4 sm:pl-0 sm:pr-6">
            <div className="min-w-0 max-w-[62%] shrink-0 sm:max-w-[44%]">
              {showHeaderSkeleton ? (
                <>
                  <Skeleton className="h-2.5 w-32" />
                  <Skeleton className="mt-2 h-7 w-48" />
                </>
              ) : (
                <>
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-coral">
                    {isPersonal ? (
                      <>
                        <Lock size={11} className="shrink-0" /> Private &bull;
                        Only you
                      </>
                    ) : (
                      <>Let&apos;s start working in</>
                    )}
                  </p>
                  <h1 className="truncate text-xl font-extrabold capitalize tracking-tight text-ink sm:text-3xl">
                    {isPersonal ? 'Personal Workspace' : displayName}
                  </h1>
                </>
              )}
            </div>

            {showMembers && (
              <button
                {...tourAnchor('workspace-members')}
                onClick={() => onSectionChange('members')}
                aria-label="View all members"
                className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-1 rounded-full border border-line bg-white/60 px-2 py-1.5 shadow-sm transition hover:border-[var(--ws-accent,#375b4b)] hover:bg-white/90 lg:flex"
              >
                {headerPreview.map(member => (
                  <MemberChip
                    key={member.id}
                    member={member}
                    online={onlineUserIds.has(member.userId)}
                  />
                ))}
                {headerOverflow > 0 && (
                  <span className="ml-1 shrink-0 rounded-full bg-[var(--ws-accent,#375b4b)] px-2.5 py-1.5 text-[11px] font-bold text-white">
                    +{headerOverflow} more
                  </span>
                )}
              </button>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-2.5">
              {showMembers && (
                <button
                  {...tourAnchor('workspace-members')}
                  onClick={() => onSectionChange('members')}
                  aria-label="View all members"
                  className="hidden items-center rounded-full transition hover:opacity-80 sm:flex lg:hidden"
                >
                  <div className="flex -space-x-2">
                    {compactPreview.map(member => (
                      <MemberAvatar
                        key={member.id}
                        member={member}
                        online={onlineUserIds.has(member.userId)}
                      />
                    ))}
                  </div>
                  {compactOverflow > 0 && (
                    <span
                      title={`${compactOverflow} more ${compactOverflow === 1 ? 'member' : 'members'}`}
                      className="-ml-2 grid h-7 w-7 place-items-center rounded-full border-2 border-paper bg-slate-200 font-mono text-[10px] font-bold text-muted"
                    >
                      &hellip;
                    </span>
                  )}
                </button>
              )}
              {workspaceTime && (
                <div
                  title={displayTimezone}
                  className="hidden items-center gap-1.5 rounded-full border border-line bg-white/60 px-3 py-1.5 text-[11px] font-semibold text-muted md:flex"
                >
                  <Clock
                    size={13}
                    className="shrink-0 text-[var(--ws-accent,#375b4b)]"
                  />
                  <span className="tabular-nums">{workspaceTime}</span>
                </div>
              )}
              {isOwner && !isPersonal && onInvite && (
                <button
                  onClick={onInvite}
                  className="hidden items-center gap-1.5 rounded-full border border-line bg-white/60 px-3 py-1.5 text-[11px] font-semibold text-[var(--ws-accent,#375b4b)] transition hover:border-[var(--ws-accent,#375b4b)] sm:flex"
                >
                  <UserPlus size={13} /> Invite
                </button>
              )}
              <NotificationBell
                user={user}
                workspaceId={workspaceId}
                isPersonal={isPersonal}
                className="border-line bg-white/60 text-[var(--ws-accent,#375b4b)] hover:border-[var(--ws-accent,#375b4b)]"
              />
              <AccountMenu
                user={user}
                onLogout={onLogout}
                renderTrigger={({ open, toggle }) => (
                  <button
                    aria-label="Account menu"
                    onClick={toggle}
                    className="flex items-center gap-1.5 rounded-full border border-line bg-white/70 py-1 pl-1 pr-2 transition hover:border-[var(--ws-accent,#375b4b)]"
                  >
                    <Avatar person={user} className="h-7 w-7 text-[10px]" />
                    <span className="hidden max-w-[100px] truncate text-xs font-semibold text-ink md:inline">
                      {(user.fullName || user.email || 'Account').split(' ')[0]}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
                extraItems={close => (
                  <Link
                    href="/workspaces"
                    onClick={close}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-ink transition hover:bg-slate-100"
                  >
                    <LayoutGrid size={14} /> All workspaces
                  </Link>
                )}
              />
            </div>
          </div>
        </div>
        {items.length > 1 && (
          <nav className="flex gap-1 overflow-x-auto border-t border-line/70 px-3 py-2 sm:hidden">
            {items.map(item => {
              const Icon = item.icon
              const active = section === item.id
              return (
                <button
                  key={item.id}
                  {...(item.tour && tourAnchor(item.tour))}
                  onClick={() => onSectionChange(item.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                    active
                      ? 'bg-[var(--ws-accent,#375b4b)] text-white'
                      : 'text-muted hover:bg-slate-100'
                  }`}
                >
                  <Icon size={13} /> {item.label}
                </button>
              )
            })}
          </nav>
        )}
      </header>

      <div className="flex">
        <aside
          className={`sticky top-20 hidden h-[calc(100vh-5rem)] shrink-0 flex-col gap-1 border-r border-line/70 px-2 py-4 sm:flex ${RAIL_WIDTH}`}
        >
          <nav className="flex flex-1 flex-col gap-1">
            {items.map(item => {
              const Icon = item.icon
              const active = section === item.id
              return (
                <button
                  key={item.id}
                  {...(item.tour && tourAnchor(item.tour))}
                  onClick={() => onSectionChange(item.id)}
                  title={item.label}
                  className={`flex items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition ${
                    active
                      ? 'bg-[var(--ws-accent,#375b4b)] text-white shadow-sm'
                      : 'text-muted hover:bg-slate-100 hover:text-ink'
                  }`}
                >
                  <Icon size={16} className="shrink-0" />
                </button>
              )
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
          <div className="mx-auto w-full max-w-[1600px]">
            <div key={section} className="animate-[fadeIn_200ms_ease-out]">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
