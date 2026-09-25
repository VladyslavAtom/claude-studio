/** what a user can Tab to; the order matters, so keep it a single selector */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** visible focusable descendants, in document order */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
  )
}

/** put focus back where it was, unless something else has already taken it */
export function restoreFocus(prev: Element | null): void {
  if (!prev || !(prev instanceof HTMLElement) || !prev.isConnected) return
  const now = document.activeElement
  if (now && now !== document.body && now !== prev) return
  prev.focus()
}
