import { createContext, useContext, useEffect, useRef } from 'react'

/**
 * Escape belongs to the innermost overlay.
 *
 * Modals and menus register here while they are open; only the deepest one sees the key.
 * The listener sits on the document in the capture phase and stops the event there, so the
 * window-level Escape handlers of what is behind (settings page, file editor, diff view)
 * never act on a key that was meant for the overlay on top of them.
 *
 * Depth comes from React context rather than mount order: effects run child-first, so a
 * menu opened together with its modal would otherwise register before it.
 */
type Entry = { depth: number; run: () => void }

const stack: Entry[] = []

/** nesting level of the overlay being rendered; 0 = page */
export const OverlayDepth = createContext(0)

function topmost(): Entry | null {
  let best: Entry | null = null
  for (const e of stack) if (!best || e.depth >= best.depth) best = e
  return best
}

const onKeyDown = (e: KeyboardEvent): void => {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  const entry = topmost()
  if (!entry) return
  e.preventDefault()
  e.stopPropagation()
  entry.run()
}

function push(entry: Entry): () => void {
  if (!stack.length) document.addEventListener('keydown', onKeyDown, true)
  stack.push(entry)
  return () => {
    const i = stack.indexOf(entry)
    if (i !== -1) stack.splice(i, 1)
    if (!stack.length) document.removeEventListener('keydown', onKeyDown, true)
  }
}

/** claim Escape for an open overlay; returns the depth to hand down to nested ones */
export function useOverlayEscape(active: boolean, onClose: () => void): number {
  const depth = useContext(OverlayDepth) + 1
  const cb = useRef(onClose)
  // written after the commit, not during render: a ref mutated while rendering is not
  // guaranteed to survive a render React throws away
  useEffect(() => {
    cb.current = onClose
  })

  useEffect(() => {
    if (!active) return
    return push({ depth, run: () => cb.current() })
  }, [active, depth])

  return depth
}
