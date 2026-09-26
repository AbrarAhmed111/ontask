'use client'

import { FormEvent, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { TimeOfDaySelect } from '@/components/workspaces/TimeOfDaySelect'
import { COMMON_TIMEZONES, detectTimezone } from '@/lib/timezones'

export function CreateWorkspaceModal({
  onCreate,
  onClose,
}: {
  onCreate: (
    name: string,
    description: string,
    timezone: string,
    reportTime: string,
  ) => Promise<{ success: boolean; error?: string }>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [timezone, setTimezone] = useState(detectTimezone)
  const [reportTime, setReportTime] = useState('12:00')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const detected = detectTimezone()
  const timezoneOptions = COMMON_TIMEZONES.includes(detected)
    ? COMMON_TIMEZONES
    : [detected, ...COMMON_TIMEZONES]

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    const result = await onCreate(
      name.trim(),
      description,
      timezone,
      `${reportTime}:00`,
    )
    setLoading(false)
    if (!result.success) {
      setError(result.error || 'Failed to create workspace.')
      return
    }
    onClose()
  }

  return (
    <Modal
      eyebrow="Shared Workspaces"
      title="Create a workspace"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <label className="block text-xs font-semibold text-muted">
          Workspace name
          <input
            required
            autoFocus
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="e.g. Product Team"
            className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-sage focus:ring-4 focus:ring-sage/15"
          />
        </label>
        <label className="block text-xs font-semibold text-muted">
          Description
          <textarea
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="Optional"
            rows={2}
            className="mt-2 w-full resize-none rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-sage focus:ring-4 focus:ring-sage/15"
          />
        </label>
        <label className="block text-xs font-semibold text-muted">
          Timezone
          <select
            value={timezone}
            onChange={event => setTimezone(event.target.value)}
            className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-sage focus:ring-4 focus:ring-sage/15"
          >
            {timezoneOptions.map(zone => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-[10px] font-normal text-muted">
            Anchors daily boundaries for this workspace (e.g. the automatic
            Daily Report) — not each member&apos;s own browser timezone.
          </span>
        </label>
        <label className="block text-xs font-semibold text-muted">
          Daily Report time
          <TimeOfDaySelect value={reportTime} onChange={setReportTime} />
          <span className="mt-1.5 block text-[10px] font-normal text-muted">
            OnTask automatically generates a Daily Report at this time, in the
            timezone above, covering the previous 24 hours.
          </span>
        </label>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Check size={15} />
          )}
          Create workspace
        </Button>
      </form>
    </Modal>
  )
}
