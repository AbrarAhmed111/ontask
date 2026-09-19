import { field, isArrayOf, isShape } from '@/lib/cache/validate'
import { isWorkspace } from '@/lib/cache/workspaceListCache'
import type { ActivityEvent } from '@/hooks/useWorkspaceActivity'
import type {
  Goal,
  NotificationWithWorkspace,
  SlackStatusData,
  TaskNote,
  Workspace,
  WorkspaceDailySummary,
  WorkspaceMember,
  WorkspaceResource,
  WorkspaceTask,
} from '@/types/workspace'

// What is cached per workspace, and how each kind is validated when it is read
// back. One descriptor per kind; hooks/useWorkspaceSnapshot.ts takes one and
// does the rest (hydrate, persist, isolate). Everything is namespaced by the
// signed-in user AND the workspace (notes additionally by task), so cached data
// can't be shown to another account or under another workspace.
//
// What is deliberately NOT here: files. A resource is cached as metadata (name,
// type, size, storage path) -- the bytes stay in Supabase Storage and are
// fetched on demand.
export type SnapshotDescriptor<T> = {
  entity: string
  validate: (value: unknown) => value is T
}

// The workspace row and its members are one snapshot: the members decide the
// caller's role, and the layout needs both to render the shell. Keyed by the URL
// slug because that is all that is known before the row has loaded.
export type WorkspaceDetail = {
  workspace: Workspace | null
  members: WorkspaceMember[]
}

const isMember = isShape<WorkspaceMember>({
  id: field.string,
  workspaceId: field.string,
  userId: field.string,
  role: field.oneOf('owner', 'member'),
  joinedAt: field.string,
  fullName: field.nullableString,
  email: field.nullableString,
  avatarUrl: field.nullableString,
})

const isTask = isShape<WorkspaceTask>({
  id: field.string,
  workspaceId: field.string,
  parentTaskId: field.nullableString,
  goalId: field.nullableString,
  createdBy: field.string,
  assignedTo: field.nullableString,
  name: field.string,
  description: field.nullableString,
  plannedMinutes: field.nullableNumber,
  workedSeconds: field.number,
  status: field.oneOf(
    'queued',
    'working',
    'paused',
    'blocked',
    'completed',
    'skipped',
  ),
  progressLabel: field.optionalString,
  progressPercentage: field.optionalNumber,
  startedAt: field.nullableNumber,
  completedAt: field.nullableNumber,
})

const isGoal = isShape<Goal>({
  id: field.string,
  workspaceId: field.string,
  name: field.string,
  description: field.nullableString,
  status: field.oneOf('active', 'completed', 'archived'),
  createdBy: field.string,
  targetDate: field.nullableString,
  position: field.number,
  createdAt: field.string,
  updatedAt: field.string,
  completedAt: field.nullableString,
  archivedAt: field.nullableString,
})

const isActivityEvent = isShape<ActivityEvent>({
  id: field.string,
  taskId: field.string,
  goalId: field.nullableString,
  actorId: field.string,
  eventType: field.string,
  metadata: field.object,
  createdAt: field.string,
})

const isNotification = isShape<NotificationWithWorkspace>({
  id: field.string,
  userId: field.string,
  workspaceId: field.string,
  eventId: field.nullableString,
  goalId: field.nullableString,
  notificationType: field.string,
  entityType: field.string,
  entityId: field.nullableString,
  title: field.string,
  body: field.nullableString,
  actorId: field.nullableString,
  readAt: field.nullableString,
  createdAt: field.string,
  workspaceSlug: field.string,
  workspaceName: field.string,
  workspaceType: field.oneOf('personal', 'shared'),
  workspaceAccent: field.string,
})

// The report's nested JSON (snapshot, narrative, meta) is stored exactly as the
// server returned it and is read defensively by the components, so it is only
// checked to be objects here; the columns around it are checked fully.
const isSummary = isShape<WorkspaceDailySummary>({
  id: field.string,
  workspaceId: field.string,
  reportStart: field.string,
  reportEnd: field.string,
  reportTimezone: field.string,
  version: field.number,
  structuredSnapshot: field.object,
  narrative: field.object,
  meta: field.object,
  generationType: field.oneOf('automatic', 'manual'),
  generationStatus: field.oneOf('pending', 'completed', 'failed'),
  generatedBy: field.nullableString,
  generatedAt: field.string,
  regeneratedBy: field.nullableString,
  regeneratedAt: field.nullableString,
  createdAt: field.string,
})

const isResource = isShape<WorkspaceResource>({
  id: field.string,
  workspaceId: field.string,
  goalId: field.nullableString,
  uploadedBy: field.string,
  fileName: field.string,
  fileType: field.string,
  fileSize: field.number,
  storagePath: field.string,
  description: field.nullableString,
  createdAt: field.string,
  updatedAt: field.string,
})

const isNote = isShape<TaskNote>({
  id: field.string,
  taskId: field.string,
  authorId: field.string,
  content: field.string,
  createdAt: field.string,
  updatedAt: field.string,
})

const isSlackStatus = isShape<SlackStatusData>({
  connected: field.boolean,
  connection_status: field.optionalString,
  id: field.optionalString,
  slack_team_id: field.optionalString,
  slack_team_name: field.optionalString,
  channel_id: field.optionalString,
  channel_name: field.optionalString,
  notification_settings: field.object,
  can_manage: { kind: 'boolean', optional: true },
})

function descriptor<T>(
  entity: string,
  validate: (value: unknown) => value is T,
): SnapshotDescriptor<T> {
  return { entity, validate }
}

const isWorkspaceDetail = (value: unknown): value is WorkspaceDetail =>
  isShape<{ workspace: unknown; members: unknown }>({
    workspace: field.object,
    members: field.array,
  })(value) &&
  isWorkspace(value.workspace) &&
  isArrayOf(isMember)(value.members)

export const SNAPSHOTS = {
  workspaceDetail: descriptor('workspace-detail', isWorkspaceDetail),
  tasks: descriptor('tasks', isArrayOf(isTask)),
  goals: descriptor('goals', isArrayOf(isGoal)),
  activity: descriptor('activity', isArrayOf(isActivityEvent)),
  notifications: descriptor('notifications', isArrayOf(isNotification)),
  summaries: descriptor('daily-reports', isArrayOf(isSummary)),
  resources: descriptor('resources', isArrayOf(isResource)),
  notes: descriptor('task-notes', isArrayOf(isNote)),
  slackStatus: descriptor('slack-status', isSlackStatus),
}
