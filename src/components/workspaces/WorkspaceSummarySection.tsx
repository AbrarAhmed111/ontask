'use client'

import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  OctagonAlert,
  RefreshCw,
  Sparkles,
  UserPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Skeleton } from '@/components/ui/Skeleton'
import { formatBoundary } from '@/lib/dailyReportWindow'
import {
  ReportTaskStatus,
  dailyReportNarrativeSections,
  getDailyReportMetrics,
  hasReportActivity,
  reportTaskStatus,
} from '@/lib/dailyReportMetrics'
import { formatHM } from '@/lib/time'
import { useReportFocus } from '@/components/workspaces/FocusedReportContext'
import {
  StructuredSnapshotBlocker,
  StructuredSnapshotMember,
  StructuredSnapshotTaskActivity,
  StructuredSnapshotWorkspaceChanges,
  WorkspaceDailySummary,
  WorkspaceMember,
  WorkspaceStructuredSnapshot,
} from '@/types/workspace'

// The report's own frozen report_timezone is used here (never the
// workspace's current timezone) so a historical report keeps displaying the
// window it was actually generated for, even after the workspace's timezone
// setting is later changed.
function formatWindow(summary: WorkspaceDailySummary): string {
  const start = formatBoundary(
    new Date(summary.reportStart),
    summary.reportTimezone,
  )
  const end = formatBoundary(
    new Date(summary.reportEnd),
    summary.reportTimezone,
  )
  return `${start} → ${end}`
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const STATUS_STYLE: Record<ReportTaskStatus, string> = {
  completed: 'bg-sage/20 text-forest',
  working: 'bg-[var(--ws-accent-soft,#e9f0ec)] text-[var(--ws-accent,#375b4b)]',
  // A report stored before task states were recorded: all it knows is "not done".
  in_progress:
    'bg-[var(--ws-accent-soft,#e9f0ec)] text-[var(--ws-accent,#375b4b)]',
  paused: 'bg-line/50 text-muted',
  queued: 'bg-line/50 text-muted',
  blocked: 'bg-coral/10 text-coral',
  skipped: 'bg-coral/10 text-coral',
  deleted: 'bg-line/50 text-muted',
}

const STATUS_LABEL: Record<ReportTaskStatus, string> = {
  completed: 'Completed',
  working: 'Working',
  in_progress: 'In progress',
  paused: 'Paused',
  queued: 'Queued',
  blocked: 'Blocked',
  skipped: 'Skipped',
  deleted: 'Deleted',
}

function TaskActivityRow({
  task,
  indented = false,
}: {
  task: StructuredSnapshotTaskActivity
  indented?: boolean
}) {
  const status = reportTaskStatus(task)
  return (
    <div
      className={`flex items-center justify-between gap-3 py-1.5 text-xs ${indented ? 'pl-5' : ''}`}
    >
      <span className="min-w-0 truncate text-ink">{task.title}</span>
      <span className="flex shrink-0 items-center gap-2">
        {task.progress_start !== null && task.progress_end !== null && (
          <span className="font-mono text-[10px] text-muted">
            {task.progress_start}%→{task.progress_end}%
          </span>
        )}
        <span className="font-mono text-[10px] text-muted">
          {formatHM(task.focused_seconds)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${STATUS_STYLE[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
      </span>
    </div>
  )
}

// A parent task with its subtasks indented beneath it.
function TaskList({ tasks }: { tasks: StructuredSnapshotTaskActivity[] }) {
  const taskById = new Map(tasks.map(t => [t.task_id, t]))
  const topLevel = tasks.filter(
    t => !t.parent_task_id || !taskById.has(t.parent_task_id),
  )
  return (
    <div className="divide-y divide-line/50">
      {topLevel.map(task => (
        <div key={task.task_id}>
          <TaskActivityRow task={task} />
          {tasks
            .filter(t => t.parent_task_id === task.task_id)
            .map(child => (
              <TaskActivityRow key={child.task_id} task={child} indented />
            ))}
        </div>
      ))}
    </div>
  )
}

// One person's tasks with their exact focused time -- shared workspaces only.
// (Deterministic: the exact numbers, straight from the snapshot. What they mean
// is the narrative's job.)
function MemberBreakdown({ member }: { member: StructuredSnapshotMember }) {
  return (
    <div className="rounded-xl border border-line/70 bg-paper/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-ink">{member.display_name}</p>
        <span className="font-mono text-[11px] font-semibold text-[var(--ws-accent,#375b4b)]">
          {formatHM(member.focused_seconds)}
        </span>
      </div>
      <div className="mt-2.5 border-t border-line/50">
        <TaskList tasks={member.task_activity} />
      </div>
    </div>
  )
}

// A personal workspace has one person, so there is no one to name and no
// per-person total to show: just the tasks.
function PersonalTasks({ tasks }: { tasks: StructuredSnapshotTaskActivity[] }) {
  return (
    <div className="rounded-xl border border-line/70 bg-paper/60 p-4">
      <p className="text-xs font-bold text-ink">Tasks worked on</p>
      <div className="mt-2.5 border-t border-line/50">
        <TaskList tasks={tasks} />
      </div>
    </div>
  )
}

// What changed in the workspace besides the work itself. The count of completed
// tasks is deliberately not repeated here: the headline above carries the one
// authoritative figure (distinct tasks still completed at the end), and a raw
// event count would disagree with it whenever a task was reopened.
function WorkspaceChangesSection({
  changes,
}: {
  changes: StructuredSnapshotWorkspaceChanges
}) {
  const items: string[] = []
  if (changes.tasks_created > 0)
    items.push(
      `${changes.tasks_created} task${changes.tasks_created === 1 ? '' : 's'} created`,
    )
  if (changes.tasks_skipped > 0)
    items.push(
      `${changes.tasks_skipped} task${changes.tasks_skipped === 1 ? '' : 's'} skipped`,
    )
  if (changes.tasks_deleted > 0)
    items.push(
      `${changes.tasks_deleted} task${changes.tasks_deleted === 1 ? '' : 's'} deleted`,
    )
  changes.members_joined.forEach(m => items.push(`${m.display_name} joined`))
  changes.members_removed.forEach(m => items.push(`${m.display_name} left`))
  changes.invitations.forEach(inv => {
    const statusText =
      inv.status === 'accepted'
        ? 'accepted'
        : inv.status === 'rejected'
          ? 'rejected'
          : inv.status === 'cancelled'
            ? 'cancelled'
            : 'still pending'
    items.push(
      `${inv.invited_by_name} invited ${inv.invited_email} (${statusText})`,
    )
  })

  if (items.length === 0) return null

  return (
    <div className="rounded-xl border border-line/70 bg-paper/60 p-4">
      <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
        <UserPlus size={13} /> Workspace changes
      </p>
      <ul className="mt-2.5 list-disc space-y-1 border-t border-line/50 pl-5 pt-2.5 text-xs leading-5 text-ink">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

// Every blocker that overlapped the window, rendered straight from the
// snapshot: the reason and note verbatim, who was asked to help, who resolved it
// and when. Nothing here is narrated — it is the deterministic record the
// narrative is only allowed to describe.
export function BlockersSection({
  blockers,
}: {
  blockers: StructuredSnapshotBlocker[]
}) {
  if (blockers.length === 0) return null
  return (
    <div className="rounded-xl border border-line/70 bg-paper/60 p-4">
      <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
        <OctagonAlert size={13} aria-hidden="true" /> Blockers{' '}
        <span className="font-mono text-muted">{blockers.length}</span>
      </p>
      <ul className="mt-2.5 space-y-3 border-t border-line/50 pt-2.5">
        {blockers.map(blocker => (
          <li key={blocker.blocker_id} className="text-xs leading-5">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 font-semibold text-ink">
                {blocker.parent_title
                  ? `${blocker.task_title} (under ${blocker.parent_title})`
                  : blocker.task_title}
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${blocker.still_blocked_at_report_end ? 'bg-coral/10 text-coral' : 'bg-sage/20 text-forest'}`}
              >
                {blocker.still_blocked_at_report_end
                  ? 'Still blocked'
                  : 'Resolved'}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-muted">
              {blocker.reason}
            </p>
            <p className="text-[11px] text-muted">
              Reported by {blocker.blocked_by_name} ·{' '}
              {formatTimestamp(blocker.blocked_at)}
              {blocker.mentioned.length > 0 &&
                ` · asked ${blocker.mentioned.map(m => m.display_name).join(', ')}`}
              {blocker.blocked_seconds > 0 &&
                ` · blocked ${formatHM(blocker.blocked_seconds)} in this period`}
            </p>
            {blocker.resolved_at && (
              <p className="text-[11px] text-muted">
                Resolved by {blocker.resolved_by_name ?? 'a former member'} ·{' '}
                {formatTimestamp(blocker.resolved_at)}
                {blocker.resolution_note && ` — ${blocker.resolution_note}`}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// The exact figures, straight from the backend's own snapshot -- focused time,
// distinct tasks completed, and (shared workspaces only) how many people were
// active. A personal workspace is one person's own work, so it never counts
// members: "1 member" is team language for something that is not a team.
export function ReportMetrics({
  snapshot,
  isPersonal,
}: {
  snapshot: WorkspaceStructuredSnapshot
  isPersonal: boolean
}) {
  const { focusedSeconds, tasksCompleted, activeMembers } =
    getDailyReportMetrics(snapshot)
  const figure = (value: string) => (
    <span className="font-mono text-sm font-bold text-ink">{value}</span>
  )
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted">
      <span>{figure(formatHM(focusedSeconds))} focused</span>
      {tasksCompleted > 0 && (
        <span>
          {figure(String(tasksCompleted))} task
          {tasksCompleted === 1 ? '' : 's'} completed
        </span>
      )}
      {!isPersonal && activeMembers > 0 && (
        <span>
          {figure(String(activeMembers))}{' '}
          {activeMembers === 1 ? 'member' : 'members'} active
        </span>
      )}
    </p>
  )
}

// The AI's reading of what happened, as the paragraph(s) it wrote.
function Narrative({ summary }: { summary: WorkspaceDailySummary }) {
  const sections = dailyReportNarrativeSections(summary.narrative)
  return (
    <div className="space-y-5">
      {sections.map((section, sectionIndex) => (
        <section key={`${section.kind}-${section.userId ?? sectionIndex}`}>
          <h3 className="text-sm font-bold text-ink">{section.name}</h3>
          <div className="mt-2 space-y-3">
            {section.paragraphs.map((paragraph, i) => (
              <p key={i} className="text-sm leading-6 text-ink">
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ReportDetails({
  summary,
  isPersonal,
  regeneratedByName,
}: {
  summary: WorkspaceDailySummary
  isPersonal: boolean
  regeneratedByName: string
}) {
  const snapshot = summary.structuredSnapshot
  const membersWithTasks = snapshot.members.filter(
    m => m.task_activity.length > 0,
  )
  return (
    <div className="space-y-4 border-t border-line/70 px-5 py-4">
      {isPersonal ? (
        membersWithTasks.length > 0 && (
          <PersonalTasks
            tasks={membersWithTasks.flatMap(m => m.task_activity)}
          />
        )
      ) : (
        <div className="space-y-3">
          {membersWithTasks.map(member => (
            <MemberBreakdown key={member.user_id} member={member} />
          ))}
        </div>
      )}

      <WorkspaceChangesSection changes={snapshot.workspace_changes} />
      <BlockersSection blockers={snapshot.blockers ?? []} />

      <p className="text-[10px] text-muted">
        {summary.regeneratedAt
          ? `Last regenerated by ${regeneratedByName} · ${formatTimestamp(summary.regeneratedAt)}`
          : `Automatically generated at ${formatTimestamp(summary.generatedAt)}`}
      </p>
    </div>
  )
}

// `enabled` is the workspace's Daily Reports switch. When it is off this renders
// nothing at all -- no empty card, no "no reports yet" placeholder -- while every
// report already written stays stored, ready to reappear if it is switched back on.
export function WorkspaceSummarySection({
  enabled = true,
  ready,
  error,
  summary,
  members,
  isPersonal = false,
  nextReportLabel,
  reportTimeLabel,
  generating,
  onRegenerate,
  defaultExpanded = false,
}: {
  enabled?: boolean
  ready: boolean
  error?: string | null
  summary: WorkspaceDailySummary | null
  members: WorkspaceMember[]
  isPersonal?: boolean
  nextReportLabel: string | null
  reportTimeLabel: string
  generating: boolean
  onRegenerate: () => void
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  // Arriving from Slack's "View Daily Report" button: bring the card into view
  // and open it, so the link lands on the report rather than on the top of the
  // workspace with the report somewhere below the fold.
  const reportFocus = useReportFocus()
  useEffect(() => {
    if (!reportFocus) return
    setExpanded(true)
    document
      .getElementById('workspace-daily-report')
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [reportFocus])

  if (!enabled) return null
  const hasFallbackNarrative = summary?.meta.used_fallback_template === true
  const isPending = summary?.generationStatus === 'pending'
  const isFailed =
    summary?.generationStatus === 'failed' ||
    (summary?.generationStatus === 'completed' && hasFallbackNarrative)
  const isCompleted =
    summary?.generationStatus === 'completed' && !hasFallbackNarrative
  const hasNoRecordedActivity =
    isCompleted && !hasReportActivity(summary.structuredSnapshot)

  const regeneratedByMember = summary?.regeneratedBy
    ? members.find(m => m.userId === summary.regeneratedBy)
    : null
  const regeneratedByName =
    regeneratedByMember?.fullName || regeneratedByMember?.email || 'A member'

  return (
    <div
      id="workspace-daily-report"
      className="rounded-2xl border border-line bg-panel shadow-sm"
    >
      <div className="border-b border-line/70 px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink">
          <Sparkles size={15} /> Daily Report
        </h2>
        {summary ? (
          <p className="mt-1 flex items-center gap-1 text-[11px] leading-4 text-muted">
            <Clock size={11} className="shrink-0" />
            Previous 24 hours · {formatWindow(summary)}
          </p>
        ) : (
          <p className="mt-1 text-[11px] leading-4 text-muted">
            Automatically generated every day at {reportTimeLabel}, covering
            your {isPersonal ? 'work over the' : "workspace's"} previous 24
            hours.
          </p>
        )}
      </div>

      {!ready ? (
        <div className="space-y-3 px-5 py-4">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-8 w-40" />
        </div>
      ) : !summary ? (
        <div className="px-5 py-8 text-center">
          <p className="text-xs leading-5 text-muted">
            {nextReportLabel
              ? `Next report: ${nextReportLabel}`
              : 'The Daily Report is generated automatically once there is activity to cover.'}
          </p>
        </div>
      ) : isPending ? (
        <div className="flex items-center justify-center gap-2 px-5 py-8 text-center">
          <Loader2 size={14} className="animate-spin text-muted" />
          <p className="text-xs leading-5 text-muted">
            Generating your Daily Report…
          </p>
        </div>
      ) : isFailed ? (
        <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
          <ErrorBanner>
            Daily Report couldn&apos;t be generated yet.
          </ErrorBanner>
          <Button onClick={onRegenerate} disabled={generating}>
            {generating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Retry
          </Button>
        </div>
      ) : hasNoRecordedActivity ? (
        <div className="px-5 py-8 text-center">
          <p className="text-xs leading-5 text-muted">
            {summary.narrative.overall_summary}
          </p>
        </div>
      ) : (
        <div>
          <div className="flex justify-end px-5 pt-4">
            <Button
              variant="ghost"
              onClick={onRegenerate}
              disabled={generating}
            >
              {generating ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Regenerate
            </Button>
          </div>

          {error && (
            <div className="px-5 pt-3">
              <ErrorBanner>{error}</ErrorBanner>
            </div>
          )}

          <div className="space-y-2 px-5 pb-4 pt-3">
            <Narrative summary={summary} />
          </div>

          <div className="border-t border-line/70 px-5 py-2.5">
            <button
              onClick={() => setExpanded(current => !current)}
              className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ws-accent,#375b4b)] transition hover:text-coral"
            >
              {expanded ? 'Hide details' : 'Show details'}
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </div>

          {expanded && (
            <ReportDetails
              summary={summary}
              isPersonal={isPersonal}
              regeneratedByName={regeneratedByName}
            />
          )}
        </div>
      )}
    </div>
  )
}
