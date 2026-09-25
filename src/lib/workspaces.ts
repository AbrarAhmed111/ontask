import { Workspace, WorkspaceType } from '@/types/workspace'

// Every user's Personal Workspace lives at the same URL:
// /workspaces/personal-workspace. It's an alias, not the row's stored slug
// (that one embeds the owner's id so the global UNIQUE(slug) still holds) —
// the app resolves the alias to "the signed-in user's own personal
// workspace", so one user can never reach another's by editing the URL.
export const PERSONAL_WORKSPACE_SLUG = 'personal-workspace'
export const PERSONAL_WORKSPACE_PATH = `/workspaces/${PERSONAL_WORKSPACE_SLUG}`
// What the UI calls it, wherever it's shown next to shared workspaces' names.
export const PERSONAL_WORKSPACE_NAME = 'Personal Workspace'

export type WorkspaceRow = {
  id: string
  slug: string
  type: WorkspaceType
  name: string
  description: string | null
  owner_id: string
  timezone: string
  report_time: string
  // Absent until migration 0042 is applied; see rowToWorkspace.
  daily_reports_enabled?: boolean
  // Absent until the Development module migration is applied.
  development_enabled?: boolean
  accent: string
  created_at: string
  updated_at: string
}

export function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    // Personal workspaces are always addressed by the alias, everywhere a
    // link or route is built from `workspace.slug`.
    slug: row.type === 'personal' ? PERSONAL_WORKSPACE_SLUG : row.slug,
    type: row.type,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    timezone: row.timezone,
    reportTime: row.report_time,
    // Until the migration is applied there is no column: report the product
    // default (a personal workspace opt-in, a shared one on) rather than guess.
    dailyReportsEnabled: row.daily_reports_enabled ?? row.type !== 'personal',
    developmentEnabled: row.development_enabled ?? false,
    accent: row.accent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// The fields of a workspace its owner can change after creation.
export type WorkspacePatch = Partial<
  Pick<
    Workspace,
    | 'name'
    | 'description'
    | 'timezone'
    | 'reportTime'
    | 'accent'
    | 'dailyReportsEnabled'
    | 'developmentEnabled'
  >
>

// A patch as the columns it updates -- only the ones actually present, so saving
// one setting (the Daily Reports switch) never rewrites another.
export function workspacePatchToRow(
  patch: WorkspacePatch,
): Record<string, string | boolean | null> {
  const row: Record<string, string | boolean | null> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.description !== undefined) row.description = patch.description
  if (patch.timezone !== undefined) row.timezone = patch.timezone
  if (patch.reportTime !== undefined) row.report_time = patch.reportTime
  if (patch.accent !== undefined) row.accent = patch.accent
  if (patch.dailyReportsEnabled !== undefined)
    row.daily_reports_enabled = patch.dailyReportsEnabled
  if (patch.developmentEnabled !== undefined)
    row.development_enabled = patch.developmentEnabled
  return row
}

export function isPersonalWorkspace(
  workspace: Pick<Workspace, 'type'> | null | undefined,
) {
  return workspace?.type === 'personal'
}

// The path a workspace is opened at.
export function workspacePath(workspace: Pick<Workspace, 'slug'>) {
  return `/workspaces/${workspace.slug}`
}
