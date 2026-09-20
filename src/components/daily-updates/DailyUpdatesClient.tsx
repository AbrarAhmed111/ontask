'use client'

import { useEffect, useMemo, useState } from 'react'
import { DailyUpdateCard } from '@/components/daily-updates/DailyUpdateCard'
import { DailyUpdateForm } from '@/components/daily-updates/DailyUpdateForm'
import { DailyUpdatesBoard } from '@/components/daily-updates/DailyUpdatesBoard'
import { useWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import { useDailyUpdates } from '@/hooks/useDailyUpdates'
import {
  MemberDay,
  buildDay,
  draftFromUpdate,
  draftStorageKey,
  emptyDraft,
  loadDraft,
  shiftDay,
  workspaceToday,
} from '@/lib/dailyUpdates'
import { showSuccessToast } from '@/lib/toast'
import type { WorkspaceMember } from '@/types/workspace'

// Your own card while you write (or change) your update. It is its own component
// so the form starts from the right place exactly once: your submitted update
// when changing it, else the draft kept in this browser, else a blank form.
function OwnUpdate({
  entry,
  workspaceId,
  workspaceSlug,
  members,
  userId,
  day,
  editable,
  onSubmit,
}: {
  entry: MemberDay
  workspaceId: string
  workspaceSlug: string
  members: readonly WorkspaceMember[]
  userId: string
  day: string
  // Only today and yesterday's update can be written or changed; earlier days are history.
  editable: boolean
  onSubmit: (
    items: Parameters<ReturnType<typeof useDailyUpdates>['submit']>[0],
  ) => Promise<{ success: boolean; error?: string }>
}) {
  const [editing, setEditing] = useState(false)
  const update = entry.update
  const draftKey = draftStorageKey(userId, workspaceId, day)

  const writing = editable && (update === null || editing)
  const [initial] = useState(() =>
    update
      ? draftFromUpdate(update, members)
      : (loadDraft(draftKey, members) ?? emptyDraft()),
  )
  const [submitted] = useState(() =>
    update ? draftFromUpdate(update, members) : null,
  )

  if (!writing) {
    return (
      <DailyUpdateCard
        entry={entry}
        members={members}
        workspaceSlug={workspaceSlug}
        isCurrentUser
        onEdit={editable ? () => setEditing(true) : undefined}
      />
    )
  }
  return (
    <DailyUpdateCard
      entry={entry}
      members={members}
      workspaceSlug={workspaceSlug}
      isCurrentUser
    >
      <DailyUpdateForm
        workspaceId={workspaceId}
        currentUserId={userId}
        members={members}
        initial={initial}
        submitted={submitted}
        draftKey={draftKey}
        onSubmit={async items => {
          const result = await onSubmit(items)
          if (result.success) {
            showSuccessToast(
              update ? 'Daily Update saved.' : 'Daily Update submitted.',
            )
            setEditing(false)
          }
          return result
        }}
        onCancel={update ? () => setEditing(false) : undefined}
      />
    </DailyUpdateCard>
  )
}

// The Daily Updates page of a shared workspace: who has reported for a day, what
// each person said is done, blocked and next, and your own update to write. A
// day is a workspace-local calendar day -- the one the server files an update
// under -- and only today can be written; the days before it are kept as they
// were submitted.
export function DailyUpdatesClient() {
  const { workspaceId, workspace, user, members, isPersonal, ready } =
    useWorkspaceDetail()
  const userZone =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC'
  const timezone =
    workspace?.timezone && workspace.timezone !== 'UTC'
      ? workspace.timezone
      : userZone

  // Today on the workspace's clock, re-read every minute so a page left open
  // across midnight moves on to the new day.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const today = workspaceToday(timezone, now)
  const yesterday = shiftDay(today, -1)

  // null = follow today; a day = the one navigated to.
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const day = selectedDay ?? today
  const isToday = day === today
  const isYesterday = day === yesterday
  // Today and yesterday's update can be written or changed; earlier days are history.
  const editable = isToday || isYesterday

  const {
    updates,
    ready: updatesReady,
    error,
    submit,
  } = useDailyUpdates(workspaceId, user, day, !isPersonal && ready)
  const entries = useMemo(
    () => buildDay(members, updates, user.id),
    [members, updates, user.id],
  )

  // Daily Updates are a shared-workspace feature; a personal workspace has no
  // page for it (the layout also sends it away from this URL).
  if (isPersonal) return null

  const slug = workspace?.slug ?? ''
  return (
    <DailyUpdatesBoard
      ready={ready && updatesReady}
      error={error}
      day={day}
      isToday={isToday}
      isYesterday={isYesterday}
      entries={entries}
      members={members}
      workspaceSlug={slug}
      currentUserId={user.id}
      // Keyed by day so writing on one day never carries into another.
      renderOwnCard={entry => (
        <OwnUpdate
          key={`${day}:${entry.update?.id ?? 'new'}:${entry.update?.editedAt ?? ''}`}
          entry={entry}
          workspaceId={workspaceId}
          workspaceSlug={slug}
          members={members}
          userId={user.id}
          day={day}
          editable={editable}
          onSubmit={submit}
        />
      )}
      onPrevious={() => setSelectedDay(shiftDay(day, -1))}
      onNext={() => {
        const next = shiftDay(day, 1)
        setSelectedDay(next >= today ? null : next)
      }}
      onToday={() => setSelectedDay(null)}
    />
  )
}
