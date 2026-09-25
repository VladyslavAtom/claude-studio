import type { KeyboardEvent, RefObject } from 'react'
import { useCallback, useEffect } from 'react'

/**
 * Enter and Space on a row that only had onClick. The guard on the target matters: a key
 * pressed on the checkbox or the close button inside the row is theirs, not the row's.
 */
export function activateOnKey(run: () => void) {
  return (e: KeyboardEvent<HTMLElement>): void => {
    if (e.target !== e.currentTarget) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    run()
  }
}

/**
 * Roving tab stop over a list of rows: the list is one stop for Tab, arrows walk inside it.
 * Without it a tree of two hundred files would be two hundred Tab presses.
 *
 * Tab index is kept on the DOM nodes instead of React state — rows are rendered recursively
 * (the file tree) and threading a selected index through them buys nothing.
 */
export function useRovingFocus(
  ref: RefObject<HTMLElement | null>,
  selector: string,
  orientation: 'vertical' | 'horizontal' = 'vertical',
): (e: KeyboardEvent<HTMLElement>) => void {
  // runs after every render: rows appear and disappear as the list is filtered or reloaded
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const items = [...root.querySelectorAll<HTMLElement>(selector)]
    if (!items.length) return
    const stop =
      items.find((el) => el.tabIndex === 0) ??
      items.find((el) => el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'true') ??
      items[0]
    for (const el of items) el.tabIndex = el === stop ? 0 : -1
  })

  return useCallback(
    (e: KeyboardEvent<HTMLElement>): void => {
      const target = e.target as HTMLElement | null
      // arrows inside a text field move the caret
      if (target instanceof HTMLTextAreaElement) return
      if (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio') return
      const [back, fwd] = orientation === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
      if (e.key !== back && e.key !== fwd && e.key !== 'Home' && e.key !== 'End') return
      const root = ref.current
      if (!root) return
      const items = [...root.querySelectorAll<HTMLElement>(selector)]
      if (!items.length) return
      const at = items.findIndex((el) => el === target || el.contains(target))
      const last = items.length - 1
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? last
            : at === -1
              ? 0
              : Math.min(last, Math.max(0, at + (e.key === fwd ? 1 : -1)))
      const item = items[next]
      if (!item) return
      e.preventDefault()
      for (const el of items) el.tabIndex = el === item ? 0 : -1
      item.focus()
    },
    [ref, selector, orientation],
  )
}
