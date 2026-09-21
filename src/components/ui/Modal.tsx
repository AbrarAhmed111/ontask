'use client'

import {
  CSSProperties,
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { usePortalTheme } from '@/components/ui/PortalTheme'
import { lockBodyScroll } from '@/lib/scrollLock'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const SIZE_CLASSES = { md: 'max-w-md', lg: 'max-w-4xl' }

// The dialog is capped to the viewport so form actions never end up below the
// visible screen on short viewports. `fill` lets a child own the internal
// scrolling/pinning (see ResourcesModal); the default path scrolls the modal
// body while keeping the title row reachable.
// `100dvh` follows mobile/browser chrome; plain `100vh` is the fallback.
const FILL_CLASSES =
  'flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden pb-0 supports-[height:100dvh]:max-h-[calc(100dvh-2rem)]'
const DIALOG_CLASSES =
  'flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden supports-[height:100dvh]:max-h-[calc(100dvh-2rem)]'

// Open modals, oldest first. Only the topmost answers Escape and Tab, so a
// confirmation opened over another dialog closes by itself instead of taking
// the dialog underneath with it, and two focus traps never fight.
const openModals: symbol[] = []

type ModalProps = {
  title: string
  eyebrow?: string
  children: ReactNode
  onClose: () => void
  size?: 'md' | 'lg'
  fill?: boolean
}

// <body> exists only in the browser: on the server (and for the hydration
// pass) there is nowhere to portal to, so nothing is rendered until then.
const subscribeToNothing = () => () => {}
const getPortalHost = () => document.body
const getServerPortalHost = () => null

// The dialog is rendered through a portal into <body> rather than in place.
// Rendered in place it lived inside the page layout, so where it stacked was
// decided by every ancestor between it and the root -- the workspace content
// wrapper animates opacity (which makes a stacking context while it runs),
// and any transform/filter/isolation added there later would either trap the
// modal beneath the sticky z-30 header or re-anchor its `fixed inset-0`
// backdrop to that ancestor instead of the viewport. As a direct child of
// <body> its z-50 competes only with the root-level layers.
export function Modal(props: ModalProps) {
  const host = useSyncExternalStore(
    subscribeToNothing,
    getPortalHost,
    getServerPortalHost,
  )
  const theme = usePortalTheme()
  if (!host) return null
  return createPortal(<ModalDialog {...props} theme={theme} />, host)
}

function ModalDialog({
  title,
  eyebrow,
  children,
  onClose,
  size = 'md',
  fill = false,
  theme,
}: ModalProps & { theme?: CSSProperties }) {
  const dialogRef = useRef<HTMLElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  // Unique per open modal: a confirmation over another dialog would
  // otherwise share one `modal-title` id and be labelled by the wrong title.
  const titleId = useId()

  // Keep the latest onClose reachable without making it an effect
  // dependency — callers pass an inline function that gets a new identity
  // on every render (e.g. any re-render triggered by typing into a field
  // inside the modal), and re-running the effect below on every keystroke
  // would steal focus back to the dialog's first field each time.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useLayoutEffect(() => {
    const id = Symbol('modal')
    openModals.push(id)
    const releaseScroll = lockBodyScroll()
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null

    // Don't steal focus from a field that already autofocused itself (React
    // commits child effects, including the native `autofocus` attribute,
    // before this parent effect runs) — only take over if nothing inside
    // the dialog has focus yet.
    if (!dialogRef.current?.contains(document.activeElement)) {
      const focusables =
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(focusables?.[0] ?? dialogRef.current)?.focus()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== id) return
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusables = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ??
          [],
      )
      if (focusables.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement

      if (event.shiftKey) {
        if (active === first || !dialogRef.current?.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      openModals.splice(openModals.indexOf(id), 1)
      releaseScroll()
      const previouslyFocused = previouslyFocusedRef.current
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
    // Intentionally mount/unmount-only — see onCloseRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      style={theme}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm animate-[fadeIn_180ms_ease-out]"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${SIZE_CLASSES[size]} rounded-2xl border border-line bg-panel p-6 shadow-2xl outline-none animate-[modalIn_220ms_ease-out] ${fill ? FILL_CLASSES : DIALOG_CLASSES}`}
      >
        <div className="mb-6 flex shrink-0 items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow && (
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-coral">
                {eyebrow}
              </p>
            )}
            <h2
              id={titleId}
              className="text-xl font-bold tracking-tight text-ink"
            >
              {title}
            </h2>
          </div>
          <button
            aria-label="Close dialog"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-slate-100 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        {fill ? (
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        ) : (
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
            {children}
          </div>
        )}
      </section>
    </div>
  )
}
