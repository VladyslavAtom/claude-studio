import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import type { ThemeChoice, ThemeName } from '../../../shared/types'

/**
 * The theme is applied as `data-theme` on the document element, and every colour in the
 * stylesheets is a custom property defined per theme. Nothing is injected from here: a rule
 * that has to differ between themes belongs in `styles/tokens.css` next to its default, where
 * it can be read as CSS rather than as a string in a bundle.
 *
 * `'system'` is not a theme — it is the absence of a choice, resolved against the OS setting and
 * re-resolved when that setting changes while the window is open.
 */
export const ThemeContext = createContext<ThemeName>('dark')

/**
 * How a page asks for a theme to be shown without saving it. Only the settings page uses this,
 * and it is a request to the provider rather than a second way of painting: `null` gives the
 * saved choice back. The provider also clears it whenever the saved choice changes, so a page
 * that forgets to tidy up cannot leave the window in a colour nobody chose.
 */
export const ThemePreviewContext = createContext<{ preview: (choice: ThemeChoice | null) => void }>({
  preview: () => undefined,
})

export function useThemePreview(): (choice: ThemeChoice | null) => void {
  return useContext(ThemePreviewContext).preview
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function subscribeToSystem(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** what the OS is asking for right now */
export function systemTheme(): ThemeName {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/**
 * The OS setting is an external store, so it is read through the hook meant for one. Mirroring
 * it into state would mean writing that state from an effect, and the value can change between
 * the render and the effect — a schedule flipping the desktop at the wrong moment is enough.
 */
export function useSystemTheme(): ThemeName {
  return useSyncExternalStore(subscribeToSystem, systemTheme)
}

export function resolveTheme(choice: ThemeChoice | undefined, system: ThemeName): ThemeName {
  return !choice || choice === 'system' ? system : choice
}

/** the theme in force, already resolved: 'system' never reaches a component */
export function useTheme(): ThemeName {
  return useContext(ThemeContext)
}

/** a value picked per theme, for the two palettes that cannot live in CSS (xterm, CodeMirror) */
export function useThemed<T>(byTheme: Record<ThemeName, T>): T {
  const theme = useTheme()
  return useMemo(() => byTheme[theme], [byTheme, theme])
}
