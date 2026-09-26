'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  HelpCircle,
} from 'lucide-react'
import { CopyButton } from '@/components/ui/CopyButton'
import { isNumberedVariant } from '@/lib/development/branchName'
import {
  ATTENTION_MESSAGES,
  ATTENTION_NEXT_STEPS,
  branchUrl,
  developmentAttention,
  isTracking,
} from '@/lib/development/tracking'
import type {
  GithubConnection,
  TaskDevelopment,
  WorkspaceTask,
} from '@/types/workspace'

const LINK_CLASS =
  'inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[10px] font-bold text-[var(--ws-accent,#375b4b)] transition hover:border-[var(--ws-accent,#375b4b)]'

function ExternalButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
      <ExternalLink size={11} /> {label}
    </a>
  )
}

function BranchRow({
  name,
  href,
  copy,
}: {
  name: string
  href: string | null
  copy: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-white/70 px-2.5 py-2">
      <GitBranch size={13} className="shrink-0 text-muted" />
      <code className="min-w-0 flex-1 select-all truncate font-mono text-[11px] font-semibold text-ink">
        {name}
      </code>
      {copy && <CopyButton value={name} />}
      {href && <ExternalButton href={href} label="Open" />}
    </div>
  )
}

// The short, non-technical explanation. Never mentions webhooks or polling --
// the user only needs to know what to do.
function HowTrackingWorks() {
  return (
    <div className="origin-top rounded-lg bg-[var(--ws-accent-soft,#e9f0ec)] px-3 py-2.5 text-[11px] leading-5 text-ink animate-[dropdownIn_150ms_ease-out]">
      <p className="font-bold">Track your code automatically</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-4">
        <li>Copy the branch name.</li>
        <li>
          Create a branch with this exact name in your connected repository.
        </li>
        <li>Start working, and open a Pull Request when your work is ready.</li>
      </ol>
      <p className="mt-1 text-muted">
        OnTask tracks the branch and updates this task as your work progresses —
        In Development, In Review, then Completed when the Pull Request is
        merged.
      </p>
    </div>
  )
}

// The one place a Development Task explains where its code is. Written for
// someone who has never connected OnTask to GitHub: every state says what is
// happening and, if anything, what to do next.
export function CodeTrackingPanel({
  task,
  development,
  connection,
  suggestedBranchName,
  onUseBranchName,
}: {
  task: Pick<WorkspaceTask, 'status'>
  development: TaskDevelopment
  connection: GithubConnection | null
  // The name OnTask would generate today (e.g. after a reassignment). Offered
  // only while the branch hasn't been seen -- a tracked branch is never renamed.
  suggestedBranchName?: string
  onUseBranchName?: (name: string) => void
}) {
  const [explaining, setExplaining] = useState(false)
  const tracking = isTracking(connection)
  const sameRepository =
    development.repositoryId !== null &&
    connection?.repositoryId !== null &&
    development.repositoryId === connection?.repositoryId
  const repository =
    sameRepository && connection?.repositoryFullName
      ? connection.repositoryFullName
      : (development.repositoryFullName ??
        connection?.repositoryFullName ??
        null)
  const detected = development.branchDetectedAt !== null
  const branchGone = development.branchDeletedAt !== null
  const attention = developmentAttention(task, development, connection)
  const branchHref =
    detected && !branchGone && repository
      ? branchUrl(repository, development.branchName)
      : null
  const finished = task.status === 'completed' || task.status === 'skipped'
  const pr =
    development.prNumber !== null
      ? {
          number: development.prNumber,
          title: development.prTitle,
          url: development.prUrl,
        }
      : null
  const offerRename =
    !detected &&
    pr === null &&
    !finished &&
    suggestedBranchName &&
    suggestedBranchName !== development.branchName &&
    // A -02 the database added to keep it unique is not a change of name.
    !isNumberedVariant(development.branchName, suggestedBranchName) &&
    onUseBranchName

  return (
    <section aria-label="Code tracking" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
          Code tracking
        </h3>
        <button
          type="button"
          onClick={() => setExplaining(open => !open)}
          aria-expanded={explaining}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted transition hover:text-ink"
        >
          <HelpCircle size={12} /> How does tracking work?
        </button>
      </div>

      {explaining && <HowTrackingWorks />}

      {attention && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-coral/25 bg-coral/5 px-3 py-2.5 text-[11px] leading-5"
        >
          <AlertTriangle
            size={13}
            className="mt-1 shrink-0 text-coral"
            aria-hidden
          />
          <div>
            <p className="font-bold text-coral">
              Needs Attention — {ATTENTION_MESSAGES[attention]}
            </p>
            <p className="text-muted">{ATTENTION_NEXT_STEPS[attention]}</p>
          </div>
        </div>
      )}

      {!detected ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
            <Circle size={12} className="text-muted" /> Branch not detected
          </p>
          <p className="text-[11px] leading-5 text-muted">
            {repository ? (
              <>
                Create this branch in{' '}
                <span className="font-semibold text-ink">{repository}</span>:
              </>
            ) : (
              'Create a branch with exactly this name:'
            )}
          </p>
          <BranchRow name={development.branchName} href={null} copy />
          {offerRename && (
            <p className="text-[11px] leading-5 text-muted">
              The assignee or title changed.{' '}
              <button
                type="button"
                onClick={() => onUseBranchName(suggestedBranchName)}
                className="font-semibold text-[var(--ws-accent,#375b4b)] underline-offset-2 hover:underline"
              >
                Use {suggestedBranchName}
              </button>{' '}
              instead?
            </p>
          )}
          {!finished &&
            (tracking ? (
              <p className="text-[11px] italic text-muted">
                Waiting for your branch…
              </p>
            ) : (
              <p className="text-[11px] leading-5 text-muted">
                GitHub isn&apos;t connected to this workspace yet, so the branch
                can&apos;t be tracked. The workspace owner can connect a
                repository in Settings.
              </p>
            ))}
        </div>
      ) : (
        <div className="space-y-2">
          {branchGone ? (
            <p className="flex items-center gap-1.5 text-xs font-bold text-muted">
              <Circle size={12} /> Branch deleted on GitHub
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
              <CheckCircle2 size={13} /> Branch connected
            </p>
          )}
          <BranchRow
            name={development.branchName}
            href={development.prState === 'merged' ? null : branchHref}
            copy={branchGone && !finished}
          />
        </div>
      )}

      {(detected || pr) && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
            Pull Request
          </p>
          {!pr ? (
            <p className="text-[11px] text-muted">
              — Not created yet. Open one from your branch when the work is
              ready for review.
            </p>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-white/70 px-2.5 py-2">
              {development.prState === 'merged' ? (
                <GitMerge size={13} className="shrink-0 text-violet-600" />
              ) : development.prState === 'closed' ? (
                <GitPullRequestClosed
                  size={13}
                  className="shrink-0 text-coral"
                />
              ) : (
                <GitPullRequest size={13} className="shrink-0 text-sky-600" />
              )}
              <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">
                #{pr.number}
                {pr.title ? ` — ${pr.title}` : ''}
              </p>
              {pr.url && <ExternalButton href={pr.url} label="Open PR" />}
            </div>
          )}

          {development.prState === 'open' && (
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-sky-700">
              <CircleDot size={12} /> In Review
            </p>
          )}
          {development.prState === 'closed' && !finished && !attention && (
            <p className="text-[11px] leading-5 text-muted">
              This Pull Request was closed without merging. Open a new Pull
              Request from the same branch when it&apos;s ready.
            </p>
          )}
          {development.prState === 'merged' &&
            (finished ? (
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
                <CheckCircle2 size={12} /> Completed — Pull Request #
                {pr?.number} was merged.
              </p>
            ) : (
              <p className="text-[11px] leading-5 text-muted">
                <span className="font-bold text-ink">
                  Pull Request #{pr?.number} was merged.
                </span>{' '}
                {task.status === 'blocked'
                  ? 'This task still has an active blocker — resolve it, then finish the task.'
                  : 'Finish the task when you’re ready.'}
              </p>
            ))}
        </div>
      )}

      {finished && development.prState !== 'merged' && (
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
          <CheckCircle2 size={12} />{' '}
          {task.status === 'skipped' ? 'Skipped' : 'Completed'}
        </p>
      )}
    </section>
  )
}
