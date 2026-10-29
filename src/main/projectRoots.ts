/**
 * The directories the renderer is allowed to reach through `files:*`, and the projects the person
 * opened.
 *
 * A root appears in three ways: out of the saved state at startup, out of a worktree that has
 * just been created, and out of a fresh clone. The latter two used to be registered right in the
 * IPC handler, and any other caller of `addWorktree`/`clone` quietly got a directory the
 * renderer cannot read. So the registration lives here, next to the creation.
 *
 * A session's worktree is also made ready to work in here, right after `git worktree add`:
 * `.worktreeinclude` is copied, the worktree is trusted in the claude profile, and the
 * repository's scripts are read for the renderer to offer (see `worktreeScripts`).
 */
import { app } from 'electron'
import { join, resolve as resolvePath } from 'node:path'
import type { AppState, OpResult, WorktreeAddOptions, WorktreeAddResult, WorktreePrepared } from '../shared/types'
import { worktreeEnv } from '../shared/worktreeSetup'
import { claudeConfigFile, trustWorktree } from './claudeTrust'
import * as files from './files'
import { addWorktree, clone, removeWorktree } from './git'
import { copyWorktreeInclude } from './git/worktreeInclude'
import { isApproved, readScriptsConfig, recordApproval, runTeardown } from './worktreeScripts'

/** the project roots of the saved state: the only repositories whose scripts are ever run */
const openedProjects = new Set<string>()

/**
 * The roots allowed for files:* are gathered from the saved state: the path of every project
 * and the cwd of every session (ordinary paths and worktrees alike).
 */
export function registerStateRoots(state: AppState): void {
  openedProjects.clear()
  for (const project of state.projects) {
    files.registerRoot(project.path)
    openedProjects.add(resolvePath(project.path))
    for (const session of project.sessions) files.registerRoot(session.cwd)
  }
}

export function isOpenedProject(path: string): boolean {
  return openedProjects.has(resolvePath(path))
}

function approvalsFile(): string {
  return join(app.getPath('userData'), 'worktree-scripts.json')
}

/** everything after `git worktree add`; each step is best effort and none undoes the worktree */
async function prepareWorktree(opts: WorktreeAddOptions): Promise<WorktreePrepared> {
  const { repoPath, worktreePath } = opts
  const include = await copyWorktreeInclude(repoPath, worktreePath).catch(() => ({ copied: 0, skipped: 0 }))
  let trusted = false
  if (opts.claudeTrust) {
    const file = claudeConfigFile(opts.claudeTrust.configDir)
    const outcome = await trustWorktree(file, repoPath, worktreePath).catch(() => 'unreadable' as const)
    trusted = outcome === 'trusted' || outcome === 'already'
  }
  const prepared: WorktreePrepared = { ...include, trusted }
  // scripts are not even offered for a directory the person never opened as a project
  if (!isOpenedProject(repoPath)) return prepared
  const read = await readScriptsConfig(repoPath)
  if (read.kind === 'invalid') return { ...prepared, configError: read.error }
  if (read.kind === 'none') return prepared
  const approved = await isApproved(approvalsFile(), resolvePath(repoPath), read.hash)
  return { ...prepared, scripts: { ...read.config, hash: read.hash, approved } }
}

/** the worktree of a session: it is created, opened to files:* and made ready to work in */
export async function createWorktree(opts: WorktreeAddOptions): Promise<WorktreeAddResult> {
  const res = await addWorktree(opts)
  if (!res.ok) return res
  files.registerRoot(opts.worktreePath)
  return { ...res, prepared: await prepareWorktree(opts) }
}

/**
 * The person's «yes» to the scripts they were shown. The hash is the one the setup tab carries;
 * the file is read again, and a file that changed since is not approved under the old answer.
 */
export async function approveWorktreeScripts(repoPath: string, hash: string): Promise<OpResult> {
  if (!isOpenedProject(repoPath)) return { ok: false, code: 'worktree-scripts-not-project' }
  const read = await readScriptsConfig(repoPath)
  if (read.kind !== 'ok' || read.hash !== hash) return { ok: false, code: 'worktree-scripts-changed' }
  try {
    await recordApproval(approvalsFile(), resolvePath(repoPath), hash)
  } catch (e) {
    return { ok: false, code: 'worktree-scripts-changed', error: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true }
}

/**
 * Removing a session's worktree: the repository's teardown first, then the removal. The teardown
 * cannot stop the removal — it is time-boxed, its failure is a warning, and one that was never
 * approved in its current form is not run at all.
 */
export async function removeSessionWorktree(
  repoPath: string,
  worktreePath: string,
  deleteBranch?: string,
  branch?: string,
): Promise<OpResult & { warning?: string }> {
  let note: (OpResult & { warning?: string }) | null = null
  const read = isOpenedProject(repoPath) ? await readScriptsConfig(repoPath) : null
  if (read?.kind === 'ok' && read.config.teardown) {
    if (await isApproved(approvalsFile(), resolvePath(repoPath), read.hash)) {
      const env = worktreeEnv(repoPath, { path: worktreePath, branch: branch ?? deleteBranch ?? '' })
      const failed = await runTeardown(worktreePath, read.config.teardown, env)
      if (failed) {
        const { detail, ...message } = failed
        note = { ok: true, ...message, ...(detail ? { warning: detail } : {}) }
      }
    } else {
      note = { ok: true, code: 'worktree-teardown-unapproved' }
    }
  }
  const removed = await removeWorktree(repoPath, worktreePath, deleteBranch)
  // the removal's own outcome comes first: a failure, or its own caveat, matters more
  if (!removed.ok || removed.code || removed.warning || !note) return removed
  return note
}

/** clone: the project directory comes into being only now, the state does not know it yet */
export async function cloneRepo(url: string, parentDir: string, name?: string): Promise<OpResult & { path?: string }> {
  const res = await clone(url, parentDir, name)
  if (res.ok && res.path) files.registerRoot(res.path)
  return res
}
