import type { DirEntry } from '../../../shared/types'

type Entry = Pick<DirEntry, 'name' | 'path' | 'isDir'>

/**
 * The rows the file tree's filter leaves on screen: every entry whose name contains `query`
 * (case-insensitive) and every folder on the way to one, so a match deep down is shown under its
 * ancestors rather than as "nothing found". Null for an empty query: no filter, everything shows.
 *
 * Only what is already read is searched — `childrenOf` answers for the open folders and
 * undefined for the rest. Walking the whole disk on every keystroke is what a filter must not
 * do in a tree that holds `node_modules`.
 */
export function filterTree(
  entries: readonly Entry[],
  childrenOf: (dir: string) => readonly Entry[] | undefined,
  query: string,
): Set<string> | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const shown = new Set<string>()
  const visit = (list: readonly Entry[]): boolean => {
    let any = false
    for (const entry of list) {
      const children = entry.isDir ? childrenOf(entry.path) : undefined
      const below = children ? visit(children) : false
      if (below || entry.name.toLowerCase().includes(q)) {
        shown.add(entry.path)
        any = true
      }
    }
    return any
  }
  visit(entries)
  return shown
}
