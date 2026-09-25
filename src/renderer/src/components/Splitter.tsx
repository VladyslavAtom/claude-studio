import type { JSX } from 'react'
import { useRef } from 'react'
import { useT } from '../i18n'

interface Props {
  /** horizontal delta since the previous event, in CSS pixels */
  onResize: (dx: number) => void
}

/** one arrow press moves the border by this much; Shift makes it a coarse step */
const STEP = 16
const BIG_STEP = 64

/** thin drag handle between panels */
export default function Splitter({ onResize }: Props): JSX.Element {
  const t = useT()
  const lastX = useRef(0)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    lastX.current = e.clientX
    el.classList.add('dragging')
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const dx = e.clientX - lastX.current
    if (!dx) return
    lastX.current = e.clientX
    onResize(dx)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    e.currentTarget.classList.remove('dragging')
  }

  // the panel sizes live in the caller, so the separator can only report a delta, not a value
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.shiftKey ? BIG_STEP : STEP
    onResize(e.key === 'ArrowLeft' ? -step : step)
  }

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      // TODO(i18n): belongs in the `common` area — the splitter sits between every pair of panels,
      // not only the terminal's, so its wording is not the terminal area's to own
      aria-label={t('common.splitter.aria')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}
