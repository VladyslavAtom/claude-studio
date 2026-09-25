import type { DragEvent } from 'react'

export interface DragHandlers {
  draggable: true
  onDragStart: (e: DragEvent) => void
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
  onDragEnd: (e: DragEvent) => void
}

/**
 * HTML5 drag-and-drop reordering. `group` keeps unrelated lists from accepting
 * each other's items (project tabs vs terminal tabs vs agents).
 */
export function dragHandlers(
  group: string,
  index: number,
  onReorder: (from: number, to: number) => void,
): DragHandlers {
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData('text/x-cs-drag', `${group}:${index}`)
      e.dataTransfer.effectAllowed = 'move'
      ;(e.currentTarget as HTMLElement).classList.add('dragging')
    },
    onDragOver: (e) => {
      const types = e.dataTransfer.types
      if (!types.includes('text/x-cs-drag')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      ;(e.currentTarget as HTMLElement).classList.add('drop-target')
    },
    onDrop: (e) => {
      e.preventDefault()
      const el = e.currentTarget as HTMLElement
      el.classList.remove('drop-target')
      const raw = e.dataTransfer.getData('text/x-cs-drag')
      const [srcGroup, srcIndex] = raw.split(':')
      if (srcGroup !== group) return
      const from = Number(srcIndex)
      if (Number.isNaN(from) || from === index) return
      onReorder(from, index)
    },
    onDragEnd: (e) => {
      const el = e.currentTarget as HTMLElement
      el.classList.remove('dragging')
      document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'))
    },
  }
}

/**
 * When a tab was last closed with the middle button. On Linux, Chromium pastes the primary
 * selection into the focused field on a middle click anywhere in the window, so closing a tab
 * also pasted text into the terminal. That event cannot be cancelled on the tab itself — the
 * paste arrives at the terminal — so the terminal suppresses it by how fresh this mark is.
 */
let middleCloseAt = 0

/** was a tab just closed with the middle button */
export function middleCloseRecently(ms = 500): boolean {
  return Date.now() - middleCloseAt < ms
}

/**
 * Middle-click to close, as in a browser or an IDE.
 * onMouseDown suppresses autoscroll and the X11 primary-selection paste, while the action
 * itself hangs off auxclick — that one only fires when the button is released over the target.
 */
export function middleClickClose(close: () => void): {
  onAuxClick: (e: { button: number; preventDefault: () => void; stopPropagation: () => void }) => void
  onMouseDown: (e: { button: number; preventDefault: () => void }) => void
} {
  return {
    onAuxClick: (e) => {
      if (e.button !== 1) return
      e.preventDefault()
      e.stopPropagation()
      middleCloseAt = Date.now()
      close()
    },
    onMouseDown: (e) => {
      if (e.button === 1) e.preventDefault()
    },
  }
}
