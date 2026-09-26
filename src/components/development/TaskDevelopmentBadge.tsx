'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Code2,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
} from 'lucide-react'
import { CopyButton } from '@/components/ui/CopyButton'
import { DropdownPanel } from '@/components/ui/DropdownPanel'
import { useTaskDevelopment } from '@/components/development/DevelopmentDataContext'
import {
  StageBadge,
  StageDot,
  WorkTypeBadge,
} from '@/components/development/DevelopmentBadges'
import {
  ATTENTION_MESSAGES,
  STAGE_LABELS,
  branchUrl,
  developmentAttention,
  developmentStage,
  isTracking,
} from '@/lib/development/tracking'
import type {
  GithubConnection,
  TaskDevelopment,
  WorkspaceTask,
} from '@/types/workspace'

// How long the pointer may be off the badge and its panel before a hover-opened
// panel closes -- enough to cross the gap between them.
const HOVER_CLOSE_MS = 150

// What the badge's panel says about a Development Task's code: kind of work,
// stage, branch and Pull Request. Read-only; the full task (reassign, rename
// the branch, ...) is one click away in the Development section.
export function TaskDevelopmentSummary({
  task,
  development,
  connection,
  onOpen,
}: {
  task: Pick<WorkspaceTask, 'status'>
  development: TaskDevelopment
  connection: GithubConnection | null
  onOpen?: () => void
}) {
  const stage = developmentStage(task, development, connection)
  const attention = developmentAttention(task, development, connection)
  const detected = development.branchDetectedAt !== null
  const branchGone = development.branchDeletedAt !== null
  const sameRepository =
    development.repositoryId !== null &&
    connection?.repositoryId !== null &&
    development.repositoryId === connection?.repositoryId
  const repository =
    sameRepository && connection?.repositoryFullName
      ? connection.repositoryFullName
      : (development.repositoryFullName ?? connection?.repositoryFullName ?? null)
  const branchHref =
    detected && !branchGone && repository && development.prState !== 'merged'
      ? branchUrl(repository, development.branchName)
      : null
  const PrIcon =
    development.prState === 'merged'
      ? GitMerge
      : development.prState === 'closed'
        ? GitPullRequestClosed
        : GitPullRequest
  const prIconClass =
    development.prState === 'merged'
      ? 'text-violet-600'
      : development.prState === 'closed'
        ? 'text-coral'
        : 'text-sky-600'

  return (
    <div className="space-y-3 p-3.5 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WorkTypeBadge type={development.workType} />
        <StageBadge stage={stage} />
      </div>

      {attention && (
        <p className="flex items-start gap-1.5 rounded-lg bg-coral/10 px-2.5 py-1.5 text-[11px] font-semibold leading-4 text-coral">
          <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden />
          {ATTENTION_MESSAGES[attention]}
        </p>
      )}

      <div className="space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
          Branch
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-white/70 px-2.5 py-1.5">
          <GitBranch size={12} className="shrink-0 text-muted" />
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-ink">
            {development.branchName}
          </code>
          <CopyButton value={development.branchName} />
        </div>
        <p className="text-[10px] text-muted">
          {detected && branchGone ? (
            'Deleted on GitHub.'
          ) : detected ? (
            <>
              Connected
              {repository && (
                <>
                  {' '}
                  in{' '}
                  {branchHref ? (
                    <a
                      href={branchHref}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-[var(--ws-accent,#375b4b)] hover:underline"
                    >
                      {repository}
                    </a>
                  ) : (
                    <span className="font-semibold text-ink">{repository}</span>
                  )}
                </>
              )}
            </>
          ) : isTracking(connection) ? (
            'Waiting for this branch to be created.'
          ) : (
            'Not tracked yet — GitHub isn’t connected.'
          )}
        </p>
      </div>

      <div className="space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
          Pull Request
        </p>
        {development.prNumber === null ? (
          <p className="text-[11px] text-muted">Not opened yet.</p>
        ) : (
          <div className="flex items-center gap-2">
            <PrIcon size={12} className={`shrink-0 ${prIconClass}`} />
            <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">
              #{development.prNumber}
              {development.prTitle ? ` — ${development.prTitle}` : ''}
            </p>
            {development.prUrl && (
              <a
                href={development.prUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open Pull Request #${development.prNumber}`}
                className="shrink-0 rounded-md p-1 text-muted transition hover:bg-slate-100 hover:text-ink"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}
      </div>

      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="w-full rounded-lg bg-[var(--ws-accent-soft,#e9f0ec)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ws-accent,#375b4b)] transition hover:opacity-80"
        >
          Open Development Task
        </button>
      )}
    </div>
  )
}

// Marks a task as code work wherever the task shows up (a Goal's tasks, the
// task list), with its stage, so anyone can see at a glance that a teammate is
// on a code task. Hovering shows the branch and Pull Request; clicking pins the
// panel open (the way to reach it on a touch screen or with a keyboard).
export function TaskDevelopmentBadge({
  task,
  development,
  connection,
}: {
  task: Pick<WorkspaceTask, 'id' | 'status'>
  development: TaskDevelopment
  connection: GithubConnection | null
}) {
  const [open, setOpen] = useState<'hover' | 'pinned' | null>(null)
  const closeTimer = useRef<number | null>(null)
  const router = useRouter()
  const stage = developmentStage(task, development, connection)

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  useEffect(() => cancelClose, [])

  useEffect(() => {
    if (open !== 'pinned') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // The Development section opens `?devtask=<id>` (the same link a
  // notification uses) in its task detail. Read from the location on click
  // rather than useSearchParams, which would need a Suspense boundary around
  // every task card.
  const openTask = () => {
    setOpen(null)
    const url = new URL(window.location.href)
    url.searchParams.set('devtask', task.id)
    router.replace(`${url.pathname}${url.search}`, { scroll: false })
  }

  const panelClass = 'w-72'

  return (
    <span
      className="relative inline-flex shrink-0"
      onMouseEnter={() => {
        cancelClose()
        setOpen(current => current ?? 'hover')
      }}
      onMouseLeave={() => {
        if (open !== 'hover') return
        cancelClose()
        closeTimer.current = window.setTimeout(
          () => setOpen(current => (current === 'hover' ? null : current)),
          HOVER_CLOSE_MS,
        )
      }}
    >
      <button
        type="button"
        onClick={() =>
          setOpen(current => (current === 'pinned' ? null : 'pinned'))
        }
        aria-expanded={open !== null}
        aria-label={`Code task, ${STAGE_LABELS[stage]}. Show development details`}
        className="inline-flex items-center gap-1 rounded-full border border-line bg-[var(--ws-accent-soft,#e9f0ec)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--ws-accent,#375b4b)] transition hover:border-[var(--ws-accent,#375b4b)]"
      >
        <Code2 size={11} aria-hidden />
        Code
        <StageDot stage={stage} />
      </button>

      {open === 'pinned' && (
        <DropdownPanel
          onClose={() => setOpen(null)}
          align="left"
          className={panelClass}
        >
          <TaskDevelopmentSummary
            task={task}
            development={development}
            connection={connection}
            onOpen={openTask}
          />
        </DropdownPanel>
      )}
      {open === 'hover' && (
        // Same panel without DropdownPanel's click-away layer, which would sit
        // under the pointer and end the hover the moment it opened.
        <div className={`absolute left-0 top-full z-50 pt-2 ${panelClass}`}>
          <div className="max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-panel shadow-xl animate-[dropdownIn_140ms_ease-out]">
            <TaskDevelopmentSummary
              task={task}
              development={development}
              connection={connection}
              onOpen={openTask}
            />
          </div>
        </div>
      )}
    </span>
  )
}

// The badge for any task, rendering nothing unless it is a Development Task
// here -- for lists that show many tasks (Working now).
export function TaskCodeBadge({
  task,
}: {
  task: Pick<WorkspaceTask, 'id' | 'status'>
}) {
  const code = useTaskDevelopment(task.id)
  if (!code) return null
  return (
    <TaskDevelopmentBadge
      task={task}
      development={code.development}
      connection={code.connection}
    />
  )
}
