'use client'

import { useState } from 'react'
import { Download, Eye, Loader2, Trash2 } from 'lucide-react'
import { ResourcePreview } from '@/components/resources/ResourcePreview'
import {
  formatFileSize,
  resourcePreviewUrl,
  resourceTypeLabel,
  SignedUrlGetter,
} from '@/lib/resources'
import { timeAgo } from '@/lib/time'
import { showErrorToast } from '@/lib/toast'
import { WorkspaceMember, WorkspaceResource } from '@/types/workspace'

const ACTION_BASE =
  'flex h-8 items-center justify-center rounded-lg border border-line text-muted transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60'
const ACTION_ACCENT =
  'hover:border-[var(--ws-accent,#375b4b)] hover:text-[var(--ws-accent,#375b4b)] focus-visible:ring-[color:var(--ws-accent,#375b4b)]'
const ACTION_DANGER =
  'hover:border-coral/40 hover:bg-coral/10 hover:text-coral focus-visible:ring-coral'

// One resource in the modal's grid. The card is a flex column that clips its
// own contents: a preview tile of fixed proportions, then a body whose text
// rows truncate and whose action row can never be wider than the card. Every
// flex child on the path to those rows has `min-w-0` -- without it a flex
// item refuses to shrink below its content (a long filename, or the labelled
// buttons), which is what used to push Delete out past the card's edge.
export function ResourceCard({
  resource,
  uploader,
  canDelete,
  getSignedUrl,
  onDelete,
}: {
  resource: WorkspaceResource
  uploader?: WorkspaceMember
  canDelete: boolean
  getSignedUrl: SignedUrlGetter
  // Asks to delete; the caller decides whether to confirm first.
  onDelete: (resource: WorkspaceResource) => void
}) {
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null)

  const openFile = async (mode: 'preview' | 'download') => {
    if (busy) return
    setBusy(mode)
    const url = await getSignedUrl(
      resource.storagePath,
      mode === 'download' ? { download: resource.fileName } : undefined,
    )
    setBusy(null)
    if (!url) {
      showErrorToast(
        mode === 'download'
          ? "Couldn't download the file."
          : "Couldn't open the file.",
      )
      return
    }
    const link = document.createElement('a')
    link.href =
      mode === 'preview'
        ? resourcePreviewUrl(url, resource.fileName, resource.fileType)
        : url
    if (mode === 'download') link.download = resource.fileName
    else link.target = '_blank'
    link.rel = 'noreferrer'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <li className="group flex min-w-0 animate-[slideInFade_260ms_ease-out] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-sm transition hover:border-sage hover:shadow-md">
      {/* Mouse shortcut for Preview. Deliberately a plain div: the labelled
          Preview button below is the keyboard/screen-reader route, so this
          isn't a second tab stop doing the same thing. */}
      <div
        onClick={() => void openFile('preview')}
        title={`Preview ${resource.fileName}`}
        className="cursor-pointer border-b border-line/70"
      >
        <ResourcePreview resource={resource} getSignedUrl={getSignedUrl} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
        <div className="min-w-0">
          <p
            className="truncate text-xs font-bold text-ink"
            title={resource.fileName}
          >
            {resource.fileName}
          </p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-muted">
            {resourceTypeLabel(resource.fileName)} ·{' '}
            {formatFileSize(resource.fileSize)}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-muted/80">
            {uploader?.fullName || uploader?.email || 'Someone'} ·{' '}
            {timeAgo(resource.createdAt)}
          </p>
        </div>

        <div className="mt-auto flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            aria-label={`Preview ${resource.fileName}`}
            disabled={busy !== null}
            onClick={() => void openFile('preview')}
            className={`${ACTION_BASE} ${ACTION_ACCENT} min-w-0 flex-1 gap-1 px-2 text-[11px] font-semibold`}
          >
            {busy === 'preview' ? (
              <Loader2 size={12} className="shrink-0 animate-spin" />
            ) : (
              <Eye size={12} className="shrink-0" />
            )}
            <span className="truncate">Preview</span>
          </button>
          <button
            type="button"
            aria-label={`Download ${resource.fileName}`}
            title="Download"
            disabled={busy !== null}
            onClick={() => void openFile('download')}
            className={`${ACTION_BASE} ${ACTION_ACCENT} w-8 shrink-0`}
          >
            {busy === 'download' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Download size={13} />
            )}
          </button>
          {canDelete && (
            <button
              type="button"
              aria-label={`Delete ${resource.fileName}`}
              title="Delete"
              onClick={() => onDelete(resource)}
              className={`${ACTION_BASE} ${ACTION_DANGER} w-8 shrink-0`}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
