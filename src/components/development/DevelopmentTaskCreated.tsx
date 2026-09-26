'use client'

import { useEffect } from 'react'
import { CheckCircle2, GitBranch, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { checkoutCommand } from '@/lib/development/branchName'

const AUTO_DISMISS_MS = 4000

// What the create dialog turns into once the task exists: the exact branch to
// create (the final name, numbered if it had to be), ready to copy, plus the
// git command for anyone who wants it. OnTask never creates the branch.
export function DevelopmentTaskCreated({
  title,
  branchName,
  onOpenTask,
  onDone,
}: {
  title: string
  branchName: string
  onOpenTask: () => void
  onDone: () => void
}) {
  const command = checkoutCommand(branchName)

  useEffect(() => {
    const timer = window.setTimeout(onDone, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [onDone])

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-xs leading-5 text-ink">
        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
        <span>
          <span className="font-bold">{title}</span> was created. Create this
          branch to start — OnTask will pick it up automatically.
        </span>
      </p>

      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
          Branch
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5">
          <GitBranch size={14} className="shrink-0 text-muted" />
          <code className="min-w-0 flex-1 select-all truncate font-mono text-xs font-semibold text-ink">
            {branchName}
          </code>
          <CopyButton value={branchName} />
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
          Or from a terminal
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2">
          <Terminal size={13} className="shrink-0 text-muted" />
          <code className="min-w-0 flex-1 select-all truncate font-mono text-[11px] text-ink">
            {command}
          </code>
          <CopyButton value={command} />
        </div>
      </div>

      <p className="text-[10px] leading-4 text-muted">
        You&apos;ll create this branch yourself — OnTask only tracks it. Use the
        name exactly as shown.
      </p>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onOpenTask}>
          Open task
        </Button>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}
