import type {
  DevelopmentTrackingStatus,
  DevelopmentWorkType,
  GithubConnection,
  GithubConnectionStatus,
  PullRequestState,
  TaskDevelopment,
  TaskPriority,
  WorkspaceTask,
} from '@/types/workspace'

export type TaskDevelopmentRow = {
  task_id: string
  workspace_id: string
  branch_name: string
  // Absent until migration 20260926150000 is applied.
  work_type?: DevelopmentWorkType
  repository_full_name: string | null
  branch_detected_at: string | null
  pr_number: number | null
  pr_url: string | null
  pr_title: string | null
  pr_state: PullRequestState | null
  pr_opened_at: string | null
  pr_closed_at: string | null
  pr_merged_at: string | null
  tracking_status: DevelopmentTrackingStatus
  created_at: string
}

export function rowToTaskDevelopment(row: TaskDevelopmentRow): TaskDevelopment {
  return {
    taskId: row.task_id,
    workspaceId: row.workspace_id,
    branchName: row.branch_name,
    workType: row.work_type ?? 'feature',
    repositoryFullName: row.repository_full_name,
    branchDetectedAt: row.branch_detected_at,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    prTitle: row.pr_title,
    prState: row.pr_state,
    prOpenedAt: row.pr_opened_at,
    prClosedAt: row.pr_closed_at,
    prMergedAt: row.pr_merged_at,
    trackingStatus: row.tracking_status,
    createdAt: row.created_at,
  }
}

export type GithubConnectionRow = {
  workspace_id: string
  account_login: string | null
  repository_full_name: string | null
  repository_url: string | null
  status: GithubConnectionStatus
  updated_at: string
}

export function rowToGithubConnection(
  row: GithubConnectionRow,
): GithubConnection {
  return {
    workspaceId: row.workspace_id,
    accountLogin: row.account_login,
    repositoryFullName: row.repository_full_name,
    repositoryUrl: row.repository_url,
    status: row.status,
    updatedAt: row.updated_at,
  }
}

// The four stages a Development Task moves through, as people talk about them.
// Read from the task's own status AND its GitHub tracking together:
//   - the task being finished always wins (a merge, or finished by hand);
//   - otherwise GitHub decides: an open PR is In Review; a branch that exists
//     (including after a PR was closed without merging) is In Development.
// A merged PR on a task that is still open (it was blocked when the merge
// arrived) stays In Development until the task itself is finished.
export type DevelopmentStage =
  'queued' | 'in_development' | 'in_review' | 'completed'

export const DEVELOPMENT_STAGES: DevelopmentStage[] = [
  'queued',
  'in_development',
  'in_review',
  'completed',
]

export const STAGE_LABELS: Record<DevelopmentStage, string> = {
  queued: 'Queued',
  in_development: 'In Development',
  in_review: 'In Review',
  completed: 'Completed',
}

export function developmentStage(
  task: Pick<WorkspaceTask, 'status'>,
  development: Pick<TaskDevelopment, 'trackingStatus'>,
): DevelopmentStage {
  if (task.status === 'completed' || task.status === 'skipped') {
    return 'completed'
  }
  switch (development.trackingStatus) {
    case 'in_review':
      return 'in_review'
    case 'branch_detected':
    case 'pr_closed':
    case 'merged':
      return 'in_development'
    default:
      return 'queued'
  }
}

// What kind of change a Development Task is, in the order the picker offers
// them, with the branch prefix each one gets.
export const WORK_TYPES: {
  value: DevelopmentWorkType
  label: string
  description: string
  branchPrefix: string
}[] = [
  {
    value: 'feature',
    label: 'Feature',
    description: 'Something new for users',
    branchPrefix: 'feature/',
  },
  {
    value: 'bug',
    label: 'Bug',
    description: 'Something is broken',
    branchPrefix: 'fix/',
  },
  {
    value: 'hotfix',
    label: 'Hotfix',
    description: 'An urgent fix for production',
    branchPrefix: 'hotfix/',
  },
  {
    value: 'improvement',
    label: 'Improvement',
    description: 'Make something existing better',
    branchPrefix: 'improvement/',
  },
  {
    value: 'refactor',
    label: 'Refactor',
    description: 'Restructure code, same behaviour',
    branchPrefix: 'refactor/',
  },
  {
    value: 'chore',
    label: 'Chore',
    description: 'Tooling, dependencies, housekeeping',
    branchPrefix: 'chore/',
  },
  {
    value: 'docs',
    label: 'Docs',
    description: 'Documentation only',
    branchPrefix: 'docs/',
  },
]

export function workTypeInfo(type: DevelopmentWorkType) {
  return WORK_TYPES.find(item => item.value === type) ?? WORK_TYPES[0]
}

export const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

// Highest first, for sorting a stage's tasks.
export function priorityRank(priority: TaskPriority | null | undefined) {
  return priority ? PRIORITIES.indexOf(priority) + 1 : 0
}

// A branch or its PR on GitHub. Branch names are limited to [a-z0-9-/], so the
// path needs no escaping.
export function branchUrl(repositoryFullName: string, branchName: string) {
  return `https://github.com/${repositoryFullName}/tree/${branchName}`
}

// Whether GitHub events reach this workspace right now.
export function isTracking(connection: GithubConnection | null) {
  return connection?.status === 'connected'
}

export const CONNECTION_STATUS_MESSAGES: Record<
  GithubConnectionStatus,
  string
> = {
  connected: 'Connected',
  repository_required: 'Choose a repository to start tracking.',
  repository_access_lost:
    'OnTask no longer has access to this repository on GitHub.',
  suspended: 'The OnTask GitHub App is suspended for this account.',
  disconnected: 'The OnTask GitHub App was uninstalled on GitHub.',
}
