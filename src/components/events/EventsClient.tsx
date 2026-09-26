'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarClock, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { EventForm } from '@/components/events/EventForm'
import { EventDetail } from '@/components/events/EventDetail'
import { EventListItem } from '@/components/events/EventParts'
import { useWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import { useWorkspaceEvents } from '@/hooks/useWorkspaceEvents'
import { useNow } from '@/hooks/useNow'
import {
  EventFilter,
  EventFormValues,
  canCreateWorkspaceEvents,
  canManageEvent,
  emptyEventForm,
  eventToForm,
  filterEvents,
  groupEventsByDay,
  timingChanged,
} from '@/lib/events'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { detectTimezone, timezoneOptions } from '@/lib/timezones'
import type { WorkspaceEvent } from '@/types/workspace'

const SHARED_FILTERS: { id: EventFilter; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'all', label: 'All' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'personal', label: 'Personal' },
  { id: 'past', label: 'Past' },
]
// The Personal Workspace lists personal events only.
const PERSONAL_FILTERS: { id: EventFilter; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'all', label: 'All' },
  { id: 'past', label: 'Past' },
]

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; event: WorkspaceEvent }
  | { kind: 'cancel'; event: WorkspaceEvent }
  | { kind: 'delete'; event: WorkspaceEvent }
  | null

// The Events page: a plain list, soonest first, grouped by day -- not a
// calendar. `?event=<id>` opens one (notifications and the Overview link here).
export function EventsClient() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { workspace, workspaceId, user, members, isOwner, isPersonal, ready } =
    useWorkspaceDetail()
  const eventsOff = !isPersonal && workspace?.eventsEnabled === false
  const {
    events,
    ready: eventsReady,
    error,
    createEvent,
    updateEvent,
    cancelEvent,
    deleteEvent,
  } = useWorkspaceEvents(workspaceId, user, {
    isPersonal,
    enabled: Boolean(workspace) && !eventsOff,
  })
  const now = useNow(30_000)
  const [filter, setFilter] = useState<EventFilter>('upcoming')
  const [dialog, setDialog] = useState<Dialog>(null)

  const displayTimezone = workspace?.timezone || 'UTC'
  const canCreateWorkspace = canCreateWorkspaceEvents(workspace, isOwner)
  const membersCanCreate = workspace?.eventsMembersCanCreate ?? true
  const selectedId = searchParams.get('event')
  const selected = selectedId
    ? (events.find(e => e.id === selectedId) ?? null)
    : null

  const groups = useMemo(
    () =>
      groupEventsByDay(filterEvents(events, filter, now), displayTimezone, now),
    [events, filter, now, displayTimezone],
  )

  // `?new` (the Overview's "Create Event") opens the form once.
  const wantsNew = searchParams.has('new')
  useEffect(() => {
    if (!wantsNew || !ready || !workspace) return
    setDialog({ kind: 'create' })
    const next = new URLSearchParams(searchParams.toString())
    next.delete('new')
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [wantsNew, ready, workspace, searchParams, router, pathname])

  const openEvent = (id: string | null) => {
    const next = new URLSearchParams(searchParams.toString())
    if (id) next.set('event', id)
    else next.delete('event')
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const memberName = (userId: string | null) => {
    if (!userId) return null
    if (userId === user.id) return 'You'
    const member = members.find(m => m.userId === userId)
    return member?.fullName || member?.email || null
  }

  const timezones = timezoneOptions(
    dialog?.kind === 'edit' ? dialog.event.timezone : null,
    displayTimezone,
    detectTimezone(),
  )

  const handleCreate = async (values: EventFormValues) => {
    const result = await createEvent(values)
    if (result.ok) {
      setDialog(null)
      showSuccessToast(`${values.title.trim()} created.`)
    }
    return result
  }

  const handleEdit = async (event: WorkspaceEvent, values: EventFormValues) => {
    const result = await updateEvent(event.id, values)
    if (result.ok) {
      setDialog(null)
      showSuccessToast('Event updated.')
    }
    return result
  }

  const handleCancelEvent = async (event: WorkspaceEvent) => {
    setDialog(null)
    const result = await cancelEvent(event.id)
    if (result.ok) showSuccessToast(`${event.title} cancelled.`)
    else showErrorToast(result.error)
  }

  const handleDelete = async (event: WorkspaceEvent) => {
    setDialog(null)
    openEvent(null)
    const result = await deleteEvent(event.id)
    if (result.ok) showSuccessToast(`${event.title} deleted.`)
    else showErrorToast(result.error)
  }

  if (eventsOff) {
    return (
      <div className="mx-auto max-w-4xl">
        <EmptyState icon={CalendarClock} title="Events are turned off">
          The workspace owner has turned Events off for this workspace.
        </EmptyState>
      </div>
    )
  }

  const filters = isPersonal ? PERSONAL_FILTERS : SHARED_FILTERS

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <CalendarClock className="h-6 w-6 text-[var(--ws-accent,#375b4b)]" />
            Events
          </h1>
          <p className="mt-1 text-sm text-muted">
            {isPersonal
              ? 'Your personal events from every workspace. OnTask reminds you before each one.'
              : 'What’s happening next, and who OnTask will remind.'}
          </p>
        </div>
        <Button
          onClick={() => setDialog({ kind: 'create' })}
          disabled={!ready || !workspace}
          className="shrink-0 gap-1.5"
        >
          <Plus className="h-4 w-4" />
          New Event
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Filter events"
        className="flex gap-1 overflow-x-auto border-b border-line pb-2"
      >
        {filters.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              filter === item.id
                ? 'bg-ink text-white'
                : 'text-muted hover:bg-white hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {!eventsReady && events.length === 0 ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={filter === 'past' ? 'No past events' : 'No upcoming events'}
          action={
            filter !== 'past' && (
              <Button onClick={() => setDialog({ kind: 'create' })}>
                Create Event
              </Button>
            )
          }
        >
          {filter === 'past'
            ? 'Events that have happened or were cancelled show up here.'
            : 'Add a standup, a demo or a reminder for yourself — OnTask will remind the right people.'}
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {groups.map(group => (
            <section key={group.key} aria-label={group.label}>
              <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                {group.label}
              </h2>
              <ul className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
                {group.events.map(event => (
                  <EventListItem
                    key={event.id}
                    event={event}
                    now={now}
                    members={members}
                    showWorkspace={isPersonal}
                    onOpen={() => openEvent(event.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {selected && !dialog && (
        <Modal
          eyebrow={
            selected.scope === 'personal' ? 'Personal Event' : 'Workspace Event'
          }
          title={selected.title}
          onClose={() => openEvent(null)}
        >
          <EventDetail
            event={selected}
            now={now}
            members={members}
            creatorName={
              selected.scope === 'workspace'
                ? memberName(selected.createdBy)
                : null
            }
            canManage={canManageEvent(selected, {
              userId: user.id,
              isOwner,
              membersCanCreate,
            })}
            dailyUpdatesHref={
              selected.workspaceType === 'shared'
                ? `/workspaces/${selected.workspaceSlug}/daily-updates`
                : null
            }
            onEdit={() => setDialog({ kind: 'edit', event: selected })}
            onCancelEvent={() => setDialog({ kind: 'cancel', event: selected })}
            onDelete={() => setDialog({ kind: 'delete', event: selected })}
          />
        </Modal>
      )}

      {dialog?.kind === 'create' && workspace && (
        <Modal
          eyebrow="New event"
          title="Create Event"
          onClose={() => setDialog(null)}
        >
          <EventForm
            mode="create"
            initial={emptyEventForm({
              scope: canCreateWorkspace ? 'workspace' : 'personal',
              timezone: displayTimezone,
            })}
            allowWorkspaceScope={canCreateWorkspace}
            showDailyUpdatePrompt={!isPersonal}
            members={members}
            timezones={timezones}
            onSubmit={handleCreate}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === 'edit' && (
        <Modal
          eyebrow="Edit event"
          title={dialog.event.title}
          onClose={() => setDialog(null)}
        >
          <EventForm
            mode="edit"
            initial={eventToForm(dialog.event)}
            allowWorkspaceScope={false}
            showDailyUpdatePrompt={dialog.event.workspaceType === 'shared'}
            members={members}
            timezones={timezones}
            timingLocked={values => !timingChanged(values, dialog.event)}
            onSubmit={values => handleEdit(dialog.event, values)}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}

      {dialog?.kind === 'cancel' && (
        <ConfirmModal
          title={`Cancel ${dialog.event.title}?`}
          message={
            dialog.event.recurrence === 'none'
              ? 'It stays in Past as cancelled, and nobody is reminded about it.'
              : 'This cancels every future occurrence. It stays in Past as cancelled, and nobody is reminded about it again.'
          }
          confirmLabel="Cancel event"
          onConfirm={() => void handleCancelEvent(dialog.event)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmModal
          title={`Delete ${dialog.event.title}?`}
          message="This removes the event for good. If it was still coming up, the people it was for are told it’s cancelled."
          confirmLabel="Delete event"
          onConfirm={() => void handleDelete(dialog.event)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
