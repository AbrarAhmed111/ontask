'use client'

import { FormEvent, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { TimeOfDaySelect } from '@/components/workspaces/TimeOfDaySelect'
import { showSuccessToast } from '@/lib/toast'
import { roundToQuarterHour } from '@/lib/dailyReportWindow'
import {
  getWorkspaceTheme,
  WORKSPACE_THEMES,
  WorkspaceThemeId,
  workspaceThemeVars,
} from '@/lib/workspaceThemes'
import { Workspace } from '@/types/workspace'
import { COMMON_TIMEZONES } from '@/lib/timezones'

export function EditWorkspaceModal({
  workspace,
  isPersonal = false,
  onSave,
  onClose,
}: {
  workspace: Workspace
  // A personal workspace keeps its fixed name; only when/where its Daily
  // Report runs and its accent are up to the user.
  isPersonal?: boolean
  onSave: (patch: {
    name: string
    description: string
    timezone: string
    reportTime: string
    accent: string
  }) => Promise<{ success: boolean; error?: string }>
  onClose: () => void
}) {
  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(workspace.description ?? '')
  const [timezone, setTimezone] = useState(workspace.timezone)
  const [reportTime, setReportTime] = useState(
    roundToQuarterHour(workspace.reportTime),
  )
  const [accent, setAccent] = useState<WorkspaceThemeId>(
    (workspace.accent as WorkspaceThemeId) || 'forest',
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const timezoneOptions = COMMON_TIMEZONES.includes(workspace.timezone)
    ? COMMON_TIMEZONES
    : [workspace.timezone, ...COMMON_TIMEZONES]
  // Overrides the --ws-accent set by the surrounding WorkspaceShell (which
  // reflects the workspace's already-SAVED theme) with whatever the user
  // has clicked so far, so "Save changes" — and anything else themed inside
  // this form — previews the new color immediately instead of only
  // updating after the save round-trips.
  const previewTheme = getWorkspaceTheme(accent)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    const result = await onSave({
      name: name.trim(),
      description: description.trim(),
      timezone,
      reportTime: `${reportTime}:00`,
      accent,
    })
    setLoading(false)
    if (!result.success) {
      setError(result.error || 'Failed to save changes.')
      return
    }
    showSuccessToast('Workspace updated.')
    onClose()
  }

  return (
    <Modal
      eyebrow={isPersonal ? 'Personal Workspace' : 'Owner settings'}
      title={isPersonal ? 'Edit settings' : 'Edit workspace'}
      onClose={onClose}
    >
      <form
        onSubmit={handleSubmit}
        style={workspaceThemeVars(previewTheme)}
        className="space-y-4"
      >
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {!isPersonal && (
          <>
            <label className="block text-xs font-semibold text-muted">
              Workspace name
              <input
                required
                autoFocus
                value={name}
                onChange={event => setName(event.target.value)}
                className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-sage focus:ring-4 focus:ring-sage/15"
              />
            </label>
            <label className="block text-xs font-semibold text-muted">
              Description
              <textarea
                value={description}
                onChange={event => setDescription(event.target.value)}
                rows={2}
                className="mt-2 w-full font-light resize-none rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-sage focus:ring-4 focus:ring-sage/15"
              />
            </label>
          </>
        )}
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
        </label>
        <label className="block text-xs font-semibold text-muted">
          Daily Report time
          <TimeOfDaySelect value={reportTime} onChange={setReportTime} />
          <span className="mt-1.5 block text-[10px] font-normal text-muted">
            OnTask automatically generates a Daily Report at this time, in the
            timezone above, covering the previous 24 hours.
          </span>
        </label>
        <div>
          <p className="text-xs font-semibold text-muted">Accent theme</p>
          <div className="mt-2 flex flex-wrap gap-2.5">
            {WORKSPACE_THEMES.map(theme => (
              <button
                key={theme.id}
                type="button"
                aria-label={theme.label}
                title={theme.label}
                onClick={() => setAccent(theme.id)}
                style={{ backgroundColor: theme.strong }}
                className={`grid h-8 w-8 place-items-center rounded-full transition ${
                  accent === theme.id
                    ? 'ring-2 ring-ink ring-offset-2 ring-offset-panel'
                    : 'hover:scale-105'
                }`}
              >
                {accent === theme.id && (
                  <Check size={14} className="text-white" />
                )}
              </button>
            ))}
          </div>
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Check size={15} />
          )}
          Save changes
        </Button>
      </form>
    </Modal>
  )
}
