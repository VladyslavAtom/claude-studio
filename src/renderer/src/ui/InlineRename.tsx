import type { JSX } from 'react'
import { useRef, useState } from 'react'

interface Props {
  /** name being edited; an empty or unchanged draft counts as a cancel */
  value: string
  className?: string
  label: string
  onCommit: (name: string) => void
  onCancel: () => void
}

/**
 * Rename in place: the field takes focus, Enter and blur keep the new name, Escape drops it.
 * Copied three times before (terminal tab, project tab, session), each with its own idea of
 * what Enter does.
 */
export default function InlineRename({ value, className, label, onCommit, onCancel }: Props): JSX.Element {
  const [draft, setDraft] = useState(value)
  /** Enter finishes the edit and the field unmounts; its blur must not finish it a second time */
  const done = useRef(false)

  const finish = (keep: boolean): void => {
    if (done.current) return
    done.current = true
    const name = draft.trim()
    if (keep && name && name !== value) onCommit(name)
    else onCancel()
  }

  return (
    <input
      autoFocus
      className={className}
      aria-label={label}
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          // the tab behind listens for Escape on the window: it must not close as well
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        }
      }}
    />
  )
}
