'use client'

import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'

// Copies `value` and says so for a moment. Used wherever OnTask hands the user
// an exact string to paste elsewhere (a branch name, a link).
export function CopyButton({
  value,
  label = 'Copy',
  className = '',
}: {
  value: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(id)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // Clipboard blocked (insecure context, permissions): the value is on
      // screen and selectable, so there is nothing else to do.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? 'Copied' : `${label}: ${value}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[10px] font-bold text-[var(--ws-accent,#375b4b)] transition hover:border-[var(--ws-accent,#375b4b)] ${className}`}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : label}
    </button>
  )
}
