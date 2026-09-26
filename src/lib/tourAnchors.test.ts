import { describe, expect, it } from 'vitest'
import { TOUR_ANCHORS, tourAnchor, tourInset } from '@/lib/tourAnchors'

describe('tourInset', () => {
  it('marks sticky chrome a tour must keep its targets clear of', () => {
    expect(tourInset('top')).toEqual({ 'data-tour-inset': 'top' })
  })
})

describe('tourAnchor', () => {
  it('produces the data-tour attribute a tour looks targets up by', () => {
    expect(tourAnchor('goals')).toEqual({ 'data-tour': 'goals' })
  })

  it('exposes exactly the targets the onboarding tours rely on', () => {
    expect([...TOUR_ANCHORS].sort()).toEqual(
      [
        'activity',
        'goals',
        'page-daily-updates',
        'page-ideas',
        'page-overview',
        'resources',
        'settings',
        'task-notes',
        'today-tasks',
        'work-session',
        'workspace-members',
        'working-now',
        'dev-overview',
        'dev-new-task',
        'dev-connection',
        'dev-branch-name',
        'dev-stage-queued',
        'dev-stage-in-development',
        'dev-stage-in-review',
        'dev-stage-completed',
        'dev-journey',
      ].sort(),
    )
  })

  it('has no duplicate ids', () => {
    expect(new Set(TOUR_ANCHORS).size).toBe(TOUR_ANCHORS.length)
  })
})
