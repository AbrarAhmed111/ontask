import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { reconcileEvents } from '@/lib/integrations/github/githubApp'

// reconcileEvents turns GitHub's CURRENT answer about one Development Task
// into the events a webhook would have sent. The rule under test: only a
// definite answer changes anything. A 5xx, a rate limit or a network error
// throws (the caller keeps the last known state and retries later) -- it is
// never read as "the branch was deleted".

type Route = { status: number; body?: unknown } | Error

const REPO = 'acme/ontask'
const RENAMED_REPO = 'acme/renamed'
const BRANCH = 'feature/google-oauth-abrar'

const pr = (overrides: Record<string, unknown> = {}) => ({
  id: 900,
  number: 142,
  html_url: `https://github.com/${REPO}/pull/142`,
  title: 'Implement Google OAuth',
  state: 'open',
  merged: false,
  created_at: '2026-09-26T09:00:00Z',
  updated_at: '2026-09-26T09:30:00Z',
  closed_at: null,
  merged_at: null,
  head: { ref: BRANCH, repo: { id: 22 } },
  base: { ref: 'main' },
  ...overrides,
})

// Every installation gets its own id, so the module's token cache never
// carries one test's token into the next.
let nextInstallation = 1000

function mockGithub(routes: Record<string, Route>) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.replace('https://api.github.com', '')
      calls.push(path)
      if (path.startsWith('/app/installations/')) {
        return new Response(
          JSON.stringify({
            token: 'installation-token',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          }),
          { status: 201 },
        )
      }
      const key = Object.keys(routes).find(prefix => path.startsWith(prefix))
      if (key) {
        const route = routes[key]
        if (route instanceof Error) throw route
        return new Response(JSON.stringify(route.body ?? {}), {
          status: route.status,
        })
      }
      if (path.startsWith('/installation/repositories')) {
        return new Response(
          JSON.stringify({
            total_count: 1,
            repositories: [
              {
                id: 22,
                full_name: REPO,
                html_url: `https://github.com/${REPO}`,
                private: false,
              },
            ],
          }),
          { status: 200 },
        )
      }
      const route: Route = { status: 500 }
      if (route instanceof Error) throw route
      return new Response(JSON.stringify(route.body ?? {}), {
        status: route.status,
      })
    }),
  )
  return calls
}

const input = (
  overrides: Partial<Parameters<typeof reconcileEvents>[0]> = {},
) => ({
  installationId: nextInstallation++,
  repositoryId: 22,
  repositoryFullName: REPO,
  branchName: BRANCH,
  branchDetected: true,
  prNumber: null,
  prState: null,
  ...overrides,
})

const PULLS = `/repos/${REPO}/pulls?`
const PR_142 = `/repos/${REPO}/pulls/142`
const REF = `/repos/${REPO}/git/ref/heads/`
const REPOSITORY = `/repos/${REPO}`
const RENAMED_PULLS = `/repos/${RENAMED_REPO}/pulls?`
const RENAMED_REF = `/repos/${RENAMED_REPO}/git/ref/heads/`
const INSTALLATION_REPOSITORIES = '/installation/repositories'

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  vi.stubEnv('GITHUB_APP_ID', '1')
  vi.stubEnv('GITHUB_APP_SLUG', 'ontask-test')
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'client-id')
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'client-secret')
  vi.stubEnv(
    'GITHUB_APP_PRIVATE_KEY',
    privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reconcileEvents', () => {
  it('an existing branch with the expected name is detected (a missed webhook, recovered)', async () => {
    mockGithub({ [PULLS]: { status: 200, body: [] }, [REF]: { status: 200 } })
    const events = await reconcileEvents(input({ branchDetected: false }))
    expect(events).toEqual([
      expect.objectContaining({ kind: 'branch', branch: BRANCH }),
    ])
  })

  it('a branch never seen and not there yet is just "waiting" -- no event', async () => {
    mockGithub({
      [PULLS]: { status: 200, body: [] },
      [REF]: { status: 404 },
      [REPOSITORY]: { status: 200 },
    })
    expect(await reconcileEvents(input({ branchDetected: false }))).toEqual([])
  })

  it('a seen branch that is gone, in a reachable repository, is deleted', async () => {
    mockGithub({
      [PULLS]: { status: 200, body: [] },
      [REF]: { status: 404 },
      [REPOSITORY]: { status: 200 },
    })
    expect(await reconcileEvents(input())).toEqual([
      expect.objectContaining({ kind: 'branch_deleted', branch: BRANCH }),
    ])
  })

  it('a repository the installation can no longer see is reported as access removed', async () => {
    mockGithub({
      [INSTALLATION_REPOSITORIES]: {
        status: 200,
        body: {
          total_count: 1,
          repositories: [
            {
              id: 33,
              full_name: 'acme/other',
              html_url: 'https://github.com/acme/other',
              private: false,
            },
          ],
        },
      },
    })
    expect(await reconcileEvents(input())).toEqual([
      {
        kind: 'repositories_removed',
        installation_id: expect.any(Number),
        repository_ids: [22],
      },
    ])
  })

  it('a renamed repository is found by stable id and refreshed before API calls', async () => {
    const calls = mockGithub({
      [INSTALLATION_REPOSITORIES]: {
        status: 200,
        body: {
          total_count: 1,
          repositories: [
            {
              id: 22,
              full_name: RENAMED_REPO,
              html_url: `https://github.com/${RENAMED_REPO}`,
              private: false,
            },
          ],
        },
      },
      [RENAMED_PULLS]: { status: 200, body: [] },
      [RENAMED_REF]: { status: 200 },
    })
    expect(await reconcileEvents(input())).toEqual([
      {
        kind: 'repository_metadata',
        installation_id: expect.any(Number),
        repository_id: 22,
        repository_full_name: RENAMED_REPO,
        repository_url: `https://github.com/${RENAMED_REPO}`,
      },
      expect.objectContaining({ kind: 'branch', branch: BRANCH }),
    ])
    expect(calls.some(path => path.startsWith(`/repos/${REPO}/`))).toBe(false)
  })

  it('an open PR is what counts: the branch is not even asked about', async () => {
    const calls = mockGithub({
      [PULLS]: { status: 200, body: [pr()] },
      [REF]: { status: 404 },
    })
    const events = await reconcileEvents(input())
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'pull_request',
        pull_request: expect.objectContaining({ state: 'open' }),
      }),
    ])
    expect(calls.some(path => path.startsWith(REF))).toBe(false)
  })

  it('a linked open PR that was merged meanwhile is reported merged', async () => {
    mockGithub({
      [PR_142]: {
        status: 200,
        body: pr({
          state: 'closed',
          merged: true,
          merged_at: '2026-09-26T11:00:00Z',
        }),
      },
    })
    const events = await reconcileEvents(
      input({ prNumber: 142, prState: 'open' }),
    )
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'pull_request',
        pull_request: expect.objectContaining({ merged: true }),
      }),
    ])
  })

  it('a PR closed without merging is reported closed', async () => {
    mockGithub({
      [PULLS]: {
        status: 200,
        body: [pr({ state: 'closed', closed_at: '2026-09-26T11:00:00Z' })],
      },
    })
    const [event] = await reconcileEvents(input())
    expect(event).toEqual(
      expect.objectContaining({
        kind: 'pull_request',
        pull_request: expect.objectContaining({
          state: 'closed',
          merged: false,
        }),
      }),
    )
  })

  it('a merged task asks GitHub nothing: a deleted branch cannot undo Completed', async () => {
    const calls = mockGithub({})
    expect(
      await reconcileEvents(input({ prNumber: 142, prState: 'merged' })),
    ).toEqual([])
    expect(calls).toEqual([])
  })

  it.each([
    [
      'a 5xx on the branch',
      { [PULLS]: { status: 200, body: [] }, [REF]: { status: 502 } },
    ],
    ['a rate limit', { [PULLS]: { status: 403 } }],
    ['a network error', { [PULLS]: new TypeError('fetch failed') }],
    [
      'a 404 on the branch while the repository itself errors',
      {
        [PULLS]: { status: 200, body: [] },
        [REF]: { status: 404 },
        [REPOSITORY]: { status: 503 },
      },
    ],
  ] as [string, Record<string, Route>][])(
    'a temporary failure (%s) throws -- never a deleted branch',
    async (_label, routes) => {
      mockGithub(routes)
      // GitHub's own failure, not a setup error in this test.
      await expect(reconcileEvents(input())).rejects.toThrow(/GitHub|fetch/)
    },
  )
})
