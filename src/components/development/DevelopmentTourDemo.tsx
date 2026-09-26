'use client'

import { useMemo } from 'react'
import {
  CheckCircle2,
  CircleDot,
  Eye,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Terminal,
} from 'lucide-react'
import { DevelopmentBoard } from '@/components/development/DevelopmentBoard'
import { WorkTypeBadge } from '@/components/development/DevelopmentBadges'
import { checkoutCommand } from '@/lib/development/branchName'
import {
  DEMO_GOALS,
  DEMO_JOURNEY_TASK_ID,
  DEMO_MEMBERS,
  DEMO_REPOSITORY,
  buildDemoItems,
} from '@/lib/development/tourDemo'
import { tourAnchor } from '@/lib/tourAnchors'

const noop = () => {}

type JourneyStep = {
  icon: typeof GitBranch
  className: string
  title: string
  detail: string
  when: string
}

// What the Development section shows in place of its board while the
// Development tour runs: a connected repository, a branch name to copy, a board
// with a task at every stage, and one task's journey from creation to merge.
// Sample data only (lib/development/tourDemo) -- nothing here reads or writes
// the workspace, and nothing is clickable in a way that could.
export function DevelopmentTourDemo() {
  const items = useMemo(() => buildDemoItems(), [])
  const queued = items.find(
    item => item.development.trackingStatus === 'waiting',
  )
  const journey = items.find(item => item.task.id === DEMO_JOURNEY_TASK_ID)

  const journeySteps: JourneyStep[] = journey
    ? [
        {
          icon: CircleDot,
          className: 'text-muted',
          title: 'Task created — Queued',
          detail: `OnTask named the branch ${journey.development.branchName}`,
          when: 'Mon 9:12',
        },
        {
          icon: GitBranch,
          className: 'text-amber-600',
          title: 'Branch pushed — In Development',
          detail: `Detected in ${DEMO_REPOSITORY}`,
          when: 'Mon 10:03',
        },
        {
          icon: GitPullRequest,
          className: 'text-sky-600',
          title: `Pull Request #${journey.development.prNumber} opened — In Review`,
          detail: journey.development.prTitle ?? '',
          when: 'Wed 14:40',
        },
        {
          icon: GitMerge,
          className: 'text-violet-600',
          title: `#${journey.development.prNumber} merged — Completed`,
          detail: 'OnTask finished the task on its own.',
          when: 'Thu 11:15',
        },
      ]
    : []

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--ws-accent,#375b4b)] bg-[var(--ws-accent-soft,#e9f0ec)] px-4 py-2.5 text-[11px] font-semibold text-[var(--ws-accent,#375b4b)]">
        <Eye size={13} className="shrink-0" />
        Sample data — a preview of how Development works. Nothing here is saved.
      </p>

      <p
        className="flex w-fit items-center gap-1.5 text-[11px] text-muted"
        {...tourAnchor('dev-connection')}
      >
        <CheckCircle2 size={12} className="text-emerald-600" />
        Tracking{' '}
        <span className="font-semibold text-ink">{DEMO_REPOSITORY}</span>
      </p>

      {queued && (
        <div
          className="rounded-2xl border border-line bg-panel p-4 shadow-sm"
          {...tourAnchor('dev-branch-name')}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-ink">{queued.task.name}</p>
            <WorkTypeBadge type={queued.development.workType} />
          </div>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
            Branch
          </p>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5">
            <GitBranch size={14} className="shrink-0 text-muted" />
            <code className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-ink">
              {queued.development.branchName}
            </code>
          </div>
          <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] text-muted">
            <Terminal size={11} className="shrink-0" />
            <span className="truncate">
              {checkoutCommand(queued.development.branchName)}
            </span>
          </p>
        </div>
      )}

      <DevelopmentBoard
        items={items}
        goals={DEMO_GOALS}
        members={DEMO_MEMBERS}
        onOpen={noop}
      />

      {journey && (
        <section
          aria-label="A task's journey"
          className="rounded-2xl border border-line bg-panel p-4 shadow-sm"
          {...tourAnchor('dev-journey')}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-ink">{journey.task.name}</p>
            <WorkTypeBadge type={journey.development.workType} />
          </div>
          <ol className="mt-3 space-y-3">
            {journeySteps.map((step, index) => {
              const Icon = step.icon
              return (
                <li key={step.title} className="relative flex gap-3">
                  {index < journeySteps.length - 1 && (
                    <span
                      aria-hidden
                      className="absolute left-[11px] top-6 h-[calc(100%-6px)] w-px bg-line"
                    />
                  )}
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-white">
                    <Icon size={12} className={step.className} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11px] font-bold text-ink">
                      {step.title}
                      <span className="font-mono text-[10px] font-normal text-muted">
                        {step.when}
                      </span>
                    </p>
                    <p className="truncate text-[11px] text-muted">
                      {step.detail}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}
