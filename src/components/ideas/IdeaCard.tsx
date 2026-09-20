'use client'

import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bell,
  CheckCircle2,
  Clock,
  Edit2,
  FlaskConical,
  HelpCircle,
  Lightbulb,
  Link2,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import type {
  Idea,
  IdeaStatus,
  IdeaType,
  WorkspaceMember,
} from '@/types/workspace'

const TYPE_CONFIG: Record<
  IdeaType,
  { label: string; icon: typeof Lightbulb; bgClass: string; textClass: string }
> = {
  idea: {
    label: 'Idea',
    icon: Lightbulb,
    bgClass: 'bg-purple-500/10 border-purple-500/20',
    textClass: 'text-purple-600 dark:text-purple-400',
  },
  important: {
    label: 'Important',
    icon: AlertCircle,
    bgClass: 'bg-coral/10 border-coral/20',
    textClass: 'text-coral',
  },
  improvement: {
    label: 'Improvement',
    icon: TrendingUp,
    bgClass: 'bg-emerald-500/10 border-emerald-500/20',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  experiment: {
    label: 'Experiment',
    icon: FlaskConical,
    bgClass: 'bg-cyan-500/10 border-cyan-500/20',
    textClass: 'text-cyan-600 dark:text-cyan-400',
  },
  opportunity: {
    label: 'Opportunity',
    icon: Sparkles,
    bgClass: 'bg-sage/20 border-sage/40',
    textClass: 'text-forest dark:text-sage',
  },
  problem: {
    label: 'Problem',
    icon: AlertTriangle,
    bgClass: 'bg-rose-500/10 border-rose-500/20',
    textClass: 'text-rose-600 dark:text-rose-400',
  },
  research: {
    label: 'Research',
    icon: Search,
    bgClass: 'bg-blue-500/10 border-blue-500/20',
    textClass: 'text-blue-600 dark:text-blue-400',
  },
  reminder: {
    label: 'Reminder',
    icon: Bell,
    bgClass: 'bg-teal-500/10 border-teal-500/20',
    textClass: 'text-teal-600 dark:text-teal-400',
  },
  question: {
    label: 'Question',
    icon: HelpCircle,
    bgClass: 'bg-violet-500/10 border-violet-500/20',
    textClass: 'text-violet-600 dark:text-violet-400',
  },
}

const STATUS_CONFIG: Record<IdeaStatus, { label: string; badgeClass: string }> =
  {
    open: {
      label: 'Open',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    },
    planned: {
      label: 'Planned',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    in_progress: {
      label: 'In Progress',
      badgeClass: 'bg-forest/10 text-forest border-forest/20',
    },
    completed: {
      label: 'Completed',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    archived: {
      label: 'Archived',
      badgeClass: 'bg-zinc-100 text-zinc-600 border-zinc-200',
    },
  }

export function IdeaCard({
  idea,
  members,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  idea: Idea
  members: WorkspaceMember[]
  onEdit: (idea: Idea) => void
  onArchive: (ideaId: string) => void
  onUnarchive: (ideaId: string) => void
  onDelete: (ideaId: string) => void
}) {
  const typeConf = TYPE_CONFIG[idea.type] || TYPE_CONFIG.idea
  const TypeIcon = typeConf.icon
  const statusConf = STATUS_CONFIG[idea.status] || STATUS_CONFIG.open

  const creator = members.find(m => m.userId === idea.createdBy)
  const creditedMembers = members.filter(m =>
    idea.creditedUserIds.includes(m.userId),
  )

  const createdDateStr = new Date(idea.createdAt).toLocaleDateString(
    undefined,
    {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    },
  )

  const hasLinkedExecution = idea.taskCount > 0 || idea.goalCount > 0

  return (
    <div className="flex flex-col justify-between rounded-xl border border-line bg-white p-5 shadow-xs transition hover:shadow-md">
      <div>
        {/* Header Badges & Actions */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${typeConf.bgClass} ${typeConf.textClass}`}
            >
              <TypeIcon className="h-3.5 w-3.5" />
              {typeConf.label}
            </span>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusConf.badgeClass}`}
            >
              {statusConf.label}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onEdit(idea)}
              title="Edit Idea"
              className="rounded p-1.5 text-muted hover:bg-paper hover:text-ink transition"
            >
              <Edit2 className="h-4 w-4" />
            </button>
            {idea.archivedAt ? (
              <button
                onClick={() => onUnarchive(idea.id)}
                title="Unarchive Idea"
                className="rounded p-1.5 text-muted hover:bg-paper hover:text-ink transition"
              >
                <ArchiveRestore className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => onArchive(idea.id)}
                title="Archive Idea"
                className="rounded p-1.5 text-muted hover:bg-paper hover:text-ink transition"
              >
                <Archive className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => onDelete(idea.id)}
              title="Delete Idea"
              className="rounded p-1.5 text-muted hover:bg-rose-50 hover:text-rose-600 transition"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Title & Description */}
        <h3 className="mt-3 text-base font-bold text-ink">{idea.title}</h3>
        {idea.description && (
          <p className="mt-1.5 text-sm text-muted whitespace-pre-line leading-relaxed">
            {idea.description}
          </p>
        )}
      </div>

      <div className="mt-5 space-y-3 pt-3 border-t border-line/60">
        {/* Linked Execution Indicator */}
        {hasLinkedExecution ? (
          <div className="inline-flex items-center gap-1.5 rounded-lg bg-sage/10 px-2.5 py-1 text-xs font-medium text-sage-dark">
            <Link2 className="h-3.5 w-3.5" />
            <span>
              Linked execution:{' '}
              {idea.taskCount > 0
                ? `${idea.taskCount} Task${idea.taskCount > 1 ? 's' : ''}`
                : ''}
              {idea.taskCount > 0 && idea.goalCount > 0 ? ' · ' : ''}
              {idea.goalCount > 0
                ? `${idea.goalCount} Goal${idea.goalCount > 1 ? 's' : ''}`
                : ''}
            </span>
          </div>
        ) : (
          <div className="text-xs text-muted/70 italic">
            No linked execution yet
          </div>
        )}

        {/* Members & Metadata Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          {/* Credits To */}
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-ink">Credits to:</span>
            {creditedMembers.length > 0 ? (
              <div className="flex items-center gap-1">
                {creditedMembers.map(m => (
                  <span
                    key={m.userId}
                    title={m.fullName || m.email || 'Member'}
                    className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-ink border border-line"
                  >
                    <Avatar person={m} className="h-3.5 w-3.5" />
                    {m.fullName?.split(' ')[0] || m.email?.split('@')[0]}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-muted/60 italic">Uncredited</span>
            )}
          </div>

          {/* Created By & Date */}
          <div className="flex items-center gap-1.5 text-[11px]">
            <span>
              Added by{' '}
              {creator?.fullName?.split(' ')[0] ||
                creator?.email?.split('@')[0] ||
                'Unknown'}
            </span>
            <span>·</span>
            <span>{createdDateStr}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
