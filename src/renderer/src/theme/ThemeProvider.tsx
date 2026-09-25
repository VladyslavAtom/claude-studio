import type { JSX, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ThemeChoice } from '../../../shared/types'
import { resolveTheme, ThemeContext, ThemePreviewContext, useSystemTheme } from './themeContext'

/**
 * Resolves the user's choice against the OS and puts the answer on the document element, where
 * the stylesheets pick it up. This is the only place that decides which theme is in force —
 * a component reading `data-theme` back out of the DOM, or asking `matchMedia` itself, would be
 * a second source that can disagree with this one.
 *
 * The settings page previews a theme before it is saved, and it does so by handing its choice
 * back here rather than painting anything itself: a preview is only worth having if it looks
 * exactly like the saved result, which it does only when the same code produces both. Nothing is
 * persisted — leaving the page without saving drops the preview, like any other unsaved edit.
 */
export function ThemeProvider({ choice, children }: { choice?: ThemeChoice; children: ReactNode }): JSX.Element {
  /**
   * A preview remembers which saved choice it was made against, so a save simply stops it from
   * matching. Expiring it that way is a derivation rather than a reset, and a reset would have to
   * be written from an effect — an extra render, and a window that paints the old theme first.
   */
  const [preview, setPreview] = useState<{ against: ThemeChoice | undefined; value: ThemeChoice } | null>(null)
  const choiceRef = useRef(choice)
  const shown = preview && preview.against === choice ? preview.value : choice
  const theme = resolveTheme(shown, useSystemTheme())

  useEffect(() => {
    choiceRef.current = choice
  }, [choice])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    // tells the engine which way round the built-in widgets go: form controls, the caret,
    // and the default scrollbars on any element that does not style its own
    document.documentElement.style.colorScheme = theme
  }, [theme])

  const api = useMemo(
    () => ({
      preview: (value: ThemeChoice | null) => setPreview(value === null ? null : { against: choiceRef.current, value }),
    }),
    [],
  )

  return (
    <ThemePreviewContext.Provider value={api}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </ThemePreviewContext.Provider>
  )
}
