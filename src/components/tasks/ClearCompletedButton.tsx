'use client'

import { useState } from 'react'
import { Eraser } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

export function ClearCompletedButton({
  count,
  onClear,
}: {
  count: number
  onClear: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  if (count === 0) return null

  return (
    <>
      <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
        <Eraser size={14} /> Clear completed
      </Button>
      {confirming && (
        <ConfirmModal
          title="Clear completed items?"
          message={`${count} completed ${count === 1 ? 'item' : 'items'} will be hidden from this view. Task history, focused time, reports and activity stay intact.`}
          confirmLabel="Clear completed"
          onConfirm={() => {
            onClear()
            setConfirming(false)
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}
