import type { JSX, KeyboardEvent, ReactNode } from 'react'
import { useEffect, useId, useRef } from 'react'
import { OverlayDepth, useOverlayEscape } from './overlay'
import { focusables, restoreFocus } from './focus'

interface Props {
  /** heading of the dialog; it also names the dialog for screen readers */
  title: ReactNode
  /** extra classes on the box itself, e.g. 'wide push-modal' */
  className?: string
  /**
   * Closing by Escape and by a click on the backdrop. Without it the only way out is a
   * button inside — that is how a question that must be answered is asked (startup).
   */
  onClose?: () => void
  children: ReactNode
}

/**
 * A modal dialog.
 *
 * `.modal-backdrop > .modal` used to be copied into a dozen places, and no copy had a role,
 * a focus trap or an Escape key. All of that lives here once: the dialog says it is a dialog,
 * Tab stays inside it, Escape closes the innermost one, and focus goes back to whatever
 * opened the window.
 */
export default function Modal({ title, className, onClose, children }: Props): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const depth = useOverlayEscape(Boolean(onClose), () => onClose?.())

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const prev = document.activeElement
    // an autoFocus field inside has already taken focus — do not fight it
    if (!box.contains(document.activeElement)) (focusables(box)[0] ?? box).focus()
    return () => restoreFocus(prev)
  }, [])

  /** Tab must not walk out into the page behind: wrap it around at both ends of the list */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return
    const box = boxRef.current
    if (!box) return
    const items = focusables(box)
    const first = items[0]
    const last = items[items.length - 1]
    // nothing focusable inside: Tab has nowhere to go but out, so swallow it
    if (!first || !last) {
      e.preventDefault()
      return
    }
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === box)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <OverlayDepth.Provider value={depth}>
      <div className="modal-backdrop" onClick={() => onClose?.()}>
        <div
          ref={boxRef}
          className={className ? 'modal ' + className : 'modal'}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          <h2 id={titleId}>{title}</h2>
          {children}
        </div>
      </div>
    </OverlayDepth.Provider>
  )
}
