import { ReactNode } from 'react'

// The floating panel under a trigger, plus the invisible full-screen layer
// behind it that closes it on an outside click. Render it as a sibling of the
// trigger inside a `relative` wrapper. Size and padding come from the caller
// (an account menu is w-52, an assignee list w-56). `placement="above"` opens
// it upwards, for a trigger near the bottom of a dialog or the screen.
export function DropdownPanel({
  onClose,
  align = 'right',
  placement = 'below',
  className = '',
  children,
}: {
  onClose: () => void
  align?: 'left' | 'right'
  placement?: 'below' | 'above'
  className?: string
  children: ReactNode
}) {
  const horizontal = align === 'right' ? 'right-0' : 'left-0'
  const origin =
    placement === 'above'
      ? align === 'right'
        ? 'origin-bottom-right'
        : 'origin-bottom-left'
      : align === 'right'
        ? 'origin-top-right'
        : 'origin-top-left'

  return (
    <>
      <button
        aria-hidden
        tabIndex={-1}
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <div
        className={`absolute ${horizontal} ${origin} ${placement === 'above' ? 'bottom-full mb-2' : 'mt-2'} z-50 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-panel shadow-xl animate-[dropdownIn_140ms_ease-out] ${className}`}
      >
        {children}
      </div>
    </>
  )
}
