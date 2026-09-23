'use client'

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import { onResync } from '@/lib/realtime/onResync'
import { NoteCountStore, NoteRef } from '@/lib/tasks/noteCountStore'

// PostgREST returns at most this many rows per request by default, so a read
// pages until a short page comes back.
const PAGE_SIZE = 1000

async function readNotes(taskIds: string[]): Promise<NoteRef[] | null> {
  const supabase = createClient()
  const rows: NoteRef[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('task_notes')
      .select('id, task_id')
      .in('task_id', taskIds)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error || !data) return null
    rows.push(...(data as NoteRef[]))
    if (data.length < PAGE_SIZE) return rows
  }
}

const TaskNoteCountsContext = createContext<NoteCountStore | null>(null)

// The note counts every task card on the page shows (see NoteCountStore): one
// read per batch of cards and one realtime channel, instead of a request and a
// channel per card. Mounted with the overview, the only page with task cards.
export function TaskNoteCountsProvider({
  workspaceId,
  userId,
  children,
}: {
  workspaceId: string
  userId: string | undefined
  children: ReactNode
}) {
  const [store, setStore] = useState<NoteCountStore | null>(null)

  useEffect(() => {
    if (!workspaceId || !userId) return
    const next = new NoteCountStore(readNotes)
    setStore(next)
    const supabase = createClient()
    // task_notes has no workspace_id to filter on (see 0024), and a delete
    // event can't be filtered anyway. Row-level security limits what arrives
    // to notes the caller can see; the store ignores tasks no card shows.
    const channel = supabase
      .channel(`task-note-counts-${workspaceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'task_notes' },
        payload => {
          const row = payload.new as Partial<NoteRef>
          if (row.id && row.task_id) {
            next.noteInserted({ id: row.id, task_id: row.task_id })
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'task_notes' },
        payload => {
          const id = (payload.old as { id?: string }).id
          if (id) next.noteDeleted(id)
        },
      )
      .subscribe()
    const stopResync = onResync(() => next.resync())
    return () => {
      next.close()
      stopResync()
      supabase.removeChannel(channel)
      setStore(current => (current === next ? null : current))
    }
  }, [workspaceId, userId])

  return (
    <TaskNoteCountsContext.Provider value={store}>
      {children}
    </TaskNoteCountsContext.Provider>
  )
}

const noSubscription = () => () => {}

// How many notes a task has. 0 outside the provider (a test, a render before
// the workspace is known).
export function useTaskNoteCount(taskId: string): number {
  const store = useContext(TaskNoteCountsContext)
  const subscribe = useCallback(
    (listener: () => void) =>
      store && taskId ? store.subscribe(taskId, listener) : () => {},
    [store, taskId],
  )
  return useSyncExternalStore(
    store ? subscribe : noSubscription,
    () => (store ? store.count(taskId) : 0),
    () => 0,
  )
}
