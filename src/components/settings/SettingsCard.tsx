import { ReactNode } from 'react'
import type { Settings2 } from 'lucide-react'

// One card on the workspace Settings page: an icon + title header (with an
// optional action on the right) over its content.
export function SettingsCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: typeof Settings2
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-line bg-panel shadow-sm">
      <div className="flex min-h-[57px] items-center justify-between border-b border-line/70 px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink">
          <Icon size={15} /> {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  )
}
