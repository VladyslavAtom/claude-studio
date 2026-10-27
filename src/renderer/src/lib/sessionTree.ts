/**
 * Sessions as a tree: a session opened by another session's agent (`open_session`) is its child.
 *
 * The state keeps a flat list — order, persistence and the reducer stay as they were — and the
 * tree is read off `parentId` here. A parent that is not in the list (closed, forgotten, or a
 * restored child whose parent is gone) means no parent: the session is shown at the top level
 * rather than hidden under something that does not exist.
 */
import type { Session } from '../../../shared/types'

/** how deep sessions may nest: a session at this depth is refused another child */
export const MAX_DEPTH = 3
/** live children one session may hold at once; a runaway loop of `open_session` stops here */
export const MAX_CHILDREN = 8

export interface TreeRow {
  session: Session
  /** its position in `project.sessions`: what drag-and-drop reorders */
  index: number
  depth: number
  /** live direct children */
  childCount: number
  /** descendants folded away under this row; empty when it is expanded or has none */
  hidden: Session[]
}

/** the parent as the tree sees it: null when it is absent or would make a cycle */
function parentIdOf(byId: Map<string, Session>, s: Session): string | null {
  return s.parentId && s.parentId !== s.id && byId.has(s.parentId) ? s.parentId : null
}

function childrenMap(sessions: readonly Session[]): Map<string | null, Session[]> {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const map = new Map<string | null, Session[]>()
  for (const s of sessions) {
    const key = parentIdOf(byId, s)
    map.set(key, [...(map.get(key) ?? []), s])
  }
  return map
}

/** every session below `id`, parents before their children */
export function descendants(sessions: readonly Session[], id: string): Session[] {
  const map = childrenMap(sessions)
  const out: Session[] = []
  const seen = new Set<string>([id])
  const walk = (pid: string): void => {
    for (const c of map.get(pid) ?? []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
      walk(c.id)
    }
  }
  walk(id)
  return out
}

/** 0 for a top-level session */
export function depthOf(sessions: readonly Session[], id: string): number {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const seen = new Set<string>()
  let depth = 0
  let cur = byId.get(id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    const pid = parentIdOf(byId, cur)
    if (!pid) break
    depth++
    cur = byId.get(pid)
  }
  return depth
}

/**
 * The rows of the list, depth-first in list order. A session in a cycle — only a corrupt file can
 * make one — is caught by `seen` and shown at the top level, never dropped.
 */
export function treeRows(sessions: readonly Session[], collapsed: ReadonlySet<string>): TreeRow[] {
  const map = childrenMap(sessions)
  const index = new Map(sessions.map((s, i) => [s.id, i]))
  const rows: TreeRow[] = []
  const seen = new Set<string>()
  const walk = (s: Session, depth: number): void => {
    if (seen.has(s.id)) return
    seen.add(s.id)
    const kids = map.get(s.id) ?? []
    const folded = collapsed.has(s.id) && kids.length > 0
    rows.push({
      session: s,
      index: index.get(s.id) ?? 0,
      depth,
      childCount: kids.length,
      hidden: folded ? descendants(sessions, s.id) : [],
    })
    if (folded) {
      for (const d of descendants(sessions, s.id)) seen.add(d.id)
      return
    }
    for (const c of kids) walk(c, depth + 1)
  }
  for (const s of map.get(null) ?? []) walk(s, 0)
  for (const s of sessions) if (!seen.has(s.id)) walk(s, 0)
  return rows
}
