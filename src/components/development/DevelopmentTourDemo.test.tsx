import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DevelopmentBoard } from '@/components/development/DevelopmentBoard'
import { DevelopmentTourDemo } from '@/components/development/DevelopmentTourDemo'
import {
  DEVELOPMENT_STAGES,
  developmentStage,
} from '@/lib/development/tracking'
import { buildDemoItems } from '@/lib/development/tourDemo'
import { TOURS } from '@/lib/tour/definitions'

describe('Development tour sample data', () => {
  const items = buildDemoItems(Date.parse('2026-09-26T12:00:00Z'))

  it('puts at least one task in every stage', () => {
    const stages = new Set(
      items.map(item => developmentStage(item.task, item.development)),
    )
    expect([...stages].sort()).toEqual([...DEVELOPMENT_STAGES].sort())
  })

  it('names branches the way a real task would be named', () => {
    const byTitle = new Map(
      items.map(item => [item.task.name, item.development.branchName]),
    )
    expect(byTitle.get('Fix login redirect loop')).toMatch(/^fix\//)
    expect(byTitle.get('Update webhook docs')).toMatch(/^docs\//)
    expect(byTitle.get('Redesign checkout page')).toMatch(/^feature\/.*-sara$/)
  })

  it('never uses ids a real row could have', () => {
    for (const { task } of items) expect(task.id).toMatch(/^demo-/)
  })
})

describe('DevelopmentTourDemo', () => {
  const html = renderToStaticMarkup(<DevelopmentTourDemo />)

  it('says it is sample data', () => {
    expect(html).toContain('Sample data')
  })

  it('carries every anchor the tour points at inside the section', () => {
    // The header and the New button belong to the section itself.
    const inSection = TOURS.development.steps
      .map(step => step.target)
      .filter(target => target !== 'dev-overview' && target !== 'dev-new-task')
    for (const target of inSection) {
      expect(html).toContain(`data-tour="${target}"`)
    }
  })

  it('shows a branch to create and a Pull Request at each later stage', () => {
    expect(html).toContain('git checkout -b feature/')
    expect(html).toContain('#128')
    expect(html).toContain('#121 merged')
  })
})

describe('DevelopmentBoard — Needs Attention', () => {
  const [first, second] = buildDemoItems(Date.parse('2026-09-26T12:00:00Z'))
  const open = { ...first.task, status: 'working' as const }
  const render = (branchDeletedAt: string | null) =>
    renderToStaticMarkup(
      <DevelopmentBoard
        items={[
          {
            task: open,
            development: {
              ...first.development,
              trackingStatus: 'branch_detected',
              branchDetectedAt: '2026-09-26T09:00:00Z',
              branchDeletedAt,
              prNumber: null,
              prState: null,
            },
          },
          second,
        ]}
        goals={[]}
        members={[]}
        onOpen={() => {}}
      />,
    )

  it('keeps a task that needs a person in its lifecycle column, with the reason', () => {
    const html = render('2026-09-26T10:00:00Z')
    expect(html).not.toContain('aria-label="Needs Attention"')
    expect(html).toContain('aria-label="In Development"')
    expect(html).toContain(
      'Tracked branch was deleted or is no longer accessible.',
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('animate-pulse')
    // Once, because Needs Attention is a card state rather than a duplicate lane.
    expect(html.split(open.name).length - 1).toBe(1)
  })

  it('shows no alert when nothing needs attention', () => {
    expect(render(null)).not.toContain('Needs Attention')
    expect(render(null)).not.toContain('role="alert"')
  })
})
