import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Modal } from '@/components/ui/Modal'
import { ResourceCard } from '@/components/resources/ResourceCard'
import {
  ResourcePreview,
  SheetVisual,
  TextVisual,
} from '@/components/resources/ResourcePreview'
import { ResourcesPanel } from '@/components/resources/ResourcesModal'
import { UploadQueue } from '@/components/resources/UploadQueue'
import { IMAGE_PREVIEW_MAX_BYTES, resourcePreviewUrl } from '@/lib/resources'
import { UploadItem } from '@/lib/resourceUploads'
import { WorkspaceResource } from '@/types/workspace'

const resource = (
  fileName: string,
  fileType = 'application/octet-stream',
  overrides: Partial<WorkspaceResource> = {},
): WorkspaceResource => ({
  id: `id-${fileName}`,
  workspaceId: 'ws',
  goalId: null,
  uploadedBy: 'user-1',
  fileName,
  fileType,
  fileSize: 2048,
  storagePath: `ws/id-${fileName}`,
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const getSignedUrl = async () => null

const renderCard = (
  file: WorkspaceResource,
  props: { canDelete?: boolean } = {},
) =>
  renderToStaticMarkup(
    <ResourceCard
      resource={file}
      canDelete={props.canDelete ?? true}
      getSignedUrl={getSignedUrl}
      onDelete={() => {}}
    />,
  )

const renderPreview = (file: WorkspaceResource) =>
  renderToStaticMarkup(
    <ResourcePreview resource={file} getSignedUrl={getSignedUrl} />,
  )

describe('ResourceCard layout', () => {
  const longName = `${'quarterly-report-final-FINAL-v2-'.repeat(6)}.pdf`
  const html = renderCard(resource(longName, 'application/pdf'))

  it('is one contained card that clips and can shrink', () => {
    expect(html.startsWith('<li')).toBe(true)
    expect(html.endsWith('</li>')).toBe(true)
    const root = html.slice(0, html.indexOf('>') + 1)
    expect(root).toContain('min-w-0')
    expect(root).toContain('overflow-hidden')
    expect(root).toContain('flex-col')
  })

  it('truncates a long filename instead of letting it widen the card', () => {
    const nameTag = html.match(/<p class="[^"]*font-bold[^"]*"[^>]*>/)?.[0]
    expect(nameTag).toBeDefined()
    expect(nameTag).toContain('truncate')
    // The full name is still reachable.
    expect(nameTag).toContain(`title="${longName}"`)
  })

  it('keeps every metadata row on one line', () => {
    const truncatedRows = html.match(/<p class="[^"]*truncate[^"]*"/g) ?? []
    // filename, type · size, uploader · time
    expect(truncatedRows).toHaveLength(3)
  })

  it('keeps the action row shrinkable, with fixed-size icon buttons', () => {
    const actionRow = html.slice(html.indexOf('mt-auto'))
    expect(actionRow.slice(0, actionRow.indexOf('>'))).toContain('min-w-0')
    // Preview flexes and truncates; Download and Delete never squeeze.
    expect(html).toMatch(
      /aria-label="Preview [^"]*"[^>]*class="[^"]*min-w-0 flex-1/,
    )
    expect(html).toMatch(
      /aria-label="Download [^"]*"[^>]*class="[^"]*w-8 shrink-0/,
    )
    expect(html).toMatch(
      /aria-label="Delete [^"]*"[^>]*class="[^"]*w-8 shrink-0/,
    )
  })

  it('puts Delete inside the card, in the footer, after the filename', () => {
    const deleteAt = html.indexOf('aria-label="Delete ')
    expect(deleteAt).toBeGreaterThan(html.indexOf(longName))
    expect(deleteAt).toBeLessThan(html.lastIndexOf('</li>'))
  })

  it('cannot trigger Preview from Delete: no button lives in the clickable preview', () => {
    const previewStart = html.indexOf('cursor-pointer')
    const bodyStart = html.indexOf('flex min-w-0 flex-1 flex-col gap-3 p-3')
    expect(previewStart).toBeGreaterThan(-1)
    expect(bodyStart).toBeGreaterThan(previewStart)
    expect(html.slice(previewStart, bodyStart)).not.toContain('<button')
  })
})

describe('ResourceCard actions', () => {
  it('labels every action with the file it acts on', () => {
    const html = renderCard(resource('notes.txt', 'text/plain'))
    expect(html).toContain('aria-label="Preview notes.txt"')
    expect(html).toContain('aria-label="Download notes.txt"')
    expect(html).toContain('aria-label="Delete notes.txt"')
  })

  it('shows Delete only to people allowed to delete', () => {
    const file = resource('notes.txt', 'text/plain')
    expect(renderCard(file, { canDelete: true })).toContain(
      'aria-label="Delete ',
    )
    expect(renderCard(file, { canDelete: false })).not.toContain(
      'aria-label="Delete ',
    )
  })

  it('makes every action keyboard-focusable with a visible focus style', () => {
    const html = renderCard(resource('notes.txt', 'text/plain'))
    const buttons = html.match(/<button[^>]*>/g) ?? []
    expect(buttons).toHaveLength(3)
    for (const button of buttons) {
      expect(button).toContain('type="button"')
      expect(button).toContain('focus-visible:ring-2')
      expect(button).not.toContain('tabindex="-1"')
    }
  })

  it('shows the file type and size', () => {
    const html = renderCard(
      resource('deck.pptx', 'application/vnd.ms-powerpoint', {
        fileSize: 2.4 * 1024 * 1024,
      }),
    )
    expect(html).toContain('PPTX')
    expect(html).toContain('2.4 MB')
  })

  it('opens Office documents through a document viewer instead of the raw download URL', () => {
    const signed =
      'https://storage.example.test/object/sign/ws/report.docx?token=abc'
    const preview = resourcePreviewUrl(
      signed,
      'report.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )

    expect(preview).toContain('view.officeapps.live.com')
    expect(preview).toContain(encodeURIComponent(signed))
    expect(resourcePreviewUrl(signed, 'spec.pdf', 'application/pdf')).toBe(
      signed,
    )
  })
})

describe('ResourcePreview by file type', () => {
  it('shows a loading skeleton, not a broken image, before an image loads', () => {
    const html = renderPreview(resource('photo.jpg', 'image/jpeg'))
    expect(html).toContain('animate-pulse')
    expect(html).not.toContain('<img')
  })

  it('uses the file-type visual for an image too big to be worth loading', () => {
    const html = renderPreview(
      resource('huge.png', 'image/png', {
        fileSize: IMAGE_PREVIEW_MAX_BYTES + 1,
      }),
    )
    expect(html).not.toContain('animate-pulse')
    expect(html).toContain('PNG')
  })

  it('draws a document page for a PDF', () => {
    const html = renderPreview(resource('spec.pdf', 'application/pdf'))
    expect(html).toContain('aspect-[3/4]')
    expect(html).toContain('bg-rose-500')
    expect(html).toContain('>PDF<')
  })

  it('draws a document page for Word files, labelled by extension', () => {
    const docx = renderPreview(
      resource(
        'requirements.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    )
    expect(docx).toContain('aspect-[3/4]')
    expect(docx).toContain('bg-blue-500')
    expect(docx).toContain('>DOCX<')
    expect(renderPreview(resource('old.doc', 'application/msword'))).toContain(
      '>DOC<',
    )
  })

  it('draws a spreadsheet grid for Excel files', () => {
    const html = renderPreview(
      resource(
        'students.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    )
    for (const letter of ['A', 'B', 'C', 'D'])
      expect(html).toContain(`>${letter}<`)
    expect(html).toContain('>XLSX<')
    expect(html).toContain('bg-emerald')
  })

  it('draws a slide for PowerPoint files', () => {
    const html = renderPreview(
      resource('deck.pptx', 'application/vnd.ms-powerpoint'),
    )
    expect(html).toContain('aspect-video')
    expect(html).toContain('bg-orange-500')
    expect(html).toContain('>PPTX<')
  })

  it('shows a skeleton while a text or CSV sample loads', () => {
    expect(renderPreview(resource('notes.txt', 'text/plain'))).toContain(
      'animate-pulse',
    )
    expect(renderPreview(resource('students.csv', 'text/csv'))).toContain(
      'animate-pulse',
    )
  })

  it('does not read a text or CSV file that is too large', () => {
    const html = renderPreview(
      resource('dump.csv', 'text/csv', { fileSize: 50 * 1024 * 1024 }),
    )
    expect(html).not.toContain('animate-pulse')
    expect(html).toContain('>CSV<')
  })

  it('falls back to a generic file tile for anything else', () => {
    const html = renderPreview(resource('bundle.zip', 'application/zip'))
    expect(html).toContain('>ZIP<')
    expect(html).toContain('<svg')
  })

  it('reserves the same 4:3 tile for every type, so cards line up', () => {
    for (const file of [
      resource('a.pdf', 'application/pdf'),
      resource('a.png', 'image/png'),
      resource('a.xlsx', 'application/vnd.ms-excel'),
      resource('a.zip', 'application/zip'),
    ])
      expect(renderPreview(file)).toContain('aspect-[4/3]')
  })
})

describe('sampled previews', () => {
  it('renders real CSV cells under column letters', () => {
    const html = renderToStaticMarkup(
      <SheetVisual
        kind="csv"
        label="CSV"
        rows={[
          ['Name', 'Status'],
          ['Ada', 'Active'],
        ]}
      />,
    )
    expect(html).toContain('>Name<')
    expect(html).toContain('>Active<')
    expect(html).toContain('>A<')
    expect(html).toContain('>B<')
    expect(html).not.toContain('>C<')
  })

  it('renders real lines of a text file', () => {
    const html = renderToStaticMarkup(
      <TextVisual kind="text" label="TXT" lines={['# Notes', 'first line']} />,
    )
    expect(html).toContain('# Notes')
    expect(html).toContain('first line')
    expect(html).toContain('>TXT<')
  })
})

describe('ResourcesPanel', () => {
  const baseProps = {
    members: [],
    userId: 'user-1',
    isOwner: false,
    loading: false,
    uploads: [] as UploadItem[],
    onUpload: () => {},
    onDismissUploads: () => {},
    onRequestDelete: () => {},
    getSignedUrl,
  }
  const render = (props: Partial<Parameters<typeof ResourcesPanel>[0]> = {}) =>
    renderToStaticMarkup(
      <ResourcesPanel resources={[]} {...baseProps} {...props} />,
    )

  it('lets the file picker take several files at once', () => {
    expect(render()).toMatch(/<input[^>]*type="file"[^>]*multiple=""/)
  })

  it('offers "Add Resources" and a labelled search box', () => {
    const html = render()
    expect(html).toContain('Add Resources')
    expect(html).toContain('aria-label="Search resources"')
  })

  it('shows a skeleton grid while loading, not a blank modal', () => {
    const html = render({ loading: true })
    expect(html).toContain('aria-busy="true"')
    expect(html.match(/aspect-\[4\/3\] animate-pulse/g)).toHaveLength(8)
    expect(html).not.toContain('No resources yet')
  })

  it('keeps the empty-state concept, with an action', () => {
    const html = render()
    expect(html).toContain('No resources yet')
    expect(html).toContain('Add documents, images and other files.')
    // toolbar button + the empty-state button
    expect(html.match(/Add Resources/g)).toHaveLength(2)
  })

  it('lays cards out on a responsive grid that never squeezes them', () => {
    const html = render({
      resources: [
        resource('a.pdf', 'application/pdf'),
        resource('b.png', 'image/png'),
      ],
    })
    expect(html).toContain('grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]')
    expect(html.match(/<li/g)).toHaveLength(2)
  })

  it('scrolls only the resource grid, leaving the toolbar fixed', () => {
    const html = render({ resources: [resource('a.pdf', 'application/pdf')] })
    const scroller = html.indexOf('overflow-y-auto')
    expect(scroller).toBeGreaterThan(html.indexOf('Search resources'))
    expect(scroller).toBeGreaterThan(html.indexOf('Filter by type'))
    // Exactly one scrolling region.
    expect(html.match(/overflow-y-auto/g)).toHaveLength(1)
    expect(html.slice(scroller - 80, scroller + 120)).toContain('flex-1')
  })

  it('shows the upload queue and blocks a second batch while uploading', () => {
    const uploads: UploadItem[] = [
      {
        id: '1',
        fileName: 'requirements.docx',
        fileSize: 1,
        status: 'uploading',
      },
      { id: '2', fileName: 'architecture.png', fileSize: 1, status: 'done' },
    ]
    const html = render({ uploads })
    expect(html).toContain('Uploading resources')
    expect(html).toContain('requirements.docx')
    expect(html).toContain('architecture.png')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Add Resources/)
  })
})

describe('UploadQueue', () => {
  const items: UploadItem[] = [
    {
      id: '1',
      fileName: 'requirements.docx',
      fileSize: 1,
      status: 'uploading',
    },
    {
      id: '2',
      fileName: 'students.xlsx',
      fileSize: 1,
      status: 'error',
      error: 'Too large',
    },
    { id: '3', fileName: 'architecture.png', fileSize: 1, status: 'done' },
  ]

  it('shows per-file state', () => {
    const html = renderToStaticMarkup(
      <UploadQueue items={items} onDismiss={() => {}} />,
    )
    expect(html).toContain('Uploading…')
    expect(html).toContain('Too large')
    expect(html).toContain('Uploaded')
  })

  it('announces progress politely', () => {
    const html = renderToStaticMarkup(
      <UploadQueue items={items} onDismiss={() => {}} />,
    )
    expect(html).toContain('role="status"')
  })

  it('offers Dismiss only once nothing is still uploading', () => {
    const render = (list: UploadItem[]) =>
      renderToStaticMarkup(<UploadQueue items={list} onDismiss={() => {}} />)
    expect(render(items)).not.toContain('Dismiss')
    expect(render(items.slice(1))).toContain('Dismiss')
  })

  it('keeps long names from widening the row', () => {
    const html = renderToStaticMarkup(
      <UploadQueue
        items={[
          {
            id: '1',
            fileName: `${'x'.repeat(200)}.pdf`,
            fileSize: 1,
            status: 'uploading',
          },
        ]}
        onDismiss={() => {}}
      />,
    )
    expect(html).toMatch(/class="[^"]*min-w-0 flex-1 truncate/)
  })

  it('renders nothing when the queue is empty', () => {
    expect(
      renderToStaticMarkup(<UploadQueue items={[]} onDismiss={() => {}} />),
    ).toBe('')
  })
})

describe('Modal', () => {
  // Modals portal into <body>, which doesn't exist while rendering on the
  // server: they must render nothing there rather than throw. (Where the
  // dialog lands, and what it stacks over, needs a real browser.)
  it('renders nothing on the server instead of throwing', () => {
    expect(
      renderToStaticMarkup(
        <Modal title="Resources" onClose={() => {}}>
          body
        </Modal>,
      ),
    ).toBe('')
    expect(
      renderToStaticMarkup(
        <ConfirmModal
          title="Delete?"
          message="Sure?"
          confirmLabel="Delete"
          onConfirm={() => {}}
          onClose={() => {}}
        />,
      ),
    ).toBe('')
  })
})
