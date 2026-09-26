import { CacheHit, readCache, writeCache } from '@/lib/cache/cacheStore'
import type { Workspace } from '@/types/workspace'

// The signed-in user's SHARED workspaces, as the hub lists them, with member
// counts. This is the repository for that one entity: components and hooks ask
// for "the cached workspace list" and never touch IndexedDB or keys directly.
//
// It is a snapshot for painting the hub sooner. Whether the user may still see
// a workspace is decided by the server on every load (the list is replaced
// wholesale by the fresh response, so a workspace they've lost access to drops
// out), never by this copy.
const ENTITY = 'workspace-list'

export type WorkspaceListSnapshot = {
  workspaces: Workspace[]
  memberCounts: Record<string, number>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isWorkspace(value: unknown): value is Workspace {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.slug === 'string' &&
    (value.type === 'personal' || value.type === 'shared') &&
    typeof value.name === 'string' &&
    (value.description === null || typeof value.description === 'string') &&
    typeof value.ownerId === 'string' &&
    typeof value.timezone === 'string' &&
    typeof value.reportTime === 'string' &&
    typeof value.dailyReportsEnabled === 'boolean' &&
    // Required so a workspace cached before Events existed is refetched
    // rather than shown with its Events settings missing.
    typeof value.eventsEnabled === 'boolean' &&
    typeof value.eventsOverviewEnabled === 'boolean' &&
    typeof value.eventsCountdownEnabled === 'boolean' &&
    typeof value.eventsNotificationsEnabled === 'boolean' &&
    typeof value.eventsMembersCanCreate === 'boolean' &&
    typeof value.accent === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

// Whatever is on disk is untrusted -- it may be from an older build, truncated,
// or edited. Anything that isn't exactly today's shape is treated as absent.
export function isWorkspaceListSnapshot(
  value: unknown,
): value is WorkspaceListSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.workspaces) &&
    value.workspaces.every(isWorkspace) &&
    isRecord(value.memberCounts) &&
    Object.values(value.memberCounts).every(count => typeof count === 'number')
  )
}

export async function getCachedWorkspaceList(
  userId: string,
): Promise<CacheHit<WorkspaceListSnapshot> | undefined> {
  const hit = await readCache<unknown>(userId, ENTITY)
  if (!hit || !isWorkspaceListSnapshot(hit.data)) return undefined
  return { data: hit.data, cachedAt: hit.cachedAt }
}

export function saveWorkspaceList(
  userId: string,
  snapshot: WorkspaceListSnapshot,
): Promise<void> {
  return writeCache(userId, ENTITY, 'all', snapshot)
}
