'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, CirclePlus, GitBranch, PlugZap } from 'lucide-react'
import githubIcon from '@/assets/img/github-icon.png'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { useWorkspaceDetail } from '@/components/workspaces/WorkspaceDetailContext'
import { useTour } from '@/components/tour/TourProvider'
import { DevelopmentBoard } from '@/components/development/DevelopmentBoard'
import { DevelopmentTourDemo } from '@/components/development/DevelopmentTourDemo'
import { DevelopmentTaskForm } from '@/components/development/DevelopmentTaskForm'
import { DevelopmentTaskCreated } from '@/components/development/DevelopmentTaskCreated'
import { DevelopmentTaskDetail } from '@/components/development/DevelopmentTaskDetail'
import { useDevelopmentData } from '@/components/development/DevelopmentDataContext'
import {
  CONNECTION_STATUS_MESSAGES,
  DEVELOPMENT_STAGES,
  isTracking,
} from '@/lib/development/tracking'
import { TOURS } from '@/lib/tour/definitions'
import { tourAnchor } from '@/lib/tourAnchors'
import type { Goal, GithubConnection } from '@/types/workspace'

// A beat between the sample board appearing and the tour opening over it, the
// same pause the workspace tour takes (hooks/useWorkspaceTour).
const TOUR_SETTLE_MS = 600

// The Development tour is requested from Settings > Guidance. While it is
// requested or running, the section shows sample data instead of the board
// (whether or not the module is on), and it starts the tour once that sample
// is on screen -- a step is only kept if its target is.
function useDevelopmentTour(available: boolean) {
  const { run, canStart, start, replayRequest, clearReplayRequest } = useTour()
  const requested = replayRequest === 'development'

  useEffect(() => {
    if (!requested || !available || !canStart) return
    const timer = window.setTimeout(() => {
      clearReplayRequest()
      start(TOURS.development)
    }, TOUR_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [requested, available, canStart, clearReplayRequest, start])

  return available && (requested || run?.tourId === 'development')
}

function GithubLogo({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <Image
      src={githubIcon}
      alt=""
      width={16}
      height={16}
      className={className}
    />
  )
}

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
          <GithubLogo /> {connection ? 'Open settings' : 'Connect GitHub'}
        </Link>
      )}
    </div>
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
  const { enabled, development, github } = useDevelopmentData()
  const demo = useDevelopmentTour(
    Boolean(workspace) && !isPersonal && workspaceReady,
  )
  const [creating, setCreating] = useState(false)
  // Set once the task exists: the dialog then shows its branch to copy.
  const [created, setCreated] = useState<{
    taskId: string
    title: string
    branchName: string
  } | null>(null)
  const closeCreate = useCallback(() => {
    setCreating(false)
    setCreated(null)
  }, [])
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  // Whether the open task came from a link (?devtask=), which may point at a
  // task that no longer exists -- unlike one just created, which is simply not
  // in the list yet.
  const [openedFromLink, setOpenedFromLink] = useState(false)
  const openFromLink = useCallback((taskId: string) => {
    setOpenedFromLink(true)
    setOpenTaskId(taskId)
  }, [])

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

  if (!workspace || (!enabled && !demo)) return null

  const settingsHref = `/workspaces/${workspace.slug}/settings`
  const total = development.items.length

  return (
    <div>
      <Suspense fallback={null}>
        <DevTaskFromUrl onOpen={openFromLink} />
      </Suspense>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div {...tourAnchor('dev-overview')}>
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink">
            <GitBranch size={15} className="text-[var(--ws-accent,#375b4b)]" />
            Development
          </h2>
          <p className="mt-0.5 text-[11px] text-muted">
            Work in GitHub as usual — OnTask follows each task&apos;s branch and
            Pull Request.
          </p>
        </div>
        <span className="inline-flex" {...tourAnchor('dev-new-task')}>
          <Button onClick={() => setCreating(true)} disabled={demo}>
            <CirclePlus size={15} /> New Development Task
          </Button>
        </span>
      </div>

      {demo ? (
        <DevelopmentTourDemo />
      ) : (
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
            <DevelopmentBoard
              items={development.items}
              goals={goals}
              members={members}
              connection={github.connection}
              onOpen={setOpenTaskId}
            />
          )}
        </div>
      )}

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
              branchHolders={development.items
                .filter(item => item.development.branchReleasedAt === null)
                .map(item => ({
                  branchName: item.development.branchName,
                  taskId: item.task.id,
                  title: item.task.name,
                  finished:
                    item.task.status === 'completed' ||
                    item.task.status === 'skipped',
                }))}
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
          onDelete={() => development.deleteTask(openItem.task.id)}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  )
}
