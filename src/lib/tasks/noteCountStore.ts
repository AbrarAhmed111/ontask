// How many notes each task card on the page has, read for all of them at once.
//
// Every card used to count its own notes: one HEAD request and one realtime
// channel per card, so an overview with 40 tasks opened 40 requests and 40
// channels on mount and re-read all 40 each time the tab came back. Here the
// cards only register the task they show; the ids registered in the same tick
// are read in one request, and one channel for the whole page (see
// TaskNoteCountsContext) feeds every insert and delete back in.
//
// A count is the size of the set of note ids known for the task, never a
// running +1/-1 tally, so an event delivered twice, or one that describes a
// note the read already returned, can't skew it. A delete carries only the
// note's id (the task is looked up from the notes read so far).

export type NoteRef = { id: string; task_id: string }

// All notes (id + task) for the given tasks; null when the read failed.
export type ReadNotes = (taskIds: string[]) => Promise<NoteRef[] | null>

// How many task ids go into one `in (...)` filter, so the request URL stays
// well inside what proxies accept.
export const READ_BATCH_SIZE = 100

export class NoteCountStore {
  private notesByTask = new Map<string, Set<string>>()
  private taskOfNote = new Map<string, string>()
  private refs = new Map<string, number>()
  private listeners = new Map<string, Set<() => void>>()
  private queued = new Set<string>()
  private flushScheduled = false
  // Changes seen while a read is out: the read's answer may predate them.
  private reading = new Map<string, Set<string>>() // task -> notes inserted
  private readsInFlight = 0
  private deletedWhileReading = new Set<string>()
  private closed = false

  constructor(
    private readonly read: ReadNotes,
    private readonly schedule: (flush: () => void) => void = flush =>
      void Promise.resolve().then(flush),
  ) {}

  count(taskId: string): number {
    return this.notesByTask.get(taskId)?.size ?? 0
  }

  subscribe(taskId: string, listener: () => void): () => void {
    this.refs.set(taskId, (this.refs.get(taskId) ?? 0) + 1)
    if (!this.listeners.has(taskId)) this.listeners.set(taskId, new Set())
    this.listeners.get(taskId)!.add(listener)
    if (!this.notesByTask.has(taskId) && !this.reading.has(taskId)) {
      this.enqueue(taskId)
    }
    return () => {
      this.listeners.get(taskId)?.delete(listener)
      const left = (this.refs.get(taskId) ?? 1) - 1
      if (left > 0) this.refs.set(taskId, left)
      else this.refs.delete(taskId)
    }
  }

  noteInserted(note: NoteRef) {
    this.reading.get(note.task_id)?.add(note.id)
    const notes = this.notesByTask.get(note.task_id)
    if (!notes || notes.has(note.id)) return
    notes.add(note.id)
    this.taskOfNote.set(note.id, note.task_id)
    this.notify(note.task_id)
  }

  noteDeleted(noteId: string) {
    if (this.readsInFlight > 0) this.deletedWhileReading.add(noteId)
    for (const inserted of this.reading.values()) inserted.delete(noteId)
    const taskId = this.taskOfNote.get(noteId)
    if (!taskId) return
    this.taskOfNote.delete(noteId)
    if (this.notesByTask.get(taskId)?.delete(noteId)) this.notify(taskId)
  }

  // Realtime may have missed changes (see onResync): re-read every task a card
  // still shows, and forget the rest rather than keep them without updates.
  resync() {
    for (const taskId of [...this.notesByTask.keys()]) {
      if (!this.refs.has(taskId)) this.forget(taskId)
    }
    // Including tasks whose first read failed.
    for (const taskId of this.refs.keys()) this.enqueue(taskId)
  }

  close() {
    this.closed = true
  }

  private forget(taskId: string) {
    for (const noteId of this.notesByTask.get(taskId) ?? []) {
      this.taskOfNote.delete(noteId)
    }
    this.notesByTask.delete(taskId)
  }

  private enqueue(taskId: string) {
    this.queued.add(taskId)
    if (this.flushScheduled) return
    this.flushScheduled = true
    this.schedule(() => {
      this.flushScheduled = false
      if (this.closed) return
      const ids = [...this.queued].filter(id => !this.reading.has(id))
      this.queued.clear()
      for (let i = 0; i < ids.length; i += READ_BATCH_SIZE) {
        void this.readBatch(ids.slice(i, i + READ_BATCH_SIZE))
      }
    })
  }

  private async readBatch(taskIds: string[]) {
    for (const taskId of taskIds) this.reading.set(taskId, new Set())
    this.readsInFlight++
    let rows: NoteRef[] | null = null
    try {
      rows = await this.read(taskIds)
    } catch {
      rows = null
    }
    this.readsInFlight--
    if (this.closed) return

    const inserted = new Map(taskIds.map(id => [id, this.reading.get(id)!]))
    for (const taskId of taskIds) this.reading.delete(taskId)

    if (rows) {
      const fresh = new Map(taskIds.map(id => [id, new Set<string>()]))
      for (const row of rows) fresh.get(row.task_id)?.add(row.id)
      for (const taskId of taskIds) {
        const notes = fresh.get(taskId)!
        for (const noteId of inserted.get(taskId)!) notes.add(noteId)
        for (const noteId of this.deletedWhileReading) notes.delete(noteId)
        this.forget(taskId)
        this.notesByTask.set(taskId, notes)
        for (const noteId of notes) this.taskOfNote.set(noteId, taskId)
        this.notify(taskId)
      }
    }
    // A failed read leaves those tasks as they were (unread ones show 0); the
    // next resync tries again.
    if (this.readsInFlight === 0) this.deletedWhileReading.clear()
  }

  private notify(taskId: string) {
    for (const listener of this.listeners.get(taskId) ?? []) listener()
  }
}
