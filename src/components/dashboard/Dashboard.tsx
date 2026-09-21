'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CirclePlus, LogIn, Pause, Play, Plus, Target } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { DailyProgress } from '@/components/dashboard/DailyProgress'
import { FirstTaskPrompt } from '@/components/dashboard/FirstTaskPrompt'
import { TaskList } from '@/components/dashboard/TaskList'
import { useTasks } from '@/hooks/useTasks'
import { useCompletionAlert } from '@/hooks/useCompletionAlert'
import { Task, TaskFormValues } from '@/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { TaskForm } from '@/components/tasks/TaskForm'
import { ProgressLabelModal } from '@/components/tasks/ProgressLabelModal'
import { CompletionModal } from '@/components/tasks/CompletionModal'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { DeleteParentModal } from '@/components/tasks/DeleteParentModal'
import { AuthModal, AuthStep } from '@/components/auth/AuthModal'
import { VisitorWelcomeModal } from '@/components/auth/VisitorWelcomeModal'
import { GoogleOneTap } from '@/components/auth/GoogleOneTap'
import { useSettings } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'
import { clearStoredData } from '@/lib/storage'
import { requestNotificationPermission } from '@/lib/notifications'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { clientSignout } from '@/lib/auth/signout'
import { resolvePostLoginDestination } from '@/lib/auth/postLogin'
import { useVisitorWelcome } from '@/hooks/useVisitorWelcome'

const WORKSPACES_LOGIN_PROMPT =
  'Log in to open your Personal Workspace and your shared workspaces.'

const emptyForm: TaskFormValues = {
  name: '',
  hours: '0',
  minutes: '0',
  goal: '',
  progress: '0',
  trackGoal: true,
}

type Confirmation =
  | { type: 'delete'; taskId: string }
  | { type: 'reset' }
  | { type: 'delete-parent'; task: Task; childCount: number }

// The guest experience at `/`. Signed-in users never stay here: the
// middleware sends them straight to their Personal Workspace, and anyone who
// signs in while on this page is redirected (see the effect below) — so this
// component only ever renders the local-first, no-account dashboard.
export function Dashboard() {
  const router = useRouter()
  const { settings, ready: settingsReady, updateSettings } = useSettings()
  const {
    user,
    ready: authReady,
    passwordRecovery,
    clearPasswordRecovery,
  } = useAuth()
  const visitorWelcome = useVisitorWelcome({ authReady, user })
  const completionAlert = useCompletionAlert<Task>(settings.soundEnabled)
  const {
    tasks,
    ready,
    activeTask,
    totalSeconds,
    updateTask,
    startTask,
    pauseTask,
    finishTask,
    addTask,
    deleteTask,
    restartTask,
    moveTask,
    reorderTasks,
    getLiveSeconds: liveSeconds,
  } = useTasks(settings, completionAlert.notify)
  const [modal, setModal] = useState<'add' | 'edit' | 'goal' | 'auth' | null>(
    null,
  )
  const [authStep, setAuthStep] = useState<AuthStep>('login')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingParentId, setPendingParentId] = useState<string | null>(null)
  const [form, setForm] = useState<TaskFormValues>(emptyForm)
  const [progressPercentageInput, setProgressPercentageInput] = useState('0')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [inviteContext, setInviteContext] = useState<{
    id: string
    workspaceName: string
    invitedEmail: string | null
  } | null>(null)
  const [authSubtitle, setAuthSubtitle] = useState<string | undefined>()
  // The invitation the visitor arrived through, kept in a ref as well as
  // state: the sign-in redirect below runs when `user` changes, which can be
  // a render before or after closeModal() clears the state copy.
  const inviteRef = useRef<typeof inviteContext>(null)
  const redirectingRef = useRef(false)
  // True from the moment Supabase reports a password-recovery link until its
  // "choose a new password" dialog is closed. A ref (not just the state
  // below) because the recovery event can land AFTER the session itself has
  // already triggered the redirect lookup — the lookup checks this again
  // when it finishes.
  const resetActiveRef = useRef(false)
  const resetFlowActive = modal === 'auth' && authStep === 'reset'

  const openAuth = (step: AuthStep = 'login', subtitle?: string) => {
    setAuthStep(step)
    setAuthSubtitle(subtitle)
    setModal('auth')
  }

  // A workspace invitation link lands here as /?invite=&workspace=&email=
  // (guests bounced off /workspaces by the middleware keep these params too).
  // A guest gets a contextual login/signup prompt instead of the generic one;
  // a signed-in visitor never reaches this branch — see the redirect below.
  useEffect(() => {
    if (!authReady || user) return
    const params = new URLSearchParams(window.location.search)
    const invite = params.get('invite')
    if (!invite) return
    window.history.replaceState(null, '', window.location.pathname)
    const context = {
      id: invite,
      workspaceName: params.get('workspace') || 'the workspace',
      invitedEmail: params.get('email'),
    }
    inviteRef.current = context
    setInviteContext(context)
    openAuth('login')
  }, [authReady, user])

  // A guest bounced off /workspaces by the middleware lands here as
  // /?authIntent=workspaces — show a contextual sign-in prompt instead of the
  // bare landing page. Skipped when an invitation link is also present, since
  // that flow's own copy (above) already covers it.
  useEffect(() => {
    if (!authReady || user) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('invite') || params.get('authIntent') !== 'workspaces')
      return
    window.history.replaceState(null, '', window.location.pathname)
    openAuth('login', WORKSPACES_LOGIN_PROMPT)
  }, [authReady, user])

  useEffect(() => {
    if (!passwordRecovery) return
    resetActiveRef.current = true
    openAuth('reset')
    clearPasswordRecovery()
  }, [passwordRecovery, clearPasswordRecovery])

  // Once someone is signed in this page is no longer theirs: send them where
  // they belong. An invitation they arrived through always wins (it must be
  // answered on /workspaces); otherwise the database decides — first login
  // without invitations opens the Personal Workspace (with its welcome),
  // everyone else lands on their /workspaces hub. Held back while a password
  // reset is still in progress (a recovery link signs the user in first).
  useEffect(() => {
    if (
      !authReady ||
      !user ||
      passwordRecovery ||
      resetFlowActive ||
      redirectingRef.current
    )
      return
    redirectingRef.current = true

    const params = new URLSearchParams(window.location.search)
    const invite = inviteRef.current
    const inviteId = params.get('invite') ?? invite?.id
    if (inviteId) {
      const next = new URLSearchParams({ invite: inviteId })
      const workspaceName = params.get('workspace') ?? invite?.workspaceName
      const invitedEmail = params.get('email') ?? invite?.invitedEmail
      if (workspaceName) next.set('workspace', workspaceName)
      if (invitedEmail) next.set('email', invitedEmail)
      router.replace(`/workspaces?${next.toString()}`)
      return
    }
    void resolvePostLoginDestination().then(destination => {
      if (resetActiveRef.current) {
        // A password reset began while this lookup was in flight. Stay put;
        // this effect runs again once the reset dialog closes.
        redirectingRef.current = false
        return
      }
      router.replace(destination)
    })
  }, [authReady, user, passwordRecovery, resetFlowActive, router])

  const handleAuthenticated = () => {
    // Routing happens in the redirect effect above, which reacts to the
    // session that was just established.
    closeModal()
  }

  const handleOpenWorkspaces = () => openAuth('login', WORKSPACES_LOGIN_PROMPT)

  const handleLogout = async () => {
    const result = await clientSignout()
    if (result.success) showSuccessToast("You're signed out.")
    else showErrorToast('Sign out failed.')
  }

  const closeModal = () => {
    resetActiveRef.current = false
    setModal(null)
    setEditingId(null)
    setPendingParentId(null)
    setInviteContext(null)
    setAuthSubtitle(undefined)
  }
  const openAdd = () => {
    setForm({ ...emptyForm })
    setPendingParentId(null)
    setModal('add')
  }
  const openAddSubtask = (parentId: string) => {
    setForm({ ...emptyForm })
    setPendingParentId(parentId)
    setModal('add')
  }
  const openEdit = (task: Task) => {
    setEditingId(task.id)
    setForm({
      name: task.name,
      hours: String(Math.floor(task.plannedMinutes / 60)),
      minutes: String(task.plannedMinutes % 60),
      goal: task.progressLabel || '',
      progress: String(task.progressPercentage || 0),
      trackGoal: Boolean(task.progressLabel),
    })
    setModal('edit')
  }
  const openGoal = (task: Task) => {
    setEditingId(task.id)
    setProgressPercentageInput(String(task.progressPercentage || 0))
    setModal('goal')
  }

  const handleAdd = async (event: FormEvent) => {
    if (addTask(event, form, pendingParentId)) {
      const wasSubtask = Boolean(pendingParentId)
      closeModal()
      showSuccessToast(
        wasSubtask ? 'Subtask added.' : 'Task added to your day.',
      )
      const permission = await requestNotificationPermission()
      if (permission === 'denied') {
        showErrorToast(
          'Browser notifications are blocked; enable them in site settings.',
        )
      }
    }
  }
  const handleEdit = (event: FormEvent) => {
    event.preventDefault()
    if (!editingId) return
    const plannedMinutes =
      Number(form.hours || 0) * 60 + Number(form.minutes || 0)
    if (!form.name.trim() || plannedMinutes < 0) return
    updateTask(editingId, {
      name: form.name.trim(),
      plannedMinutes,
      progressLabel: form.trackGoal ? form.goal.trim() || undefined : undefined,
      progressPercentage: form.trackGoal
        ? Math.min(100, Math.max(0, Number(form.progress) || 0))
        : undefined,
    })
    closeModal()
    showSuccessToast('Task updated.')
  }
  const handleGoal = (event: FormEvent) => {
    event.preventDefault()
    if (editingId)
      updateTask(editingId, {
        progressPercentage: Math.min(
          100,
          Math.max(0, Number(progressPercentageInput) || 0),
        ),
      })
    closeModal()
    showSuccessToast('Goal progress updated.')
  }
  const handleFinish = (task: Task) => {
    finishTask(task)
    showSuccessToast(`${task.name} finished for today.`)
  }
  const handleDelete = (id: string) => {
    setConfirmation({ type: 'delete', taskId: id })
  }
  const handleDeleteParent = (task: Task) => {
    const childCount = tasks.filter(t => t.parentTaskId === task.id).length
    setConfirmation({ type: 'delete-parent', task, childCount })
  }
  const handleMoveTo = (taskId: string, parentId: string | null) => {
    moveTask(taskId, parentId)
    showSuccessToast(
      parentId ? 'Task moved under its new parent.' : 'Task made standalone.',
    )
  }
  const handleReset = () => {
    setConfirmation({ type: 'reset' })
  }
  const closeConfirmation = () => setConfirmation(null)
  const confirmAction = () => {
    if (!confirmation) return

    if (confirmation.type === 'delete') {
      deleteTask(confirmation.taskId)
      showSuccessToast('Task removed from today.')
      closeConfirmation()
      return
    }

    if (confirmation.type === 'delete-parent') return

    clearStoredData()
    window.location.reload()
  }
  const confirmDeleteParentAndChildren = () => {
    if (confirmation?.type !== 'delete-parent') return
    tasks
      .filter(task => task.parentTaskId === confirmation.task.id)
      .forEach(child => deleteTask(child.id))
    deleteTask(confirmation.task.id)
    showSuccessToast(`${confirmation.task.name} and its subtasks were removed.`)
    closeConfirmation()
  }
  const confirmOrphanChildren = () => {
    if (confirmation?.type !== 'delete-parent') return
    tasks
      .filter(task => task.parentTaskId === confirmation.task.id)
      .forEach(child => moveTask(child.id, null))
    deleteTask(confirmation.task.id)
    showSuccessToast(
      `${confirmation.task.name} removed — its subtasks are now standalone.`,
    )
    closeConfirmation()
  }

  // Also blank while a signed-in user is being redirected away, so the guest
  // page never flashes for someone who's already logged in. The one exception
  // is the password-reset dialog: a recovery link signs the user in first, and
  // the dialog lives on this page, so it must stay rendered until it closes.
  if (!authReady || !ready || !settingsReady || (user && !resetFlowActive))
    return <main className="min-h-screen bg-paper" />

  const completedTasks = tasks.filter(
    task => task.status === 'completed' || task.status === 'skipped',
  ).length
  // Parents are containers, not runnable — never offer to auto-start one.
  const nextTask = tasks.find(
    task =>
      (task.status === 'pending' || task.status === 'paused') &&
      !tasks.some(t => t.parentTaskId === task.id),
  )
  return (
    <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_80%_0%,#e4f0e6_0,transparent_30%),linear-gradient(135deg,#f8faf7_0%,#eff3ee_100%)] text-ink">
      <Header
        onSettings={() => setSettingsOpen(true)}
        user={user}
        authReady={authReady}
        onOpenAuth={() => openAuth('login')}
        onOpenWorkspaces={handleOpenWorkspaces}
        onLogout={handleLogout}
      />
      <div className="mx-auto w-[min(1120px,calc(100%-32px))]">
        <section className="grid gap-9 py-12 sm:py-16 lg:grid-cols-[0.85fr_1.15fr] lg:items-end lg:gap-16">
          <div>
            <p className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-coral">
              <Target size={14} /> Today&apos;s focus
            </p>
            <h1 className="max-w-md text-4xl font-bold leading-[1.05] tracking-[-0.055em] text-ink sm:text-5xl">
              Make the hours <span className="text-forest">count.</span>
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-7 text-muted">
              A clear plan for meaningful work. One task at a time, with the
              bigger picture always in sight.
            </p>
          </div>
          <DailyProgress
            totalSeconds={totalSeconds}
            completedTasks={completedTasks}
            taskCount={tasks.length}
            targetMinutes={settings.dailyTargetMinutes}
          />
        </section>
        <section className="pb-12">
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-coral">
                Your workday
              </p>
              <h2 className="text-2xl font-bold tracking-tight">
                Today&apos;s work{' '}
                <span className="font-mono text-sm font-normal text-muted">
                  {tasks.length}
                </span>
              </h2>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={openAdd}>
                <CirclePlus size={16} /> Add task
              </Button>
              <Button
                onClick={() =>
                  activeTask
                    ? pauseTask(activeTask)
                    : nextTask && startTask(nextTask.id)
                }
                disabled={tasks.length === 0}
              >
                {activeTask ? (
                  <>
                    <Pause size={15} /> Pause focus
                  </>
                ) : (
                  <>
                    <Play size={15} /> Start next
                  </>
                )}
              </Button>
            </div>
          </div>
          {tasks.length === 0 ? (
            <FirstTaskPrompt onAdd={openAdd} />
          ) : (
            <TaskList
              tasks={tasks}
              getWorkedSeconds={liveSeconds}
              onStart={startTask}
              onPause={pauseTask}
              onFinish={handleFinish}
              onEdit={openEdit}
              onDelete={handleDelete}
              onRestart={task => {
                restartTask(task)
                showSuccessToast(`${task.name} restarted as a new task.`)
              }}
              onUpdateGoal={openGoal}
              onReorder={reorderTasks}
              onAddSubtask={openAddSubtask}
              onDeleteParent={handleDeleteParent}
              onMoveTo={handleMoveTo}
            />
          )}
          {tasks.length > 0 && (
            <div className="flex justify-center pt-6">
              <button
                onClick={openAdd}
                className="inline-flex items-center gap-2 rounded-lg border border-dashed border-sage/70 px-4 py-2.5 text-xs font-semibold text-muted transition hover:border-forest hover:text-forest"
              >
                <Plus size={17} /> Add another task
              </button>
            </div>
          )}
        </section>
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-sage/40 bg-sage/10 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <p className="text-xs font-bold text-forest">
              Want to keep your progress?
            </p>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted">
              Log in to get your own Personal Workspace where you can save your
              work, track goals and progress, access your history, use
              AI-powered features, Slack integration, and more.
            </p>
          </div>
          <Button
            className="shrink-0 self-start sm:self-auto"
            onClick={() => openAuth('login')}
          >
            <LogIn size={15} /> Log in
          </Button>
        </div>
        <div className="mb-10 rounded-2xl border border-[#e5dbc8] bg-[#f4ecdf] p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/70 text-[#ae714d]">
              <Target size={16} />
            </div>
            <div>
              <p className="text-xs font-bold text-[#795f4b]">
                When you pause, your time pauses too.
              </p>
              <p className="mt-1 text-[11px] leading-5 text-[#947f6c]">
                Breaks are part of the plan. Return when you&apos;re ready.
              </p>
            </div>
          </div>
        </div>
      </div>
      <Footer />
      {modal === 'add' && (
        <Modal
          eyebrow={pendingParentId ? 'New subtask' : 'New focus'}
          title={pendingParentId ? 'Add a subtask' : 'Add a task to your day'}
          onClose={closeModal}
          fill
        >
          <TaskForm
            values={form}
            setValues={setForm}
            submitLabel={pendingParentId ? 'Add subtask' : 'Add task'}
            onSubmit={handleAdd}
            onCancel={closeModal}
          />
        </Modal>
      )}
      {modal === 'edit' && (
        <Modal
          eyebrow="Edit task"
          title="Refine today's task"
          onClose={closeModal}
          fill
        >
          <TaskForm
            values={form}
            setValues={setForm}
            submitLabel="Save changes"
            onSubmit={handleEdit}
            onCancel={closeModal}
          />
        </Modal>
      )}
      {modal === 'goal' && (
        <ProgressLabelModal
          progress={progressPercentageInput}
          setProgress={setProgressPercentageInput}
          onSave={handleGoal}
          onClose={closeModal}
        />
      )}
      {modal === 'auth' && (
        <AuthModal
          initialStep={authStep}
          inviteId={inviteContext?.id}
          inviteWorkspaceName={inviteContext?.workspaceName}
          prefillEmail={inviteContext?.invitedEmail ?? undefined}
          subtitle={authSubtitle}
          onClose={closeModal}
          onAuthenticated={handleAuthenticated}
        />
      )}
      {visitorWelcome.open && !user && (
        <VisitorWelcomeModal
          onContinue={visitorWelcome.close}
          onLogin={() => {
            visitorWelcome.close()
            openAuth('login')
          }}
        />
      )}
      {authReady && !user && (
        <GoogleOneTap
          enabled={modal !== 'auth' && !visitorWelcome.open}
          onSignedIn={handleAuthenticated}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onSave={updateSettings}
          onReset={handleReset}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {completionAlert.task && (
        <CompletionModal
          taskName={completionAlert.task.name}
          onStop={completionAlert.dismiss}
        />
      )}
      {confirmation?.type === 'delete' && (
        <ConfirmModal
          title="Remove this task?"
          message="This will remove the task and its recorded time from today."
          confirmLabel="Remove task"
          onConfirm={confirmAction}
          onClose={closeConfirmation}
        />
      )}
      {confirmation?.type === 'reset' && (
        <ConfirmModal
          title="Clear local data?"
          message="This will permanently remove today's tasks and reset all OnTask settings from this browser."
          confirmLabel="Clear local data"
          onConfirm={confirmAction}
          onClose={closeConfirmation}
        />
      )}
      {confirmation?.type === 'delete-parent' && (
        <DeleteParentModal
          taskName={confirmation.task.name}
          childCount={confirmation.childCount}
          onDeleteAll={confirmDeleteParentAndChildren}
          onOrphan={confirmOrphanChildren}
          onClose={closeConfirmation}
        />
      )}
    </main>
  )
}
