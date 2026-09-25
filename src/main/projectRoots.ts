/**
 * The directories the renderer is allowed to reach through `files:*`.
 *
 * A root appears in three ways: out of the saved state at startup, out of a worktree that has
 * just been created, and out of a fresh clone. The latter two used to be registered right in the
 * IPC handler, and any other caller of `addWorktree`/`clone` quietly got a directory the
 * renderer cannot read. So the registration lives here, next to the creation.
 */
import type { AppState, OpResult, WorktreeAddOptions } from '../shared/types'
import * as files from './files'
import { addWorktree, clone } from './git'

/**
 * The roots allowed for files:* are gathered from the saved state: the path of every project
 * and the cwd of every session (ordinary paths and worktrees alike).
 */
export function registerStateRoots(state: AppState): void {
  for (const project of state.projects) {
    files.registerRoot(project.path)
    for (const session of project.sessions) files.registerRoot(session.cwd)
  }
}

/** the worktree of a session: it is created and access to it is opened at once */
export async function createWorktree(opts: WorktreeAddOptions): Promise<OpResult> {
  const res = await addWorktree(opts)
  if (res.ok) files.registerRoot(opts.worktreePath)
  return res
}

/** clone: the project directory comes into being only now, the state does not know it yet */
export async function cloneRepo(url: string, parentDir: string, name?: string): Promise<OpResult & { path?: string }> {
  const res = await clone(url, parentDir, name)
  if (res.ok && res.path) files.registerRoot(res.path)
  return res
}
