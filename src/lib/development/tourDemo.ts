import { generateBranchName } from '@/lib/development/branchName'
import type {
  DevelopmentTrackingStatus,
  DevelopmentWorkType,
  Goal,
  GithubConnection,
  PullRequestState,
  TaskDevelopment,
  TaskPriority,
  WorkspaceMember,
  WorkspaceTask,
  WorkspaceTaskStatus,
} from '@/types/workspace'

// Sample data for the Development tour. It is only ever rendered while that
// tour runs (see DevelopmentTourDemo) and never touches the database: every id
// is prefixed `demo-` so nothing can mistake it for a real row. Branch names go
// through generateBranchName, so the demo shows exactly the names a real task
// with that title, assignee and type would get.

export const DEMO_REPOSITORY = 'acme/storefront'

export const DEMO_CONNECTION: GithubConnection = {
  workspaceId: 'demo-workspace',
  accountLogin: 'acme',
  repositoryFullName: DEMO_REPOSITORY,
  repositoryUrl: `https://github.com/${DEMO_REPOSITORY}`,
  status: 'connected',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function member(key: string, fullName: string): WorkspaceMember {
  return {
    id: `demo-member-${key}`,
    workspaceId: 'demo-workspace',
    userId: `demo-user-${key}`,
    role: 'member',
    joinedAt: '2026-01-01T00:00:00.000Z',
    fullName,
    email: null,
    avatarUrl: null,
  }
}

export const DEMO_MEMBERS: WorkspaceMember[] = [
  member('sara', 'Sara Khan'),
  member('omar', 'Omar Ali'),
  member('lena', 'Lena Park'),
  member('diego', 'Diego Ruiz'),
]

function goal(key: string, name: string): Goal {
  return {
    id: `demo-goal-${key}`,
    workspaceId: 'demo-workspace',
    name,
    description: null,
    status: 'active',
    createdBy: 'demo-user-sara',
    targetDate: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    archivedAt: null,
  }
}

export const DEMO_GOALS: Goal[] = [
  goal('checkout', 'Launch the new checkout'),
  goal('reports', 'Self-serve reporting'),
]

type DemoSpec = {
  key: string
  title: string
  workType: DevelopmentWorkType
  assignee: string
  priority: TaskPriority
  goal?: string
  status: WorkspaceTaskStatus
  trackingStatus: DevelopmentTrackingStatus
  pr?: { number: number; title: string; state: PullRequestState }
  // Minutes before "now" the task was created -- only orders a stage's rows.
  age: number
}

const SPECS: DemoSpec[] = [
  {
    key: 'csv-export',
    title: 'Add CSV export to reports',
    workType: 'feature',
    assignee: 'omar',
    priority: 'high',
    goal: 'reports',
    status: 'queued',
    trackingStatus: 'waiting',
    age: 30,
  },
  {
    key: 'webhook-docs',
    title: 'Update webhook docs',
    workType: 'docs',
    assignee: 'lena',
    priority: 'low',
    status: 'queued',
    trackingStatus: 'waiting',
    age: 90,
  },
  {
    key: 'login-loop',
    title: 'Fix login redirect loop',
    workType: 'bug',
    assignee: 'diego',
    priority: 'urgent',
    status: 'working',
    trackingStatus: 'branch_detected',
    age: 240,
  },
  {
    key: 'billing',
    title: 'Refactor billing service',
    workType: 'refactor',
    assignee: 'sara',
    priority: 'medium',
    status: 'paused',
    trackingStatus: 'branch_detected',
    age: 600,
  },
  {
    key: 'checkout',
    title: 'Redesign checkout page',
    workType: 'feature',
    assignee: 'sara',
    priority: 'high',
    goal: 'checkout',
    status: 'working',
    trackingStatus: 'in_review',
    pr: { number: 128, title: 'Redesign checkout page', state: 'open' },
    age: 1440,
  },
  {
    key: 'search',
    title: 'Speed up search results',
    workType: 'improvement',
    assignee: 'lena',
    priority: 'medium',
    goal: 'checkout',
    status: 'completed',
    trackingStatus: 'merged',
    pr: { number: 121, title: 'Speed up search results', state: 'merged' },
    age: 2880,
  },
]

export type DemoItem = { task: WorkspaceTask; development: TaskDevelopment }

export function demoAssignee(key: string) {
  return DEMO_MEMBERS.find(item => item.userId === `demo-user-${key}`) ?? null
}

// Built on demand so the timestamps are relative to when the tour opens.
export function buildDemoItems(now = Date.now()): DemoItem[] {
  return SPECS.map(spec => {
    const id = `demo-task-${spec.key}`
    const createdAt = new Date(now - spec.age * 60_000).toISOString()
    const finished = spec.status === 'completed'
    const task: WorkspaceTask = {
      id,
      workspaceId: 'demo-workspace',
      parentTaskId: null,
      goalId: spec.goal ? `demo-goal-${spec.goal}` : null,
      createdBy: 'demo-user-sara',
      assignedTo: `demo-user-${spec.assignee}`,
      name: spec.title,
      plannedMinutes: null,
      workedSeconds: 0,
      status: spec.status,
      priority: spec.priority,
      startedAt: null,
      completedAt: finished ? now - 60 * 60_000 : null,
    }
    const detected = spec.trackingStatus !== 'waiting'
    const development: TaskDevelopment = {
      taskId: id,
      workspaceId: 'demo-workspace',
      branchName: generateBranchName(
        spec.title,
        demoAssignee(spec.assignee),
        spec.workType,
      ),
      workType: spec.workType,
      repositoryFullName: detected ? DEMO_REPOSITORY : null,
      branchDetectedAt: detected ? createdAt : null,
      branchDeletedAt: null,
      branchReleasedAt: null,
      prNumber: spec.pr?.number ?? null,
      prUrl: null,
      prTitle: spec.pr?.title ?? null,
      prState: spec.pr?.state ?? null,
      prOpenedAt: spec.pr ? createdAt : null,
      prClosedAt: null,
      prMergedAt: spec.pr?.state === 'merged' ? createdAt : null,
      trackingStatus: spec.trackingStatus,
      createdAt,
    }
    return { task, development }
  })
}

// The one task whose whole journey the tour walks through, start to merge.
export const DEMO_JOURNEY_TASK_ID = 'demo-task-search'
