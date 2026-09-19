import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { VisitorWelcomeModal } from '@/components/auth/VisitorWelcomeModal'

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ title, children }: { title: string; children: ReactNode }) => (
    <section role="dialog" aria-label={title}>
      <h1>{title}</h1>
      {children}
    </section>
  ),
}))

describe('VisitorWelcomeModal', () => {
  it('explains guest use and account benefits with both choices', () => {
    const html = renderToStaticMarkup(
      <VisitorWelcomeModal onContinue={() => {}} onLogin={() => {}} />,
    )

    expect(html).toContain('Welcome to OnTask')
    expect(html).toContain('no account required')
    expect(html).toContain('Continue as Guest')
    expect(html).toContain('Login / Sign Up')
    expect(html).toContain('Shared Workspaces')
    expect(html).toContain('Slack integration')
  })
})
