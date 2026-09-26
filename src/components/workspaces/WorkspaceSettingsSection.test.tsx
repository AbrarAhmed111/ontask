import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceSettingsSection } from '@/components/workspaces/WorkspaceSettingsSection'
import type { Workspace } from '@/types/workspace'

const noop = () => {}

const workspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 'w1',
  slug: 'design-team',
  type: 'shared',
  name: 'Design Team',
  description: 'Where we design',
  ownerId: 'u1',
  timezone: 'Europe/London',
  reportTime: '09:00:00',
  dailyReportsEnabled: true,
  developmentEnabled: false,
  accent: 'ocean',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...overrides,
})

const render = (
  props: Partial<Parameters<typeof WorkspaceSettingsSection>[0]> = {},
) =>
  renderToStaticMarkup(
    <WorkspaceSettingsSection
      ready
      workspace={workspace()}
      canManage
      preferences={{
        ready: true,
        soundEnabled: true,
        onSoundEnabledChange: noop,
      }}
      onEdit={noop}
      {...props}
    />,
  )

describe('WorkspaceSettingsSection', () => {
  it('renders settings as tabbed sections', () => {
    const html = render()
    expect(html).toContain('role="tablist"')
    expect(html).toContain('Workspace')
    expect(html).toContain('Preferences')
  })

  it('centres the page like the other workspace pages, without stretching cards', () => {
    const html = render()
    expect(html).toContain('mx-auto')
    expect(html).toContain('max-w-6xl')
    expect(html).toContain('space-y-5')
  })

  it('offers editing the workspace to its owner only', () => {
    expect(render({ canManage: true })).toContain('>Edit<')
    expect(render({ canManage: false })).not.toContain('>Edit<')
  })

  it("still shows a member the workspace's details, read-only", () => {
    const html = render({ canManage: false })
    expect(html).toContain('Design Team')
    expect(html).toContain('Europe/London')
    expect(html).toContain('Ocean')
  })

  it('gives every member their own preferences, owner or not', () => {
    for (const canManage of [true, false]) {
      const html = render({ canManage, activeTab: 'preferences-settings' })
      expect(html).toContain('Your preferences')
      expect(html).toContain('Completion sound')
    }
  })

  it('reflects the saved completion-sound preference', () => {
    const on = render({
      activeTab: 'preferences-settings',
      preferences: {
        ready: true,
        soundEnabled: true,
        onSoundEnabledChange: noop,
      },
    })
    const off = render({
      activeTab: 'preferences-settings',
      preferences: {
        ready: true,
        soundEnabled: false,
        onSoundEnabledChange: noop,
      },
    })
    expect(on).toContain('checked=""')
    expect(off).not.toContain('checked=""')
  })

  it("disables the preference until it has loaded, so the default can't be saved over it", () => {
    const html = render({
      activeTab: 'preferences-settings',
      preferences: {
        ready: false,
        soundEnabled: true,
        onSoundEnabledChange: noop,
      },
    })
    expect(html).toContain('disabled=""')
  })

  it('shows a personal workspace with its fixed name and no description', () => {
    const html = render({
      isPersonal: true,
      workspace: workspace({ type: 'personal', name: 'anything' }),
    })
    expect(html).toContain('Personal Workspace settings')
    expect(html).toContain('Personal Workspace')
    expect(html).not.toContain('anything')
    expect(html).not.toContain('Description')
  })

  it('shows a shared workspace with its name and description', () => {
    const html = render()
    expect(html).toContain('Workspace details')
    expect(html).toContain('Description')
    expect(html).toContain('Where we design')
  })

  it('shows the full description without truncating it', () => {
    const html = render({
      workspace: workspace({
        description:
          'A longer workspace description that should wrap over multiple lines instead of disappearing behind an ellipsis.',
      }),
    })
    expect(html).toContain('whitespace-pre-wrap')
    expect(html).toContain('break-words')
    expect(html).toContain('A longer workspace description')
  })

  it('shows placeholders while the workspace is loading', () => {
    const html = render({ ready: false, workspace: null })
    expect(html).not.toContain('Timezone')
  })

  it('surfaces a save error inside the details card', () => {
    expect(render({ error: 'Could not save' })).toContain('Could not save')
  })

  describe('Help & guidance', () => {
    const guidance = { label: 'Shared Workspace tour', onReplay: noop }

    it('offers to replay the workspace tour, named for the workspace', () => {
      const html = render({ guidance, activeTab: 'guidance-settings' })
      expect(html).toContain('Help &amp; guidance')
      expect(html).toContain('Replay Shared Workspace tour')
    })

    it('offers the Development tour when a workspace can have one', () => {
      const withDevelopment = render({
        guidance: { ...guidance, onDevelopmentTour: noop },
        activeTab: 'guidance-settings',
      })
      expect(withDevelopment).toContain('Development Section guide')
      expect(withDevelopment).toContain('Start Development tour')
      expect(
        render({ guidance, activeTab: 'guidance-settings' }),
      ).not.toContain('Start Development tour')
    })

    it('leaves the card out when there is no tour to replay', () => {
      expect(render({ activeTab: 'guidance-settings' })).not.toContain(
        'Help &amp; guidance',
      )
    })

    it('is offered to every member, not only the owner', () => {
      expect(
        render({ canManage: false, guidance, activeTab: 'guidance-settings' }),
      ).toContain('Replay Shared Workspace tour')
    })

    it("waits for the workspace to load, since the tour can't start without it", () => {
      const loading = render({
        ready: false,
        workspace: null,
        canManage: false,
        guidance,
        activeTab: 'guidance-settings',
      })
      const loaded = render({
        canManage: false,
        guidance,
        activeTab: 'guidance-settings',
      })
      expect(loading).toContain('disabled=""')
      expect(loaded).not.toContain('disabled=""')
    })
  })
})

describe('WorkspaceSettingsSection — Daily Reports', () => {
  // The completion sound is switched off here so that a `checked=""` in the
  // markup can only be the Daily Reports switch.
  const quiet = { ready: true, soundEnabled: false, onSoundEnabledChange: noop }
  const daily = { saving: false, onChange: noop }
  const renderDaily = (
    props: Partial<Parameters<typeof WorkspaceSettingsSection>[0]> = {},
  ) =>
    render({
      preferences: quiet,
      dailyReports: daily,
      activeTab: 'reports-settings',
      ...props,
    })

  it('offers the switch on its own card', () => {
    const html = renderDaily()
    expect(html).toContain('Daily Reports')
    expect(html).toContain('AI Daily Report')
  })

  it('leaves the card out when the page does not offer it', () => {
    expect(render({ activeTab: 'reports-settings' })).not.toContain(
      'AI Daily Report',
    )
  })

  it('reflects whether reports are on, for a shared workspace', () => {
    expect(
      renderDaily({ workspace: workspace({ dailyReportsEnabled: true }) }),
    ).toContain('checked=""')
    expect(
      renderDaily({ workspace: workspace({ dailyReportsEnabled: false }) }),
    ).not.toContain('checked=""')
  })

  it('shows a personal workspace that has not opted in as off', () => {
    const html = renderDaily({
      isPersonal: true,
      workspace: workspace({ type: 'personal', dailyReportsEnabled: false }),
    })
    expect(html).not.toContain('checked=""')
    expect(html).toContain('A short written summary of your work,')
    expect(html).toContain('Turn this on to start receiving a Daily Report')
  })

  it('lets the owner change it, and only the owner', () => {
    const disabledFor = (canManage: boolean) => {
      const html = renderDaily({ canManage })
      // the only checkbox that is disabled here is the Daily Reports one
      return html.includes('disabled=""')
    }
    expect(disabledFor(true)).toBe(false)
    expect(disabledFor(false)).toBe(true)
    expect(renderDaily({ canManage: false })).toContain(
      'Only the workspace owner can change this.',
    )
  })

  it('locks the switch while a change is being saved', () => {
    expect(
      renderDaily({ dailyReports: { saving: true, onChange: noop } }),
    ).toContain('disabled=""')
  })

  it('explains what turning it off does, without promising to delete anything', () => {
    const html = renderDaily({
      workspace: workspace({ dailyReportsEnabled: true }),
    })
    expect(html).toContain('hides the Daily Report and stops new reports')
    expect(html).toContain('Reports already written are kept.')
  })

  it('shows the report time it will run at', () => {
    expect(renderDaily()).toContain('9:00 AM')
  })
})

describe('WorkspaceSettingsSection — Modules', () => {
  const modules = { saving: false, onDevelopmentChange: noop }

  it('lets the owner switch Development on in a shared workspace', () => {
    const html = render({ modules, activeTab: 'modules-settings' })
    expect(html).toContain('Modules')
    expect(html).toContain('Development')
    expect(html).not.toMatch(/type="checkbox"[^>]*disabled/)
  })

  it('shows a member the switch read-only', () => {
    const html = render({
      modules,
      canManage: false,
      activeTab: 'modules-settings',
    })
    expect(html).toMatch(/type="checkbox"[^>]*disabled/)
    expect(html).toContain('Only the workspace owner can change this.')
  })

  it('has no Modules card in a personal workspace', () => {
    const html = render({
      modules,
      isPersonal: true,
      workspace: workspace({ type: 'personal' }),
      activeTab: 'modules-settings',
    })
    expect(html).not.toContain('Modules')
  })

  it('shows the GitHub card only while Development is on', () => {
    expect(
      render({ modules, activeTab: 'integrations-settings' }),
    ).not.toContain('>GitHub<')
    const on = render({
      modules,
      workspace: workspace({ developmentEnabled: true }),
      activeTab: 'integrations-settings',
    })
    expect(on).toContain('GitHub')
  })
})
