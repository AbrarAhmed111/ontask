import { createSign } from 'node:crypto'
import {
  GithubDevelopmentEvent,
  normalizePullRequest,
  sameRepositoryHeadBranch,
} from '@/lib/integrations/github/events'

// Server-only access to GitHub through the OnTask GitHub App.
//
// Why an App rather than a stored personal/OAuth token: the workspace owner
// grants access to exactly the repositories they choose, GitHub delivers the
// webhooks itself, and OnTask never stores a GitHub credential. Each call mints
// a short-lived installation token from the app's private key (server env
// only) -- nothing sensitive ever reaches the browser or the database.
//
// Environment (all server-side):
//   GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY,
//   GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET

const API = 'https://api.github.com'

export class GithubConfigError extends Error {}

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function env(name: string) {
  const value = process.env[name]
  if (!value) throw new GithubConfigError(`${name} is not configured`)
  return value
}

export function githubAppConfig() {
  return {
    appId: env('GITHUB_APP_ID'),
    slug: env('GITHUB_APP_SLUG'),
    // Env files usually hold the PEM on one line with literal "\n".
    privateKey: env('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n'),
    clientId: env('GITHUB_APP_CLIENT_ID'),
    clientSecret: env('GITHUB_APP_CLIENT_SECRET'),
  }
}

// Signs the connect `state` round trip. Server-only, never sent anywhere.
export function connectStateSecret() {
  return env('GITHUB_APP_CLIENT_SECRET')
}

export function webhookSecret() {
  return env('GITHUB_WEBHOOK_SECRET')
}

// GitHub's OAuth web flow for the app: GitHub asks the user to authorize the
// OnTask app (once -- afterwards it redirects straight back) and returns to
// the callback with a one-time `code` and this `state`. This is the start of
// every connection, because it works whether or not the app is installed
// already: installing is only needed when the user can't access an
// installation yet.
export function authorizeUrl(state: string, redirectUri: string) {
  const { clientId } = githubAppConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

// Installing the app on an account ("Request user authorization (OAuth) during
// installation" is on, so GitHub returns to the callback with `code`,
// `installation_id` and `setup_action`). Only for an account that doesn't
// have the app yet: for one that does, GitHub opens the installation's
// settings page, which does not come back to OnTask.
export function installUrl(state: string) {
  return `https://github.com/apps/${encodeURIComponent(githubAppConfig().slug)}/installations/new?state=${encodeURIComponent(state)}`
}

// The app's own identity: an RS256 JWT, valid for (at most) ten minutes.
function appJwt() {
  const { appId, privateKey } = githubAppConfig()
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  })}`
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(privateKey, 'base64url')
  return `${unsigned}.${signature}`
}

async function request<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(
    path.startsWith('http') ? path : `${API}${path}`,
    {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'OnTask',
        ...init.headers,
      },
      cache: 'no-store',
    },
  )
  if (!response.ok) {
    throw new GithubApiError(
      `GitHub ${init.method ?? 'GET'} ${path} failed (${response.status})`,
      response.status,
    )
  }
  return (await response.json()) as T
}

// Installation tokens last an hour; reuse one until five minutes before then.
const tokenCache = new Map<number, { token: string; expiresAt: number }>()

async function installationToken(installationId: number) {
  const cached = tokenCache.get(installationId)
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return cached.token
  }
  const result = await request<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    appJwt(),
    { method: 'POST' },
  )
  tokenCache.set(installationId, {
    token: result.token,
    expiresAt: new Date(result.expires_at).getTime(),
  })
  return result.token
}

export type GithubRepository = {
  id: number
  fullName: string
  htmlUrl: string
  private: boolean
}

// The installation's account, and its page on GitHub -- where the owner
// changes which repositories the app may see.
export async function getInstallation(installationId: number) {
  const installation = await request<{
    account: { login?: string } | null
    html_url?: string
  }>(`/app/installations/${installationId}`, appJwt())
  return {
    account: installation.account?.login ?? null,
    manageUrl: installation.html_url ?? null,
  }
}

// The repositories the owner granted the app (first 100 -- ample for choosing
// one; the picker says so if there are more).
export async function listInstallationRepositories(installationId: number) {
  const token = await installationToken(installationId)
  const result = await request<{
    total_count: number
    repositories: {
      id: number
      full_name: string
      html_url: string
      private: boolean
    }[]
  }>('/installation/repositories?per_page=100', token)
  return {
    total: result.total_count,
    repositories: result.repositories.map((repo): GithubRepository => ({
      id: repo.id,
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      private: repo.private,
    })),
  }
}

export async function findInstallationRepository(
  installationId: number,
  repositoryId: number,
) {
  const { repositories } = await listInstallationRepositories(installationId)
  return repositories.find(repo => repo.id === repositoryId) ?? null
}

export type UserInstallation = {
  id: number
  account: string | null
}

// Which installations of THIS app the GitHub user who just authorized can
// access -- GitHub's own answer (GET /user/installations, "installations of
// your GitHub App that the authenticated user has explicit permission to
// access"). This is what proves an installation belongs to the person
// connecting it: anyone could paste another account's installation id into
// the callback URL, but only its own users see it here.
//
// `code` is the one-time OAuth code GitHub sent to the callback. Its user
// token is used for this one request and then dropped -- never stored,
// never refreshed. null when GitHub would not exchange the code (expired,
// already used, or the app's client id/secret are wrong).
export async function listUserInstallations(
  code: string,
): Promise<UserInstallation[] | null> {
  const { clientId, clientSecret } = githubAppConfig()
  const exchange = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
    cache: 'no-store',
  })
  const body = (await exchange.json().catch(() => null)) as {
    access_token?: string
  } | null
  if (!exchange.ok || !body?.access_token) return null

  const found: UserInstallation[] = []
  for (let page = 1; page <= 5; page++) {
    const result = await request<{
      installations: { id: number; account: { login?: string } | null }[]
    }>(`/user/installations?per_page=100&page=${page}`, body.access_token)
    for (const item of result.installations) {
      found.push({ id: item.id, account: item.account?.login ?? null })
    }
    if (result.installations.length < 100) break
  }
  return found
}

// ── reconciliation ─────────────────────────────────────────────────────────
// What GitHub says about one Development Task right now, as the same events a
// webhook would have delivered -- so a missed delivery is caught up through
// the same database function.
//
// Only GitHub's definite answers become events. A deleted branch is reported
// only when GitHub answers 404 for the branch AND 200 for the repository; a
// repository the installation can no longer see (404 for the repository
// itself) is reported the way GitHub's own webhook would, as
// 'repositories_removed'. Anything else -- a 5xx, a rate limit, a network
// error, a token that can't be minted -- throws, so the caller changes nothing
// and the next check tries again.

const isNotFound = (error: unknown) =>
  error instanceof GithubApiError && error.status === 404

async function repositoryReachable(repo: string, token: string) {
  try {
    await request<unknown>(`/repos/${repo}`, token)
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

export async function reconcileEvents(input: {
  installationId: number
  repositoryId: number
  repositoryFullName: string
  branchName: string
  // Whether OnTask has seen the branch before: a branch that was never seen
  // and isn't there is simply not created yet.
  branchDetected: boolean
  // The PR already linked to the task, if any.
  prNumber: number | null
  prState: 'open' | 'closed' | 'merged' | null
}): Promise<GithubDevelopmentEvent[]> {
  // Merged is final: nothing GitHub says now (a deleted branch, least of all)
  // changes a Completed task.
  if (input.prState === 'merged') return []

  const token = await installationToken(input.installationId)
  const currentRepository = await findInstallationRepository(
    input.installationId,
    input.repositoryId,
  )
  if (!currentRepository) {
    return [
      {
        kind: 'repositories_removed',
        installation_id: input.installationId,
        repository_ids: [input.repositoryId],
      },
    ]
  }
  const repo = currentRepository.fullName
  const base = {
    installation_id: input.installationId,
    repository_id: input.repositoryId,
  }
  const repositoryMetadata: GithubDevelopmentEvent = {
    kind: 'repository_metadata',
    ...base,
    repository_full_name: currentRepository.fullName,
    repository_url: currentRepository.htmlUrl,
  }
  const repositoryGone: GithubDevelopmentEvent[] = [
    {
      kind: 'repositories_removed',
      installation_id: input.installationId,
      repository_ids: [input.repositoryId],
    },
  ]
  const events: GithubDevelopmentEvent[] = []

  // A linked PR that is still open is refreshed by number. Otherwise look for
  // PRs from the branch (a first PR, or a new one after a closed one).
  const candidates: unknown[] = []
  try {
    if (input.prNumber !== null && input.prState === 'open') {
      candidates.push(
        await request<unknown>(`/repos/${repo}/pulls/${input.prNumber}`, token),
      )
    } else {
      const owner = repo.split('/')[0]
      const list = await request<unknown[]>(
        `/repos/${repo}/pulls?state=all&per_page=10&sort=created&direction=desc&head=${encodeURIComponent(`${owner}:${input.branchName}`)}`,
        token,
      )
      // An open PR is the one in progress; else the newest.
      const open = list.find(
        pr => (pr as { state?: string } | null)?.state === 'open',
      )
      if (open ?? list[0]) candidates.push(open ?? list[0])
    }
  } catch (error) {
    if (isNotFound(error) && !(await repositoryReachable(repo, token))) {
      return repositoryGone
    }
    throw error
  }

  for (const pr of candidates) {
    const branch = sameRepositoryHeadBranch(pr, input.repositoryId)
    const pullRequest = normalizePullRequest(pr)
    if (branch === input.branchName && pullRequest) {
      events.push({
        kind: 'pull_request',
        ...base,
        branch,
        pull_request: pullRequest,
      })
    }
  }

  // A PR (open, or closed and already Needs Attention) decides the stage; the
  // branch only matters without one.
  if (events.length === 0) {
    try {
      await request<unknown>(
        `/repos/${repo}/git/ref/heads/${input.branchName}`,
        token,
      )
      events.push({ kind: 'branch', ...base, branch: input.branchName })
    } catch (error) {
      if (!isNotFound(error)) throw error
      // Not there. Never seen: not created yet ("waiting"), not an error.
      // Seen before: deleted -- if the repository itself still answers.
      if (input.branchDetected) {
        if (!(await repositoryReachable(repo, token))) return repositoryGone
        events.push({
          kind: 'branch_deleted',
          ...base,
          branch: input.branchName,
        })
      }
    }
  }

  return [
    ...(currentRepository.fullName !== input.repositoryFullName
      ? [repositoryMetadata]
      : []),
    ...events,
  ]
}
