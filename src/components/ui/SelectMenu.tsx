'use client'

import {
  KeyboardEvent,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { DropdownPanel } from '@/components/ui/DropdownPanel'

export type SelectMenuOption<T extends string> = {
  value: T
  label: string
  // A second, quieter line under the label in the list.
  description?: string
  // Shown before the label, in the list and on the closed trigger.
  icon?: ReactNode
}

// A single-choice picker that looks like the rest of OnTask rather than the
// browser's native <select>: the trigger shows the chosen option (icon and
// all), the list can carry a description per option, and it is a proper
// listbox -- Arrow keys, Home/End, Enter/Space to choose, Escape to close,
// and typing a letter jumps to the next option starting with it.
export function SelectMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  disabled = false,
  size = 'md',
  className = '',
}: {
  // Accessible name (the visible label lives with the caller's layout).
  label: string
  value: T
  options: SelectMenuOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  disabled?: boolean
  // `sm` for inline use (a field in a details grid), `md` for forms.
  size?: 'sm' | 'md'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [placement, setPlacement] = useState<'below' | 'above'>('below')
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const selectedIndex = options.findIndex(option => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  // Open upwards when the list (up to 16rem) wouldn't fit below the trigger
  // but would fit above -- e.g. the last field of a dialog.
  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    const needed = Math.min(256, options.length * 44) + 16
    setPlacement(
      rect &&
        window.innerHeight - rect.bottom < needed &&
        rect.top > window.innerHeight - rect.bottom
        ? 'above'
        : 'below',
    )
    setOpen(true)
  }

  useEffect(() => {
    if (open) {
      setActive(Math.max(0, selectedIndex))
      listRef.current?.focus()
    }
    // Only when opening: moving the highlight must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    close()
  }

  const onListKeyDown = (event: KeyboardEvent) => {
    const last = options.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive(index => Math.min(last, index + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive(index => Math.max(0, index - 1))
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(last)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        choose(active)
        break
      case 'Escape':
        // Close the list, not the dialog it sits in: Modal listens on
        // `document`, the same node React's own listener is on, so only
        // stopping the remaining listeners there keeps the dialog open.
        event.preventDefault()
        event.nativeEvent.stopImmediatePropagation()
        close()
        break
      case 'Tab':
        close(false)
        break
      default:
        if (event.key.length === 1) {
          const key = event.key.toLowerCase()
          const order = [
            ...options.slice(active + 1),
            ...options.slice(0, active + 1),
          ]
          const match = order.find(option =>
            option.label.toLowerCase().startsWith(key),
          )
          if (match) setActive(options.indexOf(match))
        }
    }
  }

  const onTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu()
    }
  }

  const trigger =
    size === 'sm'
      ? 'min-h-[30px] rounded-md px-2 py-1 text-xs'
      : 'min-h-[42px] rounded-lg px-3 py-2 text-sm'

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={`flex w-full items-center gap-2 border border-line bg-white text-left text-ink outline-none transition hover:border-sage focus-visible:border-sage focus-visible:ring-4 focus-visible:ring-sage/15 disabled:cursor-not-allowed disabled:opacity-50 ${trigger} ${
          open ? 'border-sage ring-4 ring-sage/15' : ''
        }`}
      >
        {selected?.icon && (
          <span className="flex shrink-0 items-center">{selected.icon}</span>
        )}
        <span
          className={`min-w-0 flex-1 truncate font-semibold ${selected ? '' : 'font-normal text-muted/70'}`}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <DropdownPanel
          onClose={() => close(false)}
          align="left"
          placement={placement}
          className="w-full min-w-0 p-1"
        >
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onListKeyDown}
            className="max-h-64 overflow-y-auto overflow-x-hidden outline-none"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value
              const isActive = index === active
              return (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => choose(index)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 ${
                    isActive ? 'bg-slate-100' : ''
                  }`}
                >
                  {option.icon && (
                    <span className="flex shrink-0 items-center">
                      {option.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-ink">
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="block truncate text-[10px] text-muted">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <Check
                      size={14}
                      className="shrink-0 text-[var(--ws-accent,#375b4b)]"
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </DropdownPanel>
      )}
    </div>
  )
}
