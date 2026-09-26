// GitHub's webhook payloads, reduced to the few facts the Development module
// acts on. This is the shape public.apply_github_development_event() reads
// (supabase/migrations/20260926120000_development_module.sql); the webhook and
// reconciliation both produce it, so the database has one input to trust.
//
// Deliberately NOT here: commits. A push only proves the branch exists; it
// never changes a task's stage.
//
// A deleted branch ('branch_deleted') is reported as-is; whether it matters
// (no PR carrying the work, nothing merged yet) is the database's decision.

export type NormalizedPullRequest = {
  id: number
  number: number
  url: string
  title: string
  state: 'open' | 'closed'
  merged: boolean
  // The branch the PR merges into ("main"), for "PR merged into main".
  base_branch: string | null
  created_at: string | null
  closed_at: string | null
  merged_at: string | null
  updated_at: string | null
}

export type GithubDevelopmentEvent =
  | {
      kind: 'branch' | 'branch_deleted'
      installation_id: number
      repository_id: number
      branch: string
    }
  | {
      kind: 'pull_request'
      installation_id: number
      repository_id: number
      branch: string
      pull_request: NormalizedPullRequest
    }
  | {
      kind:
        | 'installation_deleted'
        | 'installation_suspended'
        | 'installation_unsuspended'
      installation_id: number
    }
  | {
      kind: 'repositories_removed' | 'repositories_added'
      installation_id: number
      repository_ids: number[]
    }

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

// PR actions that can move a task between stages, or change what it shows.
// Everything else (labels, reviewers, assignees...) is ignored.
const PULL_REQUEST_ACTIONS = new Set([
  'opened',
  'reopened',
  'closed',
  'synchronize',
  'edited',
  'ready_for_review',
  'converted_to_draft',
])

const BRANCH_REF_PREFIX = 'refs/heads/'

// A PR as the REST API (reconciliation) or a webhook describes it. `merged`
// is only true when GitHub says the PR was merged -- a closed PR is not.
export function normalizePullRequest(
  pr: unknown,
): NormalizedPullRequest | null {
  if (!isObject(pr)) return null
  const id = num(pr.id)
  const number = num(pr.number)
  const url = str(pr.html_url)
  if (id === null || number === null || !url) return null
  const mergedAt = str(pr.merged_at)
  return {
    id,
    number,
    url,
    title: str(pr.title) ?? `#${number}`,
    state: pr.state === 'closed' ? 'closed' : 'open',
    merged: pr.merged === true || mergedAt !== null,
    base_branch: isObject(pr.base) ? str(pr.base.ref) : null,
    created_at: str(pr.created_at),
    closed_at: str(pr.closed_at),
    merged_at: mergedAt,
    updated_at: str(pr.updated_at),
  }
}

// The PR's source branch -- but only when that branch lives in the connected
// repository itself. A fork's branch could share the name by coincidence.
export function sameRepositoryHeadBranch(
  pr: unknown,
  repositoryId: number,
): string | null {
  if (!isObject(pr) || !isObject(pr.head)) return null
  const headRepo = pr.head.repo
  if (!isObject(headRepo) || num(headRepo.id) !== repositoryId) return null
  return str(pr.head.ref)
}

export function normalizeGithubEvent(
  eventName: string,
  payload: unknown,
): GithubDevelopmentEvent | null {
  if (!isObject(payload)) return null
  const installationId = isObject(payload.installation)
    ? num(payload.installation.id)
    : null
  if (installationId === null) return null
  const repositoryId = isObject(payload.repository)
    ? num(payload.repository.id)
    : null

  switch (eventName) {
    case 'create': {
      if (payload.ref_type !== 'branch' || repositoryId === null) return null
      const branch = str(payload.ref)
      return branch
        ? {
            kind: 'branch',
            installation_id: installationId,
            repository_id: repositoryId,
            branch,
          }
        : null
    }

    // GitHub sends both a `delete` and a push with `deleted: true` for one
    // deleted branch; the database treats the second as the no-op it is.
    case 'delete': {
      if (payload.ref_type !== 'branch' || repositoryId === null) return null
      const branch = str(payload.ref)
      return branch
        ? {
            kind: 'branch_deleted',
            installation_id: installationId,
            repository_id: repositoryId,
            branch,
          }
        : null
    }

    case 'push': {
      const ref = str(payload.ref)
      if (!ref?.startsWith(BRANCH_REF_PREFIX) || repositoryId === null)
        return null
      return {
        kind: payload.deleted === true ? 'branch_deleted' : 'branch',
        installation_id: installationId,
        repository_id: repositoryId,
        branch: ref.slice(BRANCH_REF_PREFIX.length),
      }
    }

    case 'pull_request': {
      if (
        repositoryId === null ||
        !PULL_REQUEST_ACTIONS.has(String(payload.action))
      )
        return null
      const branch = sameRepositoryHeadBranch(
        payload.pull_request,
        repositoryId,
      )
      const pullRequest = normalizePullRequest(payload.pull_request)
      if (!branch || !pullRequest) return null
      return {
        kind: 'pull_request',
        installation_id: installationId,
        repository_id: repositoryId,
        branch,
        pull_request: pullRequest,
      }
    }

    case 'installation': {
      const kind =
        payload.action === 'deleted'
          ? 'installation_deleted'
          : payload.action === 'suspend'
            ? 'installation_suspended'
            : payload.action === 'unsuspend'
              ? 'installation_unsuspended'
              : null
      return kind ? { kind, installation_id: installationId } : null
    }

    case 'installation_repositories': {
      const removed = payload.action === 'removed'
      if (!removed && payload.action !== 'added') return null
      const list = removed
        ? payload.repositories_removed
        : payload.repositories_added
      const ids = Array.isArray(list)
        ? list
            .map(repo => (isObject(repo) ? num(repo.id) : null))
            .filter((id): id is number => id !== null)
        : []
      return {
        kind: removed ? 'repositories_removed' : 'repositories_added',
        installation_id: installationId,
        repository_ids: ids,
      }
    }

    default:
      return null
  }
}
