/**
 * Path rules shared by main (attribution, the live guard) and the renderer (session rows). Plain
 * string work on absolute POSIX paths: the renderer has no `node:path`, and both sides must agree.
 */

/** `path` is `dir` itself or lies below it; `/repo-x` is not inside `/repo` */
export function isInside(path: string, dir: string): boolean {
  const d = dir.length > 1 && dir.endsWith('/') ? dir.slice(0, -1) : dir
  return path === d || path.startsWith(d === '/' ? '/' : d + '/')
}

/**
 * The candidate that owns `path`: the longest one it lies in. `/repo/.worktrees/x/src` belongs to
 * `/repo/.worktrees/x`, not to `/repo`, although it lies in both. Null when it lies in none.
 */
export function ownerOf(path: string, candidates: readonly string[]): string | null {
  let best: string | null = null
  for (const c of candidates) if (isInside(path, c) && (best === null || c.length > best.length)) best = c
  return best
}

/**
 * How a worktree is named next to its repository: the part below the repository when it lies
 * inside (`.worktrees/mad-372`), `../<name>` when it is a sibling, the full path otherwise.
 */
export function relativeTo(path: string, repo: string): string {
  if (path === repo) return '.'
  if (isInside(path, repo)) return path.slice(repo.length + 1)
  const parent = (p: string): string => p.slice(0, p.lastIndexOf('/'))
  if (parent(path) === parent(repo)) return '../' + path.slice(path.lastIndexOf('/') + 1)
  return path
}

/** the facts the bulk removal decides on */
export interface RemovalFacts {
  isMain: boolean
  locked: boolean
  live: boolean
  changed: number | null
  unpushed: number | null
  merged: boolean
}

/**
 * Removable without a question: nothing would be lost. Not the main working copy, not locked,
 * nobody working in it, no changed file, no commit missing from the server, and the branch
 * merged. An unknown count is not zero.
 */
export function safeToRemove(f: RemovalFacts): boolean {
  return !f.isMain && !f.locked && !f.live && f.changed === 0 && f.unpushed === 0 && f.merged
}
