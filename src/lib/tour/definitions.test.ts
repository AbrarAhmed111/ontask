import { describe, expect, it } from 'vitest'
import { TOURS, tourIdForWorkspace } from '@/lib/tour/definitions'
import { TOUR_ANCHORS } from '@/lib/tourAnchors'

const tours = Object.values(TOURS)
const personal = TOURS['personal-workspace']
const shared = TOURS['shared-workspace']
const development = TOURS.development

describe('tour definitions', () => {
  it('is keyed by the id each tour carries', () => {
    for (const [key, tour] of Object.entries(TOURS)) {
      expect(tour.id).toBe(key)
    }
  })

  it('points every step at an anchor the UI can actually carry', () => {
    for (const tour of tours) {
      for (const step of tour.steps) {
        expect(TOUR_ANCHORS).toContain(step.target)
      }
    }
  })

  it('visits each target once per tour', () => {
    for (const tour of tours) {
      const targets = tour.steps.map(step => step.target)
      expect(new Set(targets).size).toBe(targets.length)
    }
  })

  it('keeps the copy short enough to read at a glance', () => {
    for (const tour of tours) {
      for (const step of tour.steps) {
        expect(step.title.trim().length).toBeGreaterThan(0)
        expect(step.title.length).toBeLessThanOrEqual(24)
        expect(step.description.length).toBeLessThanOrEqual(140)
        if (step.hint) expect(step.hint.length).toBeLessThanOrEqual(90)
      }
    }
  })

  it('names each tour for its replay button', () => {
    expect(personal.label).toBe('Personal Workspace tour')
    expect(shared.label).toBe('Shared Workspace tour')
  })
})

describe('personal workspace tour', () => {
  it('covers the daily tasks, goals, resources and settings, in that order', () => {
    expect(personal.steps.map(step => step.target)).toEqual([
      'today-tasks',
      'goals',
      'resources',
      'settings',
    ])
  })

  it('has nothing that only makes sense with teammates', () => {
    const collaborative = [
      'workspace-members',
      'working-now',
      'task-notes',
      'activity',
      'work-session',
      'page-daily-updates',
    ]
    for (const step of personal.steps) {
      expect(collaborative).not.toContain(step.target)
    }
  })
})

describe('shared workspace tour', () => {
  it('covers collaboration, following the order of the page', () => {
    expect(shared.steps.map(step => step.target)).toEqual([
      'page-overview',
      'page-daily-updates',
      'page-ideas',
      'settings',
      'work-session',
      'workspace-members',
      'activity',
      'working-now',
      'today-tasks',
      'task-notes',
      'goals',
      'resources',
    ])
  })

  it('explains the session control and member avatar statuses', () => {
    const session = shared.steps.find(step => step.target === 'work-session')
    expect(session?.description).toMatch(/start work/i)
    expect(session?.hint).toMatch(/separate from task timers/i)

    const members = shared.steps.find(
      step => step.target === 'workspace-members',
    )
    expect(members?.hint).toMatch(/gray is offline/i)
    expect(members?.hint).toMatch(/yellow break/i)
    expect(members?.hint).toMatch(/orange blocked/i)
  })

  it('introduces the main workspace pages', () => {
    expect(
      shared.steps
        .filter(step =>
          [
            'page-overview',
            'page-daily-updates',
            'page-ideas',
            'settings',
          ].includes(step.target),
        )
        .map(step => step.title),
    ).toEqual(['Overview', 'Daily Updates', 'Ideas', 'Settings'])
  })

  it('never implies ordinary tasks can have subtasks; only Goals do', () => {
    for (const step of shared.steps) {
      const text = `${step.title} ${step.description} ${step.hint ?? ''}`
      if (step.target === 'goals') {
        expect(text).toMatch(/subtasks/i)
      } else {
        expect(text).not.toMatch(/sub-?tasks?/i)
      }
    }
  })

  it('makes clear that notes are shared', () => {
    const notes = shared.steps.find(step => step.target === 'task-notes')
    expect(notes?.description).toMatch(/shared notes/i)
    expect(notes?.hint).toMatch(/everyone who can see the task/i)
  })
})

describe('development tour', () => {
  it('walks the sample board top to bottom, one stage at a time', () => {
    expect(development.steps.map(step => step.target)).toEqual([
      'dev-overview',
      'dev-new-task',
      'dev-connection',
      'dev-branch-name',
      'dev-stage-queued',
      'dev-stage-in-development',
      'dev-stage-in-review',
      'dev-stage-completed',
      'dev-journey',
    ])
  })

  it('says up front that the board is sample data', () => {
    expect(development.steps[0].hint).toMatch(/sample data/i)
  })

  it('explains what moves a task between stages', () => {
    const text = (target: string) => {
      const step = development.steps.find(item => item.target === target)
      return `${step?.description} ${step?.hint ?? ''}`
    }
    expect(text('dev-stage-in-development')).toMatch(/branch/i)
    expect(text('dev-stage-in-review')).toMatch(/pull request/i)
    expect(text('dev-stage-completed')).toMatch(/merg/i)
  })

  it('is named for its button', () => {
    expect(development.label).toBe('Development tour')
  })

  it('stays out of the workspace tours', () => {
    for (const tour of [personal, shared]) {
      expect(tour.steps.some(step => step.target.startsWith('dev-'))).toBe(
        false,
      )
    }
  })
})

describe('copy that would be untrue of OnTask', () => {
  it('never mentions a light/dark theme, which OnTask does not have', () => {
    for (const tour of tours) {
      for (const step of tour.steps) {
        const text = `${step.title} ${step.description} ${step.hint ?? ''}`
        expect(text).not.toMatch(/dark|light mode|night/i)
      }
    }
  })
})

describe('tourIdForWorkspace', () => {
  it('gives a personal workspace the personal tour', () => {
    expect(tourIdForWorkspace('personal')).toBe('personal-workspace')
  })

  it('gives a shared workspace the shared tour', () => {
    expect(tourIdForWorkspace('shared')).toBe('shared-workspace')
  })
})
