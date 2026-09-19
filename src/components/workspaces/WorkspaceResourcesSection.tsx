import { ArrowRight, CirclePlus, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Skeleton } from '@/components/ui/Skeleton'
import { KIND_STYLES } from '@/components/resources/resourceKinds'
import { getPreviewKind } from '@/lib/resources'
import { tourAnchor } from '@/lib/tourAnchors'
import { WorkspaceResource } from '@/types/workspace'

const PREVIEW_COUNT = 3

function TypeChip({ resource }: { resource: WorkspaceResource }) {
  // Same icon per file type as the cards in the Resources modal.
  const Icon =
    KIND_STYLES[getPreviewKind(resource.fileName, resource.fileType)].icon
  return (
    <span
      title={resource.fileName}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-panel bg-[var(--ws-accent-soft,#e9f0ec)] text-[var(--ws-accent,#375b4b)]"
    >
      <Icon size={14} />
    </span>
  )
}

export function WorkspaceResourcesSection({
  ready,
  error,
  isPersonal,
  resources,
  onOpen,
  onAddResource,
}: {
  ready: boolean
  error?: string | null
  // Only changes the empty-state wording: files "you need" vs "the team needs".
  isPersonal: boolean
  resources: WorkspaceResource[]
  onOpen: () => void
  onAddResource: () => void
}) {
  const preview = resources.slice(0, PREVIEW_COUNT)

  return (
    <div
      // The anchor a Slack resource notification links to (#workspace-resources)
      // — resources have no page of their own, so the list is the destination.
      id="workspace-resources"
      {...tourAnchor('resources')}
      className="rounded-2xl border border-line bg-panel p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink">
          <FolderOpen size={15} className="text-[var(--ws-accent,#375b4b)]" />
          Resources
        </h2>
        {ready && resources.length > 0 && (
          <button
            onClick={onOpen}
            className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ws-accent,#375b4b)] transition hover:text-coral"
          >
            View Resources <ArrowRight size={12} />
          </button>
        )}
      </div>

      {ready && error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

      {!ready ? (
        <Skeleton className="mt-4 h-16 rounded-xl" />
      ) : resources.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No resources yet"
          size="sm"
          className="mt-4"
          action={
            <Button onClick={onAddResource}>
              <CirclePlus size={14} /> Add Resource
            </Button>
          }
        >
          {isPersonal
            ? 'Add documents, images and other files you need.'
            : 'Add documents, images and other files the team needs.'}
        </EmptyState>
      ) : (
        <button
          onClick={onOpen}
          className="mt-4 flex w-full items-center gap-4 rounded-xl border border-line/70 bg-white/50 p-3 text-left transition hover:border-[var(--ws-accent,#375b4b)]"
        >
          <div className="flex -space-x-2">
            {preview.map(resource => (
              <TypeChip key={resource.id} resource={resource} />
            ))}
          </div>
          <p className="text-xs font-semibold text-ink">
            {resources.length}{' '}
            {resources.length === 1 ? 'resource' : 'resources'}
          </p>
        </button>
      )}
    </div>
  )
}
