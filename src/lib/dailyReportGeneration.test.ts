import { describe, expect, it } from 'vitest'
import { normalizeDailyReportNarrative } from './dailyReportGeneration'
import { sharedSnapshot, snapshot } from './dailyReportTestData'

describe('normalizeDailyReportNarrative', () => {
  it('accepts the snapshot endpoint narrative shape from ontask-llm', () => {
    const narrative = normalizeDailyReportNarrative(
      {
        overall_summary: 'Abrar completed the reporting work.',
        members: [],
        workspace_changes_summary: '',
        highlights: ['Report generated'],
      },
      snapshot(),
    )

    expect(narrative).toMatchObject({
      overall_summary: 'Abrar completed the reporting work.',
      members: [],
      workspace_changes_summary: '',
      highlights: ['Report generated'],
    })
  })

  it('accepts one narrative per expected workspace member plus a summary', () => {
    const narrative = normalizeDailyReportNarrative(
      {
        members: [
          {
            user_id: 'user-abrar',
            narrative: 'Abrar worked on the booking flow.',
          },
        ],
        summary: 'The workspace progressed the booking work.',
      },
      snapshot(),
    )

    expect(narrative).toMatchObject({
      format_version: 2,
      summary: 'The workspace progressed the booking work.',
      members: [
        {
          user_id: 'user-abrar',
          name: 'Abrar Ahmed',
          narrative: 'Abrar worked on the booking flow.',
        },
      ],
    })
  })

  it('rejects missing, unknown, or fabricated member identities', () => {
    expect(
      normalizeDailyReportNarrative(
        {
          members: [{ user_id: 'user-abrar', narrative: 'Abrar worked.' }],
          summary: 'Summary.',
        },
        sharedSnapshot(),
      ),
    ).toBeNull()

    expect(
      normalizeDailyReportNarrative(
        {
          members: [
            { user_id: 'user-abrar', narrative: 'Abrar worked.' },
            { user_id: 'user-rachel', narrative: 'Rachel worked.' },
            { user_id: 'made-up', narrative: 'A fabricated person worked.' },
          ],
          summary: 'Summary.',
        },
        sharedSnapshot(),
      ),
    ).toBeNull()
  })

  it('rejects empty narratives and empty summaries', () => {
    expect(
      normalizeDailyReportNarrative(
        {
          members: [{ user_id: 'user-abrar', narrative: '' }],
          summary: 'Summary.',
        },
        snapshot(),
      ),
    ).toBeNull()
    expect(
      normalizeDailyReportNarrative(
        {
          members: [{ user_id: 'user-abrar', narrative: 'Abrar worked.' }],
          summary: ' ',
        },
        snapshot(),
      ),
    ).toBeNull()
  })
})
