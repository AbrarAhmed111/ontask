'use client'

import { ReactNode, useState } from 'react'
import { Check, Github, Loader2, LogOut, RefreshCw } from 'lucide-react'
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
import { showSuccessToast } from '@/lib/toast'

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

// Settings -> Development -> GitHub. Every member can see which repository is
// tracked; only the owner connects, chooses the repository, or disconnects
// (the server routes check that again). Connecting installs the OnTask GitHub
// App on the repositories the owner picks -- no token is ever pasted or stored.
export function GithubIntegrationCard({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const github = useWorkspaceGithub(workspaceId, true)
  const { connection } = github
  const [repositories, setRepositories] = useState<
    GithubRepositoryOption[] | null
  >(null)
  const [totalRepositories, setTotalRepositories] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

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
      icon={Github}
      title="GitHub"
      action={
        canManage &&
        connection && (
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
      {error && <ErrorBanner variant="flush">{error}</ErrorBanner>}
      {!github.ready ? (
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
              <Github size={14} /> Connect GitHub
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
                <a
                  href={github.connectUrl}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ws-accent,#375b4b)] hover:underline"
                >
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
                  <p className="text-[11px] leading-5 text-muted">
                    The OnTask app can&apos;t see any repositories yet.{' '}
                    <a
                      href={github.connectUrl}
                      className="font-semibold text-[var(--ws-accent,#375b4b)] hover:underline"
                    >
                      Grant access on GitHub
                    </a>
                    .
                  </p>
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
                        icon: <Github size={13} className="text-muted" />,
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
                  </div>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => void loadRepositories()}
                  disabled={busy}
                  className="text-[11px] font-semibold text-muted transition hover:text-ink disabled:opacity-50"
                >
                  Change repository
                </button>
              )}
            </div>
          )}
        </>
      )}

      {confirmingDisconnect && (
        <ConfirmModal
          title="Disconnect GitHub?"
          message="OnTask will stop tracking branches and Pull Requests for this workspace. Development Tasks and what was already tracked are kept. The OnTask app stays installed on GitHub until you remove it there."
          confirmLabel="Disconnect"
          onConfirm={() => void disconnect()}
          onClose={() => setConfirmingDisconnect(false)}
        />
      )}
    </SettingsCard>
  )
}
