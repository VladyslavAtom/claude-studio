import type { KeyboardEvent, RefObject } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useOverlayEscape } from './overlay'
import { useClickOutside } from './useClickOutside'
import { restoreFocus } from './focus'

/** menu items first; a popup that is not a menu (a filter list) falls back to its buttons */
const ITEMS = '[role="menuitem"]:not([disabled]), [role="option"]:not([disabled])'

export interface MenuHandle<Root extends HTMLElement = HTMLDivElement> {
  /** wraps trigger and popup: a click inside it does not count as a click outside */
  rootRef: RefObject<Root | null>
  menuRef: RefObject<HTMLDivElement | null>
  /** nesting level for the popup, so a submenu takes Escape before its parent */
  depth: number
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
  triggerProps: { 'aria-haspopup': 'menu' | 'listbox' | 'dialog'; 'aria-expanded': boolean }
}

interface Options {
  /** what the trigger opens; 'dialog' for popups that are not a list of commands */
  haspopup?: 'menu' | 'listbox' | 'dialog'
  /** move focus onto the first item when the popup opens; off where an input owns focus */
  autoFocus?: boolean
}

/**
 * Behaviour shared by every custom popup: click outside, Escape (innermost first), arrow-key
 * walk over the items, `aria-expanded` on the trigger and focus back on it when the popup goes.
 */
export function useMenu<Root extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  options: Options = {},
): MenuHandle<Root> {
  const { haspopup = 'menu', autoFocus = true } = options
  const rootRef = useRef<Root>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<Element | null>(null)

  /** a popup without a wrapper (the context menu) is its own outside-click boundary */
  const boundary = useCallback((): HTMLElement | null => rootRef.current ?? menuRef.current, [])

  useClickOutside(boundary, open, onClose)
  const depth = useOverlayEscape(open, onClose)

  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement
    if (autoFocus) {
      const menu = menuRef.current
      if (menu && !menu.contains(document.activeElement)) itemsOf(menu)[0]?.focus()
    }
    // the popup is already gone here, so focus sits on <body> unless the click moved it on
    return () => restoreFocus(openerRef.current)
  }, [open, autoFocus])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>): void => {
    const menu = menuRef.current
    if (!menu) return
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const items = itemsOf(menu)
    if (!items.length) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const last = items.length - 1
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? last
          : at === -1
            ? e.key === 'ArrowDown'
              ? 0
              : last
            : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }, [])

  return { rootRef, menuRef, depth, onKeyDown, triggerProps: { 'aria-haspopup': haspopup, 'aria-expanded': open } }
}

function itemsOf(menu: HTMLElement): HTMLElement[] {
  const items = [...menu.querySelectorAll<HTMLElement>(ITEMS)]
  return items.length ? items : [...menu.querySelectorAll<HTMLElement>('button:not([disabled])')]
}
