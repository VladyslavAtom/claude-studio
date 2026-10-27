import type { Project } from '../../../shared/types'

/** every directory the window depends on: each project folder and each session's working directory */
export function watchedDirs(projects: readonly Project[]): string[] {
  const dirs = new Set<string>()
  for (const p of projects) {
    dirs.add(p.path)
    for (const s of p.sessions) dirs.add(s.cwd)
  }
  return [...dirs].sort()
}

/** a session's own unfinished work: uncommitted files, and commits its base does not have */
export interface OwnWork {
  files: number
  ahead: number
}

/**
 * Whether closing may remove the worktree and the branch by default. Only work known to be
 * finished qualifies: still loading (undefined) or unreadable (null) is treated like dirty, so a
 * click on «Close» before the check answers cannot throw work away.
 */
export function safeToDiscard(own: OwnWork | null | undefined): boolean {
  return own != null && own.files === 0 && own.ahead === 0
}
