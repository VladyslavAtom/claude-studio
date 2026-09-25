/** A worktree is a separate working copy for a session: creating, removing, listing. */
import { promises as fs } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import type { OpResult, WorktreeAddOptions } from '../../shared/types'
import { errText, fail, git, refuse } from './exec'
import { listBranches } from './refs'

export async function addWorktree(opts: WorktreeAddOptions): Promise<OpResult> {
  const { repoPath, worktreePath, branch, baseRef } = opts
  const branches = await listBranches(repoPath)
  const exists = branches.includes(branch)
  const args = exists
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath, baseRef]
  const r = await git(repoPath, args)
  if (r.code !== 0) {
    // the pattern is matched against git's own English output, so it is not a translated string
    if (/already checked out|is already used by worktree/i.test(errText(r))) {
      return refuse({ code: 'worktree-branch-busy', params: { branch } })
    }
    return fail(r)
  }
  // keep in-repo worktrees out of the parent repo's status
  if (resolvePath(worktreePath).startsWith(resolvePath(repoPath) + '/')) {
    await excludeFromRepo(repoPath, worktreePath)
  }
  return { ok: true }
}

async function excludeFromRepo(repoPath: string, worktreePath: string): Promise<void> {
  try {
    const rel = resolvePath(worktreePath).slice(resolvePath(repoPath).length + 1)
    const top = rel.split('/')[0]
    if (!top) return
    const excludeFile = join(repoPath, '.git', 'info', 'exclude')
    let content = ''
    try {
      content = await fs.readFile(excludeFile, 'utf8')
    } catch {
      /* file may not exist */
    }
    const line = `/${top}/`
    if (content.split('\n').some((l) => l.trim() === line)) return
    await fs.mkdir(join(repoPath, '.git', 'info'), { recursive: true })
    await fs.writeFile(excludeFile, (content && !content.endsWith('\n') ? content + '\n' : content) + line + '\n')
  } catch {
    /* best effort */
  }
}

/**
 * Removing a worktree. `worktree prune` is not a fallback plan for a `remove` that failed: all
 * it does is clean out records of directories that are already gone, and it finishes
 * successfully even when the working copy is intact (a lock, a submodule, files in use).
 * Calling the session closed on such a «success» is not allowed: the directory would stay on
 * disk, and on top of that the branch would be deleted with -D. So after the prune the fact
 * itself is checked: the worktree is detached and the directory is not there.
 *
 * `error` means the removal failed. A worktree that is gone while its branch survived is
 * reported through `warning`: the caller asked for the worktree, and it got what it asked for.
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  deleteBranch?: string,
): Promise<OpResult & { warning?: string }> {
  const r = await git(repoPath, ['worktree', 'remove', '--force', worktreePath])
  if (r.code !== 0) {
    const failure = errText(r)
    await git(repoPath, ['worktree', 'prune'])
    const target = resolvePath(worktreePath)
    const attached = (await listWorktrees(repoPath)).some((w) => resolvePath(w.path) === target)
    let onDisk = true
    try {
      await fs.access(target)
    } catch {
      onDisk = false
    }
    if (attached || onDisk) {
      // what survived the removal is a fact, not a sentence: the renderer names it in its locale
      const leftover = attached && onDisk ? 'both' : attached ? 'record' : 'dir'
      return {
        ok: false,
        ...(failure ? { error: failure } : {}),
        code: 'worktree-remove-failed',
        params: { leftover },
      }
    }
  }
  if (deleteBranch) {
    // the worktree has just been taken away, but git learns of it only after a prune
    await git(repoPath, ['worktree', 'prune'])
    const dropped = await git(repoPath, ['branch', '-D', deleteBranch])
    if (dropped.code !== 0) {
      // `warning` carries git's own refusal; the code says what the caveat is
      return { ok: true, warning: errText(dropped), code: 'worktree-removed-branch-kept' }
    }
  }
  return { ok: true }
}

export async function listWorktrees(repoPath: string): Promise<{ path: string; branch: string | null }[]> {
  const r = await git(repoPath, ['worktree', 'list', '--porcelain'])
  if (r.code !== 0) return []
  const out: { path: string; branch: string | null }[] = []
  let cur: { path: string; branch: string | null } | null = null
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur)
      cur = { path: line.slice(9).trim(), branch: null }
    } else if (line.startsWith('branch ') && cur) {
      cur.branch = line.slice(7).trim().replace('refs/heads/', '')
    }
  }
  if (cur) out.push(cur)
  return out
}
