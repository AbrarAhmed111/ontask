import {
  BookOpen,
  Bug,
  Flag,
  Flame,
  Shuffle,
  Sparkles,
  TrendingUp,
  Wrench,
} from 'lucide-react'
import {
  DevelopmentStage,
  PRIORITY_LABELS,
  STAGE_LABELS,
  workTypeInfo,
} from '@/lib/development/tracking'
import type { DevelopmentWorkType, TaskPriority } from '@/types/workspace'

const WORK_TYPE_ICONS: Record<
  DevelopmentWorkType,
  { icon: typeof Bug; className: string }
> = {
  feature: { icon: Sparkles, className: 'text-violet-600' },
  bug: { icon: Bug, className: 'text-coral' },
  hotfix: { icon: Flame, className: 'text-orange-600' },
  improvement: { icon: TrendingUp, className: 'text-sky-600' },
  refactor: { icon: Shuffle, className: 'text-teal-600' },
  chore: { icon: Wrench, className: 'text-slate-500' },
  docs: { icon: BookOpen, className: 'text-amber-600' },
}

export function WorkTypeIcon({
  type,
  size = 13,
}: {
  type: DevelopmentWorkType
  size?: number
}) {
  const { icon: Icon, className } = WORK_TYPE_ICONS[type]
  return <Icon size={size} className={`shrink-0 ${className}`} aria-hidden />
}

// "Feature", "Bug", ... with its icon.
export function WorkTypeBadge({ type }: { type: DevelopmentWorkType }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted">
      <WorkTypeIcon type={type} size={11} />
      {workTypeInfo(type).label}
    </span>
  )
}

const STAGE_CLASSES: Record<DevelopmentStage, string> = {
  queued: 'bg-slate-100 text-muted',
  in_development: 'bg-amber-50 text-amber-700',
  in_review: 'bg-sky-50 text-sky-700',
  completed: 'bg-emerald-50 text-emerald-700',
}

const STAGE_DOTS: Record<DevelopmentStage, string> = {
  queued: 'border border-muted/60 bg-transparent',
  in_development: 'bg-amber-500',
  in_review: 'bg-sky-500',
  completed: 'bg-emerald-500',
}

export function StageDot({ stage }: { stage: DevelopmentStage }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${STAGE_DOTS[stage]}`}
    />
  )
}

export function StageBadge({ stage }: { stage: DevelopmentStage }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${STAGE_CLASSES[stage]}`}
    >
      <StageDot stage={stage} />
      {STAGE_LABELS[stage]}
    </span>
  )
}

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  low: 'text-muted',
  medium: 'text-sky-700',
  high: 'text-amber-700',
  urgent: 'text-coral',
}

export function PriorityBadge({
  priority,
}: {
  priority: TaskPriority | null | undefined
}) {
  if (!priority) return null
  return (
    <span
      title={`${PRIORITY_LABELS[priority]} priority`}
      className={`inline-flex items-center gap-1 text-[10px] font-bold ${PRIORITY_CLASSES[priority]}`}
    >
      <Flag size={10} />
      {PRIORITY_LABELS[priority]}
    </span>
  )
}

// Just the coloured flag, for a priority picker's options.
export function PriorityFlag({ priority }: { priority: TaskPriority | null }) {
  return (
    <Flag
      size={13}
      aria-hidden
      className={`shrink-0 ${priority ? PRIORITY_CLASSES[priority] : 'text-muted/50'}`}
    />
  )
}
