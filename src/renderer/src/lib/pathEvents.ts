/**
 * Files and folders the app itself renamed or moved, so that the editor tabs showing them follow
 * to the new path instead of staying on one that no longer exists (and recreating it on the next
 * save). A deletion needs no event of its own: the editor re-reads on `changesInvalidated` and
 * finds the file gone.
 */

export interface PathMove {
  /** absolute path before */
  from: string
  /** absolute path after */
  to: string
}

type Listener = (moves: readonly PathMove[]) => void
const listeners = new Set<Listener>()

/** entries were renamed or moved on disk; called by whoever did it (the file tree) */
export function pathsMoved(moves: readonly PathMove[]): void {
  if (!moves.length) return
  for (const listener of [...listeners]) listener(moves)
}

/** listen for `pathsMoved`; returns the unsubscribe */
export function onPathsMoved(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** where `path` is after `moves`: the entry itself or anything under a moved folder; null when untouched */
export function movedPath(path: string, moves: readonly PathMove[]): string | null {
  for (const { from, to } of moves) {
    const src = from.replace(/[\\/]+$/, '')
    if (path === src) return to
    if (path.startsWith(src + '/') || path.startsWith(src + '\\'))
      return to.replace(/[\\/]+$/, '') + path.slice(src.length)
  }
  return null
}
