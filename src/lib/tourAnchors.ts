// Stable targets for contextual onboarding tours.
//
// A tour finds what it should highlight through `data-tour` — never through
// class names, DOM nesting or text — so it survives ordinary UI refactors.
// Components spread `tourAnchor('<id>')` onto the element a tour should point
// at; the tour engine looks the same id up.
//
// Notes for whoever builds the engine:
//  - An id can be on more than one element when the same thing is rendered
//    responsively (e.g. the settings entry is a sidebar icon from `sm:` up and
//    a tab below it). Only one is displayed at a time, so resolve the first
//    *visible* match rather than the first match.
//  - An id is only in the DOM while its UI is (a step whose target is absent
//    should be skipped, not shown pointing at nothing).
export const TOUR_ANCHORS = [
  'today-tasks',
  'goals',
  'resources',
  'settings',
  'workspace-members',
  'working-now',
  'task-notes',
  'activity',
  'work-session',
  'page-overview',
  'page-daily-updates',
  'page-ideas',
  // The Development tour (sample board rendered only while it runs).
  'dev-overview',
  'dev-new-task',
  'dev-connection',
  'dev-branch-name',
  'dev-stage-queued',
  'dev-stage-in-development',
  'dev-stage-in-review',
  'dev-stage-completed',
  'dev-journey',
] as const

export type TourAnchor = (typeof TOUR_ANCHORS)[number]

export function tourAnchor(id: TourAnchor) {
  return { 'data-tour': id } as const
}

// Marks sticky chrome (the workspace header) that stays put while the page
// scrolls. A tour keeps its targets clear of it when it scrolls them into
// view, and doesn't try to scroll a target that lives inside it.
export function tourInset(edge: 'top') {
  return { 'data-tour-inset': edge } as const
}
