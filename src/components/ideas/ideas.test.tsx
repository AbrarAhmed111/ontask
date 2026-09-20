import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IdeaCard } from '@/components/ideas/IdeaCard'
import { IdeaSelect } from '@/components/ideas/IdeaSelect'
import { IdeaFormModal } from '@/components/ideas/IdeaFormModal'
import type { Idea, WorkspaceMember } from '@/types/workspace'

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    title,
    children,
  }: {
    title: string
    children: React.ReactNode
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}))

const makeIdea = (overrides: Partial<Idea> = {}): Idea => ({
  id: 'idea-1',
  workspaceId: 'ws-1',
  title: 'Add Calendar Booking to Cold DM System',
  description:
    'Allow prospects to book a slot directly from automated messages',
  type: 'important',
  status: 'open',
  createdBy: 'user-abrar',
  createdAt: '2026-09-20T10:00:00Z',
  updatedAt: '2026-09-20T10:00:00Z',
  archivedAt: null,
  creditedUserIds: ['user-iqra'],
  taskCount: 2,
  goalCount: 1,
  ...overrides,
})

const members: WorkspaceMember[] = [
  {
    id: 'mem-1',
    workspaceId: 'ws-1',
    userId: 'user-abrar',
    role: 'owner',
    joinedAt: '2026-09-01T00:00:00Z',
    fullName: 'Abrar Ahmed',
    email: 'abrar@example.com',
    avatarUrl: null,
  },
  {
    id: 'mem-2',
    workspaceId: 'ws-1',
    userId: 'user-iqra',
    role: 'member',
    joinedAt: '2026-09-02T00:00:00Z',
    fullName: 'Iqra Khan',
    email: 'iqra@example.com',
    avatarUrl: null,
  },
]

describe('IdeaCard', () => {
  it('renders title, description, type badge, status, credited members, and linked execution', () => {
    const idea = makeIdea()
    const html = renderToStaticMarkup(
      <IdeaCard
        idea={idea}
        members={members}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(html).toContain('Add Calendar Booking to Cold DM System')
    expect(html).toContain('Important')
    expect(html).toContain('Open')
    expect(html).toContain('Credits to:')
    expect(html).toContain('Iqra')
    expect(html).toContain('Linked execution: 2 Tasks · 1 Goal')
  })

  it('shows fallback text when no linked execution exists', () => {
    const idea = makeIdea({ taskCount: 0, goalCount: 0 })
    const html = renderToStaticMarkup(
      <IdeaCard
        idea={idea}
        members={members}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
        onUnarchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(html).toContain('No linked execution yet')
  })
})

describe('IdeaSelect', () => {
  it('renders option elements for active ideas only', () => {
    const activeIdea = makeIdea({
      id: 'idea-active',
      title: 'Active Idea',
      status: 'open',
    })
    const archivedIdea = makeIdea({
      id: 'idea-archived',
      title: 'Archived Idea',
      status: 'archived',
    })

    const html = renderToStaticMarkup(
      <IdeaSelect
        ideas={[activeIdea, archivedIdea]}
        value=""
        onChange={vi.fn()}
      />,
    )

    expect(html).toContain('No reference idea')
    expect(html).toContain('Active Idea')
    expect(html).not.toContain('Archived Idea')
  })
})

describe('IdeaFormModal', () => {
  it('renders modal with initial title and member choices', () => {
    const idea = makeIdea()
    const html = renderToStaticMarkup(
      <IdeaFormModal
        initial={idea}
        members={members}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(html).toContain('Edit Idea')
    expect(html).toContain('Add Calendar Booking to Cold DM System')
    expect(html).toContain('Iqra Khan')
  })
})
