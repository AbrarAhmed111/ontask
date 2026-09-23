import { describe, expect, it, vi } from 'vitest'
import {
  NoteCountStore,
  NoteRef,
  READ_BATCH_SIZE,
  ReadNotes,
} from './noteCountStore'

// A server whose reads the test answers by hand, and a store that flushes its
// queue only when the test says so.
function setup() {
  const reads: {
    taskIds: string[]
    answer: (rows: NoteRef[] | null) => Promise<void>
  }[] = []
  const read: ReadNotes = taskIds =>
    new Promise(resolve => {
      reads.push({
        taskIds,
        answer: async rows => {
          resolve(rows)
          await Promise.resolve()
          await Promise.resolve()
        },
      })
    })
  let pending: (() => void) | null = null
  const store = new NoteCountStore(read, flush => {
    pending = flush
  })
  const flush = () => {
    const run = pending
    pending = null
    run?.()
  }
  return { store, reads, flush }
}

const note = (id: string, task_id: string): NoteRef => ({ id, task_id })

describe('NoteCountStore', () => {
  it('reads every task registered in the same tick in one request', async () => {
    const { store, reads, flush } = setup()
    store.subscribe('t1', () => {})
    store.subscribe('t2', () => {})
    store.subscribe('t2', () => {}) // the same task shown twice
    flush()
    expect(reads).toHaveLength(1)
    expect(reads[0].taskIds).toEqual(['t1', 't2'])

    await reads[0].answer([
      note('n1', 't1'),
      note('n2', 't1'),
      note('n3', 't2'),
    ])
    expect(store.count('t1')).toBe(2)
    expect(store.count('t2')).toBe(1)
  })

  it('splits a long list of tasks into bounded requests', () => {
    const { store, reads, flush } = setup()
    for (let i = 0; i < READ_BATCH_SIZE + 1; i++) {
      store.subscribe(`t${i}`, () => {})
    }
    flush()
    expect(reads.map(r => r.taskIds.length)).toEqual([READ_BATCH_SIZE, 1])
  })

  it('does not read a task again for a second card or a remount', async () => {
    const { store, reads, flush } = setup()
    const stop = store.subscribe('t1', () => {})
    flush()
    await reads[0].answer([])
    stop()
    store.subscribe('t1', () => {})
    flush()
    expect(reads).toHaveLength(1)
  })

  it("applies inserts and deletes, and tells only that task's cards", async () => {
    const { store, reads, flush } = setup()
    const t1 = vi.fn()
    const t2 = vi.fn()
    store.subscribe('t1', t1)
    store.subscribe('t2', t2)
    flush()
    await reads[0].answer([note('n1', 't1')])
    t1.mockClear()
    t2.mockClear()

    store.noteInserted(note('n2', 't1'))
    expect(store.count('t1')).toBe(2)
    store.noteDeleted('n1')
    expect(store.count('t1')).toBe(1)
    expect(t1).toHaveBeenCalledTimes(2)
    expect(t2).not.toHaveBeenCalled()
  })

  it('is not skewed by an event delivered twice', async () => {
    const { store, reads, flush } = setup()
    store.subscribe('t1', () => {})
    flush()
    await reads[0].answer([note('n1', 't1')])
    store.noteInserted(note('n1', 't1')) // already read
    store.noteInserted(note('n2', 't1'))
    store.noteInserted(note('n2', 't1'))
    store.noteDeleted('n2')
    store.noteDeleted('n2')
    expect(store.count('t1')).toBe(1)
  })

  it('ignores notes on tasks no card shows', async () => {
    const { store, reads, flush } = setup()
    store.subscribe('t1', () => {})
    flush()
    await reads[0].answer([])
    store.noteInserted(note('n9', 'other-task'))
    store.noteDeleted('n-unknown')
    expect(store.count('other-task')).toBe(0)
    expect(store.count('t1')).toBe(0)
  })

  it('keeps changes that happen while the read is out', async () => {
    const { store, reads, flush } = setup()
    store.subscribe('t1', () => {})
    flush()
    // The read was answered from a moment before these two changes.
    store.noteInserted(note('n2', 't1'))
    store.noteDeleted('n1')
    await reads[0].answer([note('n1', 't1')])
    expect(store.count('t1')).toBe(1)
    store.noteDeleted('n2')
    expect(store.count('t1')).toBe(0)
  })

  it('re-reads the tasks still shown on resync, and retries a failed read', async () => {
    const { store, reads, flush } = setup()
    const stopT1 = store.subscribe('t1', () => {})
    store.subscribe('t2', () => {})
    flush()
    await reads[0].answer(null) // failed
    expect(store.count('t1')).toBe(0)

    store.resync()
    flush()
    expect(reads[1].taskIds).toEqual(['t1', 't2'])
    await reads[1].answer([note('n1', 't1'), note('n2', 't2')])
    expect(store.count('t1')).toBe(1)

    stopT1()
    store.resync()
    flush()
    expect(reads[2].taskIds).toEqual(['t2'])
    // A missed delete is corrected by the fresh read.
    await reads[2].answer([])
    expect(store.count('t2')).toBe(0)
    // t1 was forgotten (no card shows it), not left to go stale.
    store.noteInserted(note('n3', 't1'))
    expect(store.count('t1')).toBe(0)
  })

  it('does nothing once closed', async () => {
    const { store, reads, flush } = setup()
    const listener = vi.fn()
    store.subscribe('t1', listener)
    flush()
    store.close()
    await reads[0].answer([note('n1', 't1')])
    expect(listener).not.toHaveBeenCalled()
  })
})
