export type ResourceCategory = 'documents' | 'images' | 'pdfs' | 'other'

export function categorize(fileType: string): ResourceCategory {
  if (fileType === 'application/pdf') return 'pdfs'
  if (fileType.startsWith('image/')) return 'images'
  if (
    fileType.includes('word') ||
    fileType.includes('document') ||
    fileType.includes('sheet') ||
    fileType.includes('excel') ||
    fileType.includes('presentation') ||
    fileType.includes('powerpoint') ||
    fileType === 'text/plain' ||
    fileType === 'text/csv'
  )
    return 'documents'
  return 'other'
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── File type recognition (drives the card preview) ─────────────────────────
// `categorize` above is the coarse Documents/Images/PDFs/Other *filter*; this
// is the finer kind a card draws. The extension is checked first because the
// browser-reported MIME type is unreliable for exactly the files people
// upload most: Windows reports a .csv as `application/vnd.ms-excel`, and a
// .md is usually an empty type (stored as application/octet-stream).

export type PreviewKind =
  'image' | 'pdf' | 'word' | 'excel' | 'csv' | 'powerpoint' | 'text' | 'other'

const EXTENSION_KINDS: Record<string, PreviewKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  svg: 'image',
  pdf: 'pdf',
  doc: 'word',
  docx: 'word',
  odt: 'word',
  rtf: 'word',
  xls: 'excel',
  xlsx: 'excel',
  ods: 'excel',
  csv: 'csv',
  tsv: 'csv',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  odp: 'powerpoint',
  txt: 'text',
  md: 'text',
  markdown: 'text',
  log: 'text',
  json: 'text',
  yml: 'text',
  yaml: 'text',
}

// Lower-cased extension without the dot; '' for no extension or a bare
// dotfile such as ".env".
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

export function getPreviewKind(
  fileName: string,
  fileType: string,
): PreviewKind {
  const byExtension = EXTENSION_KINDS[fileExtension(fileName)]
  if (byExtension) return byExtension

  if (fileType.startsWith('image/')) return 'image'
  if (fileType === 'application/pdf') return 'pdf'
  if (fileType === 'text/csv' || fileType === 'text/tab-separated-values')
    return 'csv'
  if (fileType.includes('word')) return 'word'
  if (fileType.includes('excel') || fileType.includes('spreadsheet'))
    return 'excel'
  if (fileType.includes('powerpoint') || fileType.includes('presentation'))
    return 'powerpoint'
  if (fileType.startsWith('text/')) return 'text'
  return 'other'
}

const DOCUMENT_VIEWER_BASE = 'https://view.officeapps.live.com/op/view.aspx'

export function resourcePreviewUrl(
  signedUrl: string,
  fileName: string,
  fileType: string,
): string {
  const kind = getPreviewKind(fileName, fileType)
  if (kind === 'word' || kind === 'excel' || kind === 'powerpoint') {
    return `${DOCUMENT_VIEWER_BASE}?src=${encodeURIComponent(signedUrl)}`
  }
  return signedUrl
}

// Short uppercase label for the metadata line and the type badge ("DOCX").
export function resourceTypeLabel(fileName: string): string {
  const extension = fileExtension(fileName)
  return extension && extension.length <= 5 ? extension.toUpperCase() : 'FILE'
}

// Signs a storage path for a short-lived URL. `download` asks the server to
// send the file as an attachment under that name (a plain link to a
// cross-origin file ignores the HTML download attribute).
export type SignedUrlGetter = (
  storagePath: string,
  options?: { download?: string },
) => Promise<string | null>

// ── Preview loading budgets ─────────────────────────────────────────────────
// A card only ever shows a small thumbnail, so files past these sizes keep the
// file-type visual instead of being pulled over the network just to be drawn
// at ~190px wide.
export const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024
export const TEXT_PREVIEW_MAX_BYTES = 5 * 1024 * 1024
// How much of a text/CSV file is read for its few-line sample.
export const TEXT_SAMPLE_BYTES = 4096

export function canPreviewContent(
  kind: PreviewKind,
  fileSize: number,
): 'image' | 'text' | null {
  if (kind === 'image' && fileSize <= IMAGE_PREVIEW_MAX_BYTES) return 'image'
  if ((kind === 'text' || kind === 'csv') && fileSize <= TEXT_PREVIEW_MAX_BYTES)
    return 'text'
  return null
}

// Reads at most `maxBytes` from a response and cancels the rest of the
// transfer, so a server that ignores Range (or a huge file) never gets
// downloaded in full just to draw a thumbnail. Returns null when the body
// isn't usable.
export async function readTextSample(
  response: Response,
  maxBytes: number = TEXT_SAMPLE_BYTES,
): Promise<string | null> {
  if (!response.ok || !response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.byteLength
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  const bytes = new Uint8Array(Math.min(received, maxBytes))
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= bytes.length) break
    const slice = chunk.subarray(0, bytes.length - offset)
    bytes.set(slice, offset)
    offset += slice.length
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function looksBinary(text: string): boolean {
  if (text.includes('\u0000')) return true
  let replacements = 0
  for (const char of text) if (char === '\ufffd') replacements++
  // A cut multi-byte character at the end of the sample yields one; a real
  // binary file yields lots.
  return replacements > Math.max(2, text.length * 0.02)
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

// The first few non-empty lines of a text file, each clipped so a minified
// one-liner can't blow up the thumbnail. null = not text after all.
export function sampleTextLines(
  text: string,
  maxLines = 7,
  maxChars = 64,
): string[] | null {
  const clean = stripBom(text)
  if (looksBinary(clean)) return null
  return clean
    .split(/\r?\n/)
    .map(line => line.replace(/\s+$/, ''))
    .filter(line => line.trim() !== '')
    .slice(0, maxLines)
    .map(line => line.slice(0, maxChars))
}

// A small leading block of a CSV/TSV, quote-aware (a quoted cell may contain
// the delimiter or a newline). Only the first `maxRows` rows and `maxCols`
// columns are kept. null = not text after all.
export function parseCsvSample(
  text: string,
  maxRows = 4,
  maxCols = 4,
  maxCellChars = 24,
): string[][] | null {
  const clean = stripBom(text)
  if (looksBinary(clean)) return null

  const firstLine = clean.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [',', ';', '\t'].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length
      ? candidate
      : best,
  )

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  const endCell = () => {
    row.push(cell.slice(0, maxCellChars))
    cell = ''
  }
  const endRow = () => {
    endCell()
    if (row.some(value => value.trim() !== '')) rows.push(row)
    row = []
  }

  for (let i = 0; i < clean.length && rows.length < maxRows; i++) {
    const char = clean[i]
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      endCell()
    } else if (char === '\n') {
      endRow()
    } else if (char !== '\r') {
      cell += char
    }
  }
  // The sample may end mid-row (it is a byte-limited prefix), and a short
  // file may have no trailing newline.
  if (rows.length < maxRows && (cell !== '' || row.length > 0)) endRow()

  const columns = Math.min(
    maxCols,
    rows.reduce((widest, current) => Math.max(widest, current.length), 0),
  )
  if (rows.length === 0 || columns === 0) return []
  return rows.map(current =>
    Array.from({ length: columns }, (_, index) => current[index] ?? ''),
  )
}

// ── Storage path ────────────────────────────────────────────────────────────
// Convention (migration 0026): `{workspace_id}/{uuid}-{filename}`, so storage
// RLS can read membership from the first path segment. The original name is
// kept verbatim in the `file_name` column; only the path copy is normalised,
// because storage rejects keys with characters like accents, `#` or `?` --
// which in a multi-file upload would fail one file for reasons the user
// can't see.
export function storageFileName(fileName: string): string {
  const extension = fileExtension(fileName).replace(/[^a-z0-9]/g, '')
  const stem = extension
    ? fileName.slice(0, fileName.lastIndexOf('.'))
    : fileName
  const safeStem = stem
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 80)
  return `${safeStem || 'file'}${extension ? `.${extension.slice(0, 10)}` : ''}`
}

export function buildStoragePath(
  workspaceId: string,
  id: string,
  fileName: string,
): string {
  return `${workspaceId}/${id}-${storageFileName(fileName)}`
}

// ── Deleting ────────────────────────────────────────────────────────────────
// What a failed delete_workspace_resource() call means for the user. The RPC
// raises plain messages for the cases it knows about; anything else (a
// missing function, a storage error, the network) is just "couldn't".
export function classifyDeleteError(error: unknown): {
  // The row was already gone (someone else deleted it): nothing to undo.
  alreadyGone: boolean
  message: string
} {
  const { message = '' } = (error ?? {}) as { message?: string }
  if (/resource not found/i.test(message))
    return { alreadyGone: true, message: 'That resource was already deleted.' }
  if (/not authorized/i.test(message))
    return {
      alreadyGone: false,
      message: 'Only the uploader or the workspace owner can delete this.',
    }
  return { alreadyGone: false, message: "Couldn't delete the resource." }
}
