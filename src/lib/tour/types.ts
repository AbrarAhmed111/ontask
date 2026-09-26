import type { TourAnchor } from '@/lib/tourAnchors'

// One id per tour. Persisted next to the user and workspace it was shown in
// (see progress.ts), so an id is never renamed once it has shipped.
export type TourId = 'personal-workspace' | 'shared-workspace' | 'development'

// How a tour ended. A tour that is interrupted (the user navigates away, a
// target disappears) has no outcome and is offered again next time.
export type TourOutcome = 'completed' | 'skipped'

export type Placement = 'top' | 'bottom' | 'left' | 'right'

export type TourStepDefinition = {
  // The `data-tour` anchor the step points at. A step whose anchor isn't
  // rendered (or isn't visible) is left out of the tour.
  target: TourAnchor
  title: string
  description: string
  // A second, quieter line for the one thing a step must not leave ambiguous.
  hint?: string
  // The side to try first. Falls back to whichever side has room.
  prefer?: Placement
}

export type TourDefinition = {
  id: TourId
  // Names the tour on the Settings replay button.
  label: string
  steps: TourStepDefinition[]
}

// The tour as it is running: the steps that actually have something on screen
// to point at, and where the user is in them.
export type TourRun = {
  tourId: TourId
  steps: TourStepDefinition[]
  index: number
  // Which way the user was last heading, so a step that turns out to be
  // missing is skipped in that direction.
  direction: 1 | -1
}
