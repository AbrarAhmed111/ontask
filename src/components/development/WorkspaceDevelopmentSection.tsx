'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  CheckCircle2,
  CirclePlus,
  GitBranch,
  GitPullRequest,
  Github,
  PlugZap,
  Target,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { useWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import {
  PriorityBadge,
  StageDot,
  WorkTypeIcon,
} from '@/components/development/DevelopmentBadges'
import { DevelopmentTaskForm } from '@/components/development/DevelopmentTaskForm'
import { DevelopmentTaskCreated } from '@/components/development/DevelopmentTaskCreated'
import { DevelopmentTaskDetail } from '@/components/development/DevelopmentTaskDetail'
import { useDevelopmentTasks } from '@/hooks/useDevelopmentTasks'
import { useWorkspaceGithub } from '@/hooks/useWorkspaceGithub'
import {
  CONNECTION_STATUS_MESSAGES,
  DEVELOPMENT_STAGES,
  DevelopmentStage,
  STAGE_LABELS,
  developmentStage,
  isTracking,
  priorityRank,
  workTypeInfo,
} from '@/lib/development/tracking'
import type {
  Goal,
  GithubConnection,
  TaskDevelopment,
  WorkspaceMember,
  WorkspaceTask,
} from '@/types/workspace'

type Item = { task: WorkspaceTask; development: TaskDevelopment }

// `?devtask=<id>` (a development notification's link) opens that task, once;
// the parameter is then dropped so the URL reads cleanly. Kept in its own
// component so `useSearchParams` sits inside its own Suspense boundary.
function DevTaskFromUrl({ onOpen }: { onOpen: (taskId: string) => void }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const taskId = params.get('devtask')

  useEffect(() => {
    if (!taskId) return
    onOpen(taskId)
    const next = new URLSearchParams(params.toString())
    next.delete('devtask')
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [taskId, onOpen, params, pathname, router])

  return null
}

function ConnectionNotice({
  connection,
  isOwner,
  settingsHref,
}: {
  connection: GithubConnection | null
  isOwner: boolean
  settingsHref: string
}) {
  if (isTracking(connection)) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted">
        <CheckCircle2 size={12} className="text-emerald-600" />
        Tracking{' '}
        <span className="font-semibold text-ink">
          {connection?.repositoryFullName}
        </span>
      </p>
    )
  }
  const message = connection
    ? CONNECTION_STATUS_MESSAGES[connection.status]
    : 'Connect a GitHub repository so OnTask can follow each task’s branch and Pull Request.'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white/70 px-4 py-3">
      <p className="flex items-start gap-2 text-xs leading-5 text-muted">
        <PlugZap size={15} className="mt-0.5 shrink-0 text-amber-600" />
        <span>
          {message}{' '}
          {!isOwner && 'Ask the workspace owner to set it up in Settings.'}
        </span>
      </p>
      {isOwner && (
        <Link
          href={settingsHref}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ws-accent-soft,#e9f0ec)] px-3 py-2 text-[11px] font-semibold text-[var(--ws-accent,#375b4b)] transition hover:opacity-80"
        >
          <Github size={13} /> {connection ? 'Open settings' : 'Connect GitHub'}
        </Link>
      )}
    </div>
  )
}

function TaskRow({
  item,
  goal,
  assignee,
  onOpen,
}: {
  item: Item
  goal: Goal | undefined
  assignee: WorkspaceMember | undefined
  onOpen: () => void
}) {
  const { task, development } = item
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--ws-accent,#375b4b)]"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-start gap-1.5 text-xs font-bold leading-5 text-ink">
          <span
            className="mt-[3px]"
            title={workTypeInfo(development.workType).label}
          >
            <WorkTypeIcon type={development.workType} size={12} />
          </span>
          <span className="min-w-0">{task.name}</span>
        </p>
        {assignee && (
          <Avatar
            person={assignee}
            title={assignee.fullName || assignee.email || 'Member'}
            className="h-5 w-5 shrink-0 text-[8px]"
          />
        )}
      </div>
      {goal && (
        <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted">
          <Target size={10} className="shrink-0" /> {goal.name}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex min-w-0 items-center gap-1 font-mono text-[10px] text-muted">
          {development.prNumber !== null ? (
            <>
              <GitPullRequest size={10} className="shrink-0" />#
              {development.prNumber}
            </>
          ) : (
            <>
              <GitBranch size={10} className="shrink-0" />
              <span className="truncate">{development.branchName}</span>
            </>
          )}
        </span>
        <span className="ml-auto">
          <PriorityBadge priority={task.priority} />
        </span>
      </div>
    </button>
  )
}

// The Overview's Development section, right after Goals: every Development
// Task by stage (Queued -> In Development -> In Review -> Completed), one
// compact row each; who, which Goal, the branch and the PR are one click away.
// Only there while the workspace has the Development module on -- off, it
// renders nothing and loads nothing (its tasks are kept).
export function WorkspaceDevelopmentSection({ goals }: { goals: Goal[] }) {
  const {
    workspaceId,
    workspace,
    user,
    members,
    isOwner,
    isPersonal,
    ready: workspaceReady,
  } = useWorkspaceDetail()
  const enabled = Boolean(workspace?.developmentEnabled) && !isPersonal
  const development = useDevelopmentTasks(workspaceId, user, members, enabled)
  const github = useWorkspaceGithub(workspaceId, enabled)
  const [creating, setCreating] = useState(false)
  // Set once the task exists: the dialog then shows its branch to copy.
  const [created, setCreated] = useState<{
    taskId: string
    title: string
    branchName: string
  } | null>(null)
  const closeCreate = () => {
    setCreating(false)
    setCreated(null)
  }
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  // Whether the open task came from a link (?devtask=), which may point at a
  // task that no longer exists -- unlike one just created, which is simply not
  // in the list yet.
  const [openedFromLink, setOpenedFromLink] = useState(false)
  const openFromLink = useCallback((taskId: string) => {
    setOpenedFromLink(true)
    setOpenTaskId(taskId)
  }, [])

  const columns = useMemo(() => {
    const byStage = new Map<DevelopmentStage, Item[]>(
      DEVELOPMENT_STAGES.map(stage => [stage, []]),
    )
    for (const item of development.items) {
      byStage.get(developmentStage(item.task, item.development))!.push(item)
    }
    for (const [stage, list] of byStage) {
      list.sort((a, b) =>
        stage === 'completed'
          ? (b.task.completedAt ?? 0) - (a.task.completedAt ?? 0)
          : priorityRank(b.task.priority) - priorityRank(a.task.priority) ||
            b.development.createdAt.localeCompare(a.development.createdAt),
      )
    }
    return byStage
  }, [development.items])

  const goalsById = useMemo(
    () => new Map(goals.map(goal => [goal.id, goal])),
    [goals],
  )
  const openItem = development.items.find(item => item.task.id === openTaskId)

  // A link to a task that isn't (or is no longer) a Development Task here.
  useEffect(() => {
    if (openTaskId && openedFromLink && development.ready && !openItem) {
      setOpenTaskId(null)
    }
  }, [openTaskId, openedFromLink, development.ready, openItem])

  if (!enabled || !workspace) return null

  const settingsHref = `/workspaces/${workspace.slug}/settings`
  const total = development.items.length

  return (
    <div>
      <Suspense fallback={null}>
        <DevTaskFromUrl onOpen={openFromLink} />
      </Suspense>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink">
            <GitBranch size={15} className="text-[var(--ws-accent,#375b4b)]" />
            Development
          </h2>
          <p className="mt-0.5 text-[11px] text-muted">
            Work in GitHub as usual — OnTask follows each task&apos;s branch and
            Pull Request.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <CirclePlus size={15} /> New Development Task
        </Button>
      </div>

      <div className="space-y-4">
        {github.ready && (
          <ConnectionNotice
            connection={github.connection}
            isOwner={isOwner}
            settingsHref={settingsHref}
          />
        )}

        {development.error && <ErrorBanner>{development.error}</ErrorBanner>}

        {!workspaceReady || !development.ready ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {DEVELOPMENT_STAGES.map(stage => (
              <Skeleton key={stage} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="No Development Tasks yet"
            action={
              <Button variant="secondary" onClick={() => setCreating(true)}>
                <CirclePlus size={14} /> Create the first one
              </Button>
            }
          >
            Create a task and OnTask gives you the exact branch name to use.
            Once you create that branch, the task moves by itself — In
            Development, In Review, Completed.
          </EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {DEVELOPMENT_STAGES.map(stage => {
              const list = columns.get(stage) ?? []
              return (
                <section
                  key={stage}
                  aria-label={STAGE_LABELS[stage]}
                  className="rounded-2xl border border-line/70 bg-white/40 p-3"
                >
                  <h3 className="mb-2.5 flex items-center gap-2 px-1 text-[11px] font-bold text-ink">
                    <StageDot stage={stage} />
                    {STAGE_LABELS[stage]}
                    <span className="ml-auto font-mono text-[10px] text-muted">
                      {list.length}
                    </span>
                  </h3>
                  {list.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[10px] text-muted">
                      Nothing here
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {list.map(item => (
                        <TaskRow
                          key={item.task.id}
                          item={item}
                          goal={
                            item.task.goalId
                              ? goalsById.get(item.task.goalId)
                              : undefined
                          }
                          assignee={members.find(
                            member => member.userId === item.task.assignedTo,
                          )}
                          onOpen={() => setOpenTaskId(item.task.id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>

      {creating && user && (
        <Modal
          eyebrow="Development"
          title={created ? 'Development Task created' : 'New Development Task'}
          onClose={closeCreate}
        >
          {created ? (
            <DevelopmentTaskCreated
              title={created.title}
              branchName={created.branchName}
              onOpenTask={() => {
                const taskId = created.taskId
                closeCreate()
                setOpenedFromLink(false)
                setOpenTaskId(taskId)
              }}
              onDone={closeCreate}
            />
          ) : (
            <DevelopmentTaskForm
              members={members}
              goals={goals}
              currentUserId={user.id}
              takenBranchNames={development.items.map(
                item => item.development.branchName,
              )}
              onCreate={async input => {
                const result = await development.createDevelopmentTask(input)
                if (result.success && result.taskId && result.branchName) {
                  setCreated({
                    taskId: result.taskId,
                    title: input.title,
                    branchName: result.branchName,
                  })
                } else if (result.success) {
                  closeCreate()
                }
                return result
              }}
              onCancel={closeCreate}
            />
          )}
        </Modal>
      )}

      {openItem && (
        <DevelopmentTaskDetail
          task={openItem.task}
          development={openItem.development}
          goal={
            openItem.task.goalId
              ? (goalsById.get(openItem.task.goalId) ?? null)
              : null
          }
          members={members}
          connection={github.connection}
          onReassign={userId =>
            development.reassignTask(openItem.task.id, userId)
          }
          onPriorityChange={priority =>
            development.updateTask(openItem.task.id, { priority })
          }
          onUpdateBranchName={name =>
            development.updateBranchName(openItem.task.id, name)
          }
          onReconcile={development.reconcile}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  )
}
