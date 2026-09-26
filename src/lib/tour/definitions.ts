import type { WorkspaceType } from '@/types/workspace'
import type { TourDefinition, TourId } from '@/lib/tour/types'

// What each tour says. The engine (components/tour) knows nothing about
// OnTask; a tour is just this data, pointed at the `data-tour` anchors the UI
// already carries (lib/tourAnchors).
//
// Copy rules: say what the thing is and what to do there, in a sentence or
// two. This is a signpost, not documentation.
//
// Deliberately absent:
//  - Account and Notifications. The account menu is a name, "All workspaces"
//    and Log out; the bell explains itself. Neither earns a step.
//  - Anything about a light/dark theme -- OnTask has none. "Theme" is the
//    workspace accent, which lives on the Settings page.
//  - Sub-tasks under ordinary tasks. Only Goals have Goal > Task > Subtask;
//    workspace tasks are flat, so the copy never implies otherwise.

const PERSONAL_WORKSPACE_TOUR: TourDefinition = {
  id: 'personal-workspace',
  label: 'Personal Workspace tour',
  steps: [
    {
      target: 'today-tasks',
      title: 'Daily Tasks',
      description:
        'This is your daily workspace. Add the tasks you want to work on today and track the time you actually spend on them.',
      hint: 'OnTask is about the work you actually do, not complicated project management.',
    },
    {
      target: 'goals',
      title: 'Goals',
      description:
        "Goals represent the bigger outcomes you're working toward. Create a goal and organize the work that moves you closer to it.",
      hint: 'Daily tasks are the work you do today; goals are what that work adds up to.',
    },
    {
      target: 'resources',
      title: 'Resources',
      description:
        "Keep useful documents, images, and other files here so they're easy to access while you work.",
    },
    {
      target: 'settings',
      title: 'Settings',
      description:
        'Customize your OnTask experience here, including your accent theme and workspace preferences.',
      prefer: 'right',
    },
  ],
}

// In the order the page lays them out, so the tour moves down the page once
// instead of jumping back up to Goals after Activity.
const SHARED_WORKSPACE_TOUR: TourDefinition = {
  id: 'shared-workspace',
  label: 'Shared Workspace tour',
  steps: [
    {
      target: 'page-overview',
      title: 'Overview',
      description:
        'Start here for the live workspace: tasks, goals, resources, and who is working now.',
    },
    {
      target: 'page-daily-updates',
      title: 'Daily Updates',
      description:
        'Use this page before standup to share what is done, what is next, and where you are blocked.',
    },
    {
      target: 'page-ideas',
      title: 'Ideas',
      description:
        'Capture opportunities, improvements, reminders, and questions before turning the best ones into work.',
    },
    {
      target: 'settings',
      title: 'Settings',
      description:
        'Manage workspace preferences here, including accent color, report settings, and integrations.',
      prefer: 'right',
    },
    {
      target: 'work-session',
      title: 'Work Session',
      description:
        'Use this compact control to start work, take a break, resume, or end your work session.',
      hint: 'This is separate from task timers; it tells teammates whether you are working.',
    },
    {
      target: 'workspace-members',
      title: 'Members',
      description:
        "See who is on the team, read each avatar's live status, and review workspace activity.",
      hint: 'Gray is offline, green online or working, yellow break, and orange blocked.',
    },
    {
      target: 'activity',
      title: 'Activity',
      description:
        'See what has changed across the workspace in real time, including task updates, assignments, and other important activity.',
    },
    {
      target: 'working-now',
      title: 'Working now',
      description:
        "See who is currently working and what they're working on in real time.",
      hint: "When someone starts a task, they're listed just below.",
    },
    {
      target: 'today-tasks',
      title: 'Tasks',
      description:
        'Create tasks, assign them to teammates, and follow their progress as work moves forward.',
    },
    {
      target: 'task-notes',
      title: 'Task notes',
      description:
        'Add shared notes to a task so everyone working on it has the same context.',
      hint: 'Everyone who can see the task can read its notes.',
    },
    {
      target: 'goals',
      title: 'Goals',
      description:
        'Use Goals for larger outcomes and organize them into tasks and subtasks.',
    },
    {
      target: 'resources',
      title: 'Resources',
      description:
        'Keep workspace documents and other shared resources here so your team can easily access them.',
    },
  ],
}

export const TOURS: Record<TourId, TourDefinition> = {
  'personal-workspace': PERSONAL_WORKSPACE_TOUR,
  'shared-workspace': SHARED_WORKSPACE_TOUR,
}

// Which tour a workspace gets: the same engine, a different definition.
export function tourIdForWorkspace(type: WorkspaceType): TourId {
  return type === 'personal' ? 'personal-workspace' : 'shared-workspace'
}
