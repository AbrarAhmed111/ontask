import { ReactNode } from 'react'
import type { Settings2 } from 'lucide-react'

// One card on the workspace Settings page: an icon + title header (with an
// optional action on the right) over its content.
export function SettingsCard({
  icon: Icon,
  iconNode,
  title,
  action,
  className = '',
  children,
}: {
  icon?: typeof Settings2
  iconNode?: ReactNode
  title: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-line bg-panel shadow-sm ${className}`}
    >
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line/70 px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink">
          {iconNode ?? (Icon ? <Icon size={15} /> : null)} {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  )
}
