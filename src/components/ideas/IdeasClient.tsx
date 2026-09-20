'use client'

import { useState } from 'react'
import { Archive, Lightbulb, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import { useWorkspaceIdeas } from '@/hooks/useWorkspaceIdeas'
import { IdeaCard } from '@/components/ideas/IdeaCard'
import { IdeaFormModal } from '@/components/ideas/IdeaFormModal'
import type { Idea } from '@/types/workspace'

export function IdeasClient() {
  const { workspace, members, user } = useWorkspaceDetail()
  const workspaceId = workspace?.id ?? ''

  const {
    ideas,
    ready,
    error,
    createIdea,
    updateIdea,
    archiveIdea,
    unarchiveIdea,
    deleteIdea,
  } = useWorkspaceIdeas(workspaceId, user)

  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingIdea, setEditingIdea] = useState<Idea | undefined>(undefined)

  const activeIdeas = ideas.filter(i => i.status !== 'archived')
  const archivedIdeas = ideas.filter(i => i.status === 'archived')
  const displayedIdeas = activeTab === 'active' ? activeIdeas : archivedIdeas

  const handleOpenCreate = () => {
    setEditingIdea(undefined)
    setModalOpen(true)
  }

  const handleOpenEdit = (idea: Idea) => {
    setEditingIdea(idea)
    setModalOpen(true)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <Lightbulb className="h-6 w-6 text-[var(--ws-accent,#375b4b)]" />
            Ideas & Things to Remember
          </h1>
          <p className="mt-1 text-sm text-muted">
            A shared place to capture ideas, opportunities, experiments, and
            thoughts before they turn into execution.
          </p>
        </div>

        <Button onClick={handleOpenCreate} className="shrink-0 gap-1.5">
          <Plus className="h-4 w-4" />
          New Idea
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-line pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('active')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === 'active'
                ? 'bg-ink text-white'
                : 'text-muted hover:bg-white hover:text-ink'
            }`}
          >
            Active ({activeIdeas.length})
          </button>
          <button
            onClick={() => setActiveTab('archived')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === 'archived'
                ? 'bg-ink text-white'
                : 'text-muted hover:bg-white hover:text-ink'
            }`}
          >
            <Archive className="h-3.5 w-3.5" />
            Archived ({archivedIdeas.length})
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 font-medium">
          {error}
        </div>
      )}

      {/* Loading state */}
      {!ready ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : displayedIdeas.length === 0 ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/50 py-16 text-center">
          <div className="rounded-full bg-[var(--ws-accent,#375b4b)]/10 p-4 text-[var(--ws-accent,#375b4b)]">
            <Lightbulb className="h-8 w-8" />
          </div>
          <h3 className="mt-4 text-base font-bold text-ink">
            {activeTab === 'active'
              ? 'No active ideas yet'
              : 'No archived ideas'}
          </h3>
          <p className="mt-1 max-w-sm text-xs text-muted">
            {activeTab === 'active'
              ? 'Capture team ideas, future opportunities, improvements, or research items here.'
              : 'Archived ideas will appear here for historical context.'}
          </p>
          {activeTab === 'active' && (
            <Button
              onClick={handleOpenCreate}
              variant="secondary"
              className="mt-4 gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Capture your first idea
            </Button>
          )}
        </div>
      ) : (
        /* Ideas Grid */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayedIdeas.map(idea => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              members={members}
              onEdit={handleOpenEdit}
              onArchive={archiveIdea}
              onUnarchive={unarchiveIdea}
              onDelete={deleteIdea}
            />
          ))}
        </div>
      )}

      {/* Form Modal */}
      {modalOpen && (
        <IdeaFormModal
          initial={editingIdea}
          members={members}
          onSubmit={async input => {
            if (editingIdea) {
              return await updateIdea(editingIdea.id, input)
            }
            return await createIdea(input)
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}
