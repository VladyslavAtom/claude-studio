import { useEffect, useRef } from 'react'

/**
 * Close a popup when the mouse goes down anywhere outside it. Was copied verbatim into five
 * components; the callback is kept in a ref so a new closure does not re-subscribe.
 *
 * The boundary arrives as a getter rather than a ref object: a popup is bounded by its wrapper
 * or, when it has none, by the popup element itself, and which of the two exists is only known
 * once they are mounted. Resolving it inside the mousedown handler keeps that read out of
 * render, where touching `.current` is not allowed.
 */
export function useClickOutside(inside: () => HTMLElement | null, active: boolean, onClose: () => void): void {
  const cb = useRef(onClose)
  const boundary = useRef(inside)
  // written after the commit, not during render: a ref mutated while rendering does not
  // survive a render React decides to throw away
  useEffect(() => {
    cb.current = onClose
    boundary.current = inside
  })

  useEffect(() => {
    if (!active) return
    const onDown = (e: MouseEvent): void => {
      const el = boundary.current()
      if (el && !el.contains(e.target as Node)) cb.current()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [active])
}
