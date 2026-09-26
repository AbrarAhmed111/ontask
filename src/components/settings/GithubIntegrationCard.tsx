'use client'

import { ReactNode, Suspense, useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, ExternalLink, Loader2, LogOut, RefreshCw } from 'lucide-react'
import Image from 'next/image'
import githubIcon from '@/assets/img/github-icon.png'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
import { Skeleton } from '@/components/ui/Skeleton'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SelectMenu } from '@/components/ui/SelectMenu'
import {
  GithubRepositoryOption,
  useWorkspaceGithub,
} from '@/hooks/useWorkspaceGithub'
import { CONNECTION_STATUS_MESSAGES } from '@/lib/development/tracking'
import {
  InstallationChoiceOption,
  readInstallationChoice,
} from '@/lib/integrations/github/installationChoice'
import { showSuccessToast } from '@/lib/toast'

const LINK_CLASS =
  'inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ws-accent,#375b4b)] hover:underline disabled:opacity-50'
const QUIET_LINK_CLASS =
  'text-[11px] font-semibold text-muted transition hover:text-ink disabled:opacity-50'

function GithubLogo({
  className = 'h-[18px] w-[18px]',
}: {
  className?: string
}) {
  return (
    <Image
      src={githubIcon}
      alt=""
      width={18}
      height={18}
      className={className}
    />
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <div className="min-w-0 text-right text-xs font-bold text-ink">
        {children}
      </div>
    </div>
  )
}

// `?github_choose=<signed list>`: after authorizing, the callback found several
// GitHub accounts with the OnTask app that this GitHub user can access, and the
// owner picks one. Read once, then dropped from the URL. Its own component so
// `useSearchParams` sits inside its own Suspense boundary.
function InstallationChoiceFromUrl({
  onChoice,
}: {
  onChoice: (token: string, options: InstallationChoiceOption[]) => void
}) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const token = params?.get('github_choose') ?? null

  useEffect(() => {
    if (!token) return
    const options = readInstallationChoice(token)
    if (options) onChoice(token, options)
    const next = new URLSearchParams(params?.toString())
    next.delete('github_choose')
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [token, onChoice, params, pathname, router])

  return null
}

// Settings -> Development -> GitHub, for THIS workspace only (the settings page
// renders it keyed by workspace, so nothing carries over from another one).
// Every member can see which repository is tracked; only the owner connects,
// picks the GitHub account and repository, or disconnects -- the server routes
// check that again. Connecting goes through GitHub's authorize screen and, only
// if needed, installing the OnTask app; no token is ever pasted or stored.
export function GithubIntegrationCard({
  workspaceId,
  canManage,
  className = '',
}: {
  workspaceId: string
  canManage: boolean
  className?: string
}) {
  const github = useWorkspaceGithub(workspaceId, true)
  const { connection } = github
  const [repositories, setRepositories] = useState<
    GithubRepositoryOption[] | null
  >(null)
  const [totalRepositories, setTotalRepositories] = useState(0)
  // The installation's page on GitHub, where repository access is changed.
  const [manageUrl, setManageUrl] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [choice, setChoice] = useState<{
    token: string
    options: InstallationChoiceOption[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  const onChoice = useCallback(
    (token: string, options: InstallationChoiceOption[]) =>
      setChoice({ token, options }),
    [],
  )

  const loadRepositories = async () => {
    setBusy(true)
    setError(null)
    const result = await github.listRepositories()
    setBusy(false)
    if (!result.success) {
      setError(result.error)
      return
    }
    setRepositories(result.repositories)
    setTotalRepositories(result.total)
    setManageUrl(result.manageUrl)
    setSelectedId(String(result.repositories[0]?.id ?? ''))
  }

  const saveRepository = async () => {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    const result = await github.chooseRepository(Number(selectedId))
    setBusy(false)
    if (!result.success) {
      setError(result.error)
      return
    }
    setRepositories(null)
    showSuccessToast('Repository connected.')
  }

  const chooseInstallation = async (installationId: number) => {
    if (!choice) return
    setBusy(true)
    setError(null)
    const result = await github.chooseInstallation(choice.token, installationId)
    setBusy(false)
    if (!result.success) {
      setError(result.error)
      return
    }
    setChoice(null)
    setRepositories(null)
    showSuccessToast('GitHub connected.')
  }

  const disconnect = async () => {
    setConfirmingDisconnect(false)
    setBusy(true)
    const result = await github.disconnect()
    setBusy(false)
    if (!result.success) setError(result.error)
    else showSuccessToast('GitHub disconnected.')
  }

  const connected = connection?.status === 'connected'
  const needsReinstall =
    connection?.status === 'disconnected' ||
    connection?.status === 'repository_access_lost'
  const choosing =
    canManage &&
    connection !== null &&
    (repositories !== null || connection.status === 'repository_required')

  return (
    <SettingsCard
      iconNode={<GithubLogo />}
      title="GitHub"
      className={className}
      action={
        canManage &&
        connection &&
        !choice && (
          <Button
            variant="ghost"
            onClick={() => setConfirmingDisconnect(true)}
            disabled={busy}
            className="px-2.5 py-1.5"
          >
            <LogOut size={13} /> Disconnect
          </Button>
        )
      }
    >
      {canManage && (
        <Suspense fallback={null}>
          <InstallationChoiceFromUrl onChoice={onChoice} />
        </Suspense>
      )}
      {error && <ErrorBanner variant="flush">{error}</ErrorBanner>}

      {canManage && choice ? (
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs leading-5 text-muted">
            Your GitHub account can use the OnTask app on more than one account.
            Which one should this workspace track?
          </p>
          <div className="space-y-1.5">
            {choice.options.map(option => (
              <button
                key={option.id}
                type="button"
                disabled={busy}
                onClick={() => void chooseInstallation(option.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-left text-xs font-semibold text-ink transition hover:border-[var(--ws-accent,#375b4b)] disabled:opacity-50"
              >
                <GithubLogo className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {option.account ?? `Installation ${option.id}`}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href={github.installUrl} className={LINK_CLASS}>
              Install on another account
            </a>
            <button
              type="button"
              onClick={() => setChoice(null)}
              className={QUIET_LINK_CLASS}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !github.ready ? (
        <div className="space-y-3 px-5 py-4">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      ) : !connection ? (
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs leading-5 text-muted">
            Connect your GitHub repository to track Development Tasks. OnTask
            only reads branches and Pull Requests — it never creates or changes
            code.
          </p>
          {canManage ? (
            <a
              href={github.connectUrl}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--ws-accent,#375b4b)] px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              <GithubLogo className="h-4 w-4 brightness-0 invert" /> Connect
              GitHub
            </a>
          ) : (
            <p className="text-[10px] text-muted">
              Only the workspace owner can connect GitHub.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="divide-y divide-line/70">
            <Row label="Repository">
              {connection.repositoryFullName ? (
                connection.repositoryUrl ? (
                  <a
                    href={connection.repositoryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate hover:underline"
                  >
                    {connection.repositoryFullName}
                  </a>
                ) : (
                  connection.repositoryFullName
                )
              ) : (
                <span className="font-normal text-muted">Not chosen yet</span>
              )}
            </Row>
            {connection.accountLogin && (
              <Row label="GitHub account">{connection.accountLogin}</Row>
            )}
            <Row label="Status">
              {connected ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <Check size={13} /> Connected
                </span>
              ) : (
                <span className="font-semibold text-amber-700">
                  {CONNECTION_STATUS_MESSAGES[connection.status]}
                </span>
              )}
            </Row>
            {connected && (
              <Row label="Tracking">
                <span className="flex flex-col items-end gap-0.5 font-semibold">
                  {[
                    'Branches',
                    'Pull Requests',
                    'Automatic status updates',
                  ].map(item => (
                    <span
                      key={item}
                      className="inline-flex items-center gap-1 text-[11px]"
                    >
                      <Check size={12} className="text-emerald-600" />
                      {item}
                    </span>
                  ))}
                </span>
              </Row>
            )}
          </div>

          {canManage && (
            <div className="space-y-3 border-t border-line/70 px-5 py-4">
              {needsReinstall && (
                <a href={github.connectUrl} className={LINK_CLASS}>
                  <RefreshCw size={13} /> Reconnect on GitHub
                </a>
              )}
              {choosing ? (
                repositories === null ? (
                  <Button
                    variant="secondary"
                    onClick={() => void loadRepositories()}
                    disabled={busy}
                  >
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    Choose a repository
                  </Button>
                ) : repositories.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-[11px] leading-5 text-muted">
                      The OnTask app can&apos;t see any repositories on this
                      account yet. Grant it access to the repository on GitHub,
                      then come back and refresh.
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {manageUrl && (
                        <a
                          href={manageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={LINK_CLASS}
                        >
                          <ExternalLink size={12} /> Grant access on GitHub
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void loadRepositories()}
                        disabled={busy}
                        className={LINK_CLASS}
                      >
                        <RefreshCw size={12} /> Refresh
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <SelectMenu
                      label="Repository"
                      value={selectedId}
                      onChange={setSelectedId}
                      options={repositories.map(repo => ({
                        value: String(repo.id),
                        label: repo.fullName,
                        description: repo.private ? 'Private' : 'Public',
                        icon: <GithubLogo className="h-4 w-4" />,
                      }))}
                      className="min-w-0 flex-1"
                    />
                    <Button
                      onClick={() => void saveRepository()}
                      disabled={busy || !selectedId}
                    >
                      Save
                    </Button>
                    {totalRepositories > repositories.length && (
                      <p className="w-full text-[10px] text-muted">
                        Showing the first {repositories.length} of{' '}
                        {totalRepositories} repositories.
                      </p>
                    )}
                    {manageUrl && (
                      <a
                        href={manageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`${LINK_CLASS} w-full`}
                      >
                        <ExternalLink size={12} /> Missing a repository? Manage
                        access on GitHub
                      </a>
                    )}
                  </div>
                )
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button
                    type="button"
                    onClick={() => void loadRepositories()}
                    disabled={busy}
                    className={QUIET_LINK_CLASS}
                  >
                    Change repository
                  </button>
                  <a href={github.connectUrl} className={QUIET_LINK_CLASS}>
                    Use a different GitHub account
                  </a>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {confirmingDisconnect && (
        <ConfirmModal
          title="Disconnect GitHub?"
          message="OnTask will stop tracking branches and Pull Requests for this workspace. Development Tasks and what was already tracked are kept, and other workspaces keep their own GitHub connections. The OnTask app stays installed on GitHub until you remove it there."
          confirmLabel="Disconnect"
          onConfirm={() => void disconnect()}
          onClose={() => setConfirmingDisconnect(false)}
        />
      )}
    </SettingsCard>
  )
}
