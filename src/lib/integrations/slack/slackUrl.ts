/**
 * Centralized URL & deep-link utility for OnTask.
 * Generates absolute deep links for Slack notifications and external surfaces.
 */

export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL.replace(/\/+$/, '')
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3000'
}

export function getWorkspaceUrl(workspaceSlug: string): string {
  return `${getBaseUrl()}/workspaces/${encodeURIComponent(workspaceSlug)}`
}

export function getTaskUrl(workspaceSlug: string, taskId: string): string {
  return `${getWorkspaceUrl(workspaceSlug)}?task=${encodeURIComponent(taskId)}`
}

// Membership events point at the page that actually lists members, not the
// overview — it is a real route (/workspaces/[workspaceSlug]/members), so the
// link lands on the thing the message is about.
export function getMembersUrl(workspaceSlug: string): string {
  return `${getWorkspaceUrl(workspaceSlug)}/members`
}

export function getReportUrl(workspaceSlug: string, reportId?: string): string {
  if (reportId) {
    return `${getWorkspaceUrl(workspaceSlug)}?report=${encodeURIComponent(reportId)}`
  }
  return getWorkspaceUrl(workspaceSlug)
}

// A goal opens the workspace with that goal expanded and scrolled to, the same
// mechanism `?task=` uses for a task (FocusedGoalContext reads it, GoalCard
// answers it). Without an id there is nothing to open, so the link falls back
// to the workspace rather than becoming `?goal=undefined`.
export function getGoalUrl(workspaceSlug: string, goalId?: string): string {
  if (!goalId) return getWorkspaceUrl(workspaceSlug)
  return `${getWorkspaceUrl(workspaceSlug)}?goal=${encodeURIComponent(goalId)}`
}

// Resources have no per-file view to link to -- they are a list on the
// workspace overview -- so this is the list's own anchor rather than a query
// parameter nothing reads. A deleted file's message still lands somewhere
// truthful: the place it used to be.
export function getResourcesUrl(workspaceSlug: string): string {
  return `${getWorkspaceUrl(workspaceSlug)}#workspace-resources`
}
