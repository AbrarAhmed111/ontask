import type { CSSProperties } from 'react'

// Curated accent presets for a workspace — deliberately not a free-form
// color picker, so every option is pre-checked for readable white-on-strong
// contrast and a soft tint that reads well as a badge/highlight background
// against the app's paper/panel surfaces. `coral` (used for delete/danger/
// eyebrow accents everywhere) is intentionally left alone by every preset —
// it keeps its own fixed meaning regardless of the workspace's theme.
export type WorkspaceThemeId =
  'forest' | 'ocean' | 'sunset' | 'berry' | 'slate' | 'rose'

export type WorkspaceTheme = {
  id: WorkspaceThemeId
  label: string
  strong: string
  soft: string
}

export const WORKSPACE_THEMES: WorkspaceTheme[] = [
  { id: 'forest', label: 'Forest', strong: '#375b4b', soft: '#e9f0ec' },
  { id: 'ocean', label: 'Ocean', strong: '#2b6cb0', soft: '#e6f0fa' },
  { id: 'sunset', label: 'Sunset', strong: '#c2650f', soft: '#faeee0' },
  { id: 'berry', label: 'Berry', strong: '#8b3a6b', soft: '#f5e7f0' },
  { id: 'slate', label: 'Slate', strong: '#475569', soft: '#eceff3' },
  { id: 'rose', label: 'Rose', strong: '#b83c5c', soft: '#fbe7ec' },
]

const DEFAULT_THEME = WORKSPACE_THEMES[0]

export function getWorkspaceTheme(
  id: string | null | undefined,
): WorkspaceTheme {
  return WORKSPACE_THEMES.find(theme => theme.id === id) ?? DEFAULT_THEME
}

// The CSS variables every accent-aware component reads (`var(--ws-accent, ...)`
// in Button, the shell, cards, ...). Kept here so the names exist in one place
// for whatever sets them: the workspace-wide scope and the edit form's preview.
export function workspaceThemeVars(theme: WorkspaceTheme): CSSProperties {
  return {
    '--ws-accent': theme.strong,
    '--ws-accent-soft': theme.soft,
    '--scrollbar-thumb': theme.strong,
    '--scrollbar-thumb-hover': theme.strong,
  } as CSSProperties
}
