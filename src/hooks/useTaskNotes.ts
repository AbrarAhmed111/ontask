import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspaceSnapshot } from '@/hooks/useWorkspaceSnapshot'
import { useFetchStatus } from '@/hooks/useFetchStatus'
import { SNAPSHOTS } from '@/lib/cache/workspaceSnapshots'
import type { AuthUser } from '@/hooks/useAuth'
import { TaskNote } from '@/types/workspace'
import { onResync } from '@/lib/realtime/onResync'

type TaskNoteRow = {
  id: string
  task_id: string
  author_id: string
  content: string
  created_at: string
  updated_at: string
}

function rowToNote(row: TaskNoteRow): TaskNote {
  return {
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const NO_NOTES: TaskNote[] = []

// Shared notes for a single task -- realtime via Supabase, same
// postgres_changes pattern as every other hook here. Optimistic inserts use
// a client-generated id that matches what's persisted, so the realtime
// INSERT event reconciles into the same row instead of appending a
// duplicate (rule 26) and the entrance animation (keyed by that stable id)
// never replays.
//
// Cached on this device per user, workspace AND task (which is why the workspace
// is passed in), and shown while the real list is fetched.
export function useTaskNotes(
  taskId: string,
  user: AuthUser | null,
  workspaceId: string,
) {
  const userId = user?.id
  const snapshot = useWorkspaceSnapshot<TaskNote[]>({
    userId,
    workspaceId,
    scope: taskId,
    descriptor: SNAPSHOTS.notes,
    initial: NO_NOTES,
  })
  const { data: notes, setData: setNotes, confirm } = snapshot
  const [actionError, setError] = useState<string | null>(null)
  const fetchKey =
    userId && workspaceId && taskId
      ? `${userId}|${workspaceId}|${taskId}`
      : null
  const status = useFetchStatus(snapshot, fetchKey, {
    load: "Couldn't load notes.",
    refresh: "Couldn't refresh notes — you may be seeing older ones.",
  })
  const { failed: markFailed, succeeded: markSucceeded } = status
  const { ready } = status
  const error = status.error ?? actionError

  useEffect(() => {
    if (!userId || !taskId || !workspaceId || !fetchKey) return
    let cancelled = false
    const supabase = createClient()

    const fetchNotes = () => {
      supabase
        .from('task_notes')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true })
        .then(({ data, error: fetchError }) => {
          if (cancelled) return
          if (fetchError) {
            markFailed()
            return
          }
          confirm(((data ?? []) as TaskNoteRow[]).map(rowToNote))
          markSucceeded()
        })
    }

    fetchNotes()

    const stopResync = onResync(() => fetchNotes())

    const channel = supabase
      .channel(`task-notes-${taskId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_notes',
          filter: `task_id=eq.${taskId}`,
        },
        payload => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string }).id
            if (deletedId)
              setNotes(current => current.filter(n => n.id !== deletedId))
            return
          }
          const incoming = rowToNote(payload.new as TaskNoteRow)
          setNotes(current => {
            const exists = current.some(n => n.id === incoming.id)
            return exists
              ? current.map(n => (n.id === incoming.id ? incoming : n))
              : [...current, incoming].sort((a, b) =>
                  a.createdAt.localeCompare(b.createdAt),
                )
          })
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      stopResync()
      supabase.removeChannel(channel)
    }
  }, [
    userId,
    taskId,
    workspaceId,
    fetchKey,
    confirm,
    setNotes,
    markFailed,
    markSucceeded,
  ])

  const addNote = (content: string) => {
    const trimmed = content.trim()
    if (!userId || !trimmed) return false
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    setNotes(current => [
      ...current,
      {
        id,
        taskId,
        authorId: userId,
        content: trimmed,
        createdAt: now,
        updatedAt: now,
      },
    ])
    const supabase = createClient()
    void supabase
      .from('task_notes')
      .insert({ id, task_id: taskId, author_id: userId, content: trimmed })
      .then(({ error: insertError }) => {
        if (insertError) {
          setError("Couldn't add the note.")
          setNotes(current => current.filter(note => note.id !== id))
        }
      })
    return true
  }

  const updateNote = (id: string, content: string) => {
    const trimmed = content.trim()
    if (!userId || !trimmed) return false
    setNotes(current =>
      current.map(note =>
        note.id === id
          ? { ...note, content: trimmed, updatedAt: new Date().toISOString() }
          : note,
      ),
    )
    const supabase = createClient()
    void supabase
      .from('task_notes')
      .update({ content: trimmed })
      .eq('id', id)
      .then(({ error: updateError }) => {
        if (updateError) setError("Couldn't save the note.")
      })
    return true
  }

  const deleteNote = (id: string) => {
    if (!userId) return
    const removed = notes.find(note => note.id === id)
    setNotes(current => current.filter(note => note.id !== id))
    const supabase = createClient()
    void supabase
      .from('task_notes')
      .delete()
      .eq('id', id)
      .then(({ error: deleteError }) => {
        if (deleteError) {
          setError("Couldn't remove the note.")
          if (removed) setNotes(current => [...current, removed])
        }
      })
  }

  return { notes, ready, error, addNote, updateNote, deleteNote }
}
