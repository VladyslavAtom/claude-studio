/** A worktree is a separate working copy for a session: creating, removing, listing. */
import { promises as fs } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import type { OpResult, RepoWorktree, WorktreeAddOptions } from '../../shared/types'
import { errText, fail, git, refuse } from './exec'
import { listBranches } from './refs'

export async function addWorktree(opts: WorktreeAddOptions): Promise<OpResult> {
  const { repoPath, worktreePath, branch, baseRef } = opts
  // a branch name git rejects, or one that would parse as an option, is refused before the spawn
  if (!(await isValidBranchName(repoPath, branch))) return refuse({ code: 'branch-name-invalid', params: { branch } })
  // a worktree whose directory was deleted still holds its branch in git's records until a prune:
  // recreating it at the same path would be refused as «already used by worktree»
  await git(repoPath, ['worktree', 'prune'])
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

/** `git check-ref-format --branch`: the name git itself would accept for a new branch */
export async function isValidBranchName(cwd: string, name: string): Promise<boolean> {
  if (!name || name.startsWith('-')) return false
  const r = await git(cwd, ['check-ref-format', '--branch', name])
  return r.code === 0
}

export async function listWorktrees(repoPath: string): Promise<{ path: string; branch: string | null }[]> {
  return (await listRepoWorktrees(repoPath)).map(({ path, branch }) => ({ path, branch }))
}

/** every worktree of the repository `cwd` belongs to, the main one first; empty when git fails */
export async function listRepoWorktrees(cwd: string): Promise<RepoWorktree[]> {
  const r = await git(cwd, ['worktree', 'list', '--porcelain'], 30_000)
  return r.code === 0 ? parseWorktreeList(r.stdout) : []
}

/**
 * `git worktree list --porcelain`: blank-line separated records of `key value` lines. The first
 * record is the main working copy; a bare repository's record (`bare`) has no working copy and is
 * left out — and it still takes the first place, so the next one is not taken for the main one.
 */
export function parseWorktreeList(stdout: string): RepoWorktree[] {
  const out: RepoWorktree[] = []
  let index = 0
  for (const block of stdout.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const first = lines[0]
    if (!first?.startsWith('worktree ')) continue
    const isMain = index++ === 0
    if (lines.some((l) => l === 'bare')) continue
    const wt: RepoWorktree = {
      path: first.slice('worktree '.length),
      head: null,
      branch: null,
      locked: false,
      prunable: false,
      isMain,
    }
    for (const line of lines.slice(1)) {
      if (line.startsWith('HEAD ')) wt.head = line.slice(5).trim() || null
      else if (line.startsWith('branch '))
        wt.branch = line
          .slice(7)
          .trim()
          .replace(/^refs\/heads\//, '')
      else if (line === 'locked' || line.startsWith('locked ')) wt.locked = true
      else if (line === 'prunable' || line.startsWith('prunable ')) wt.prunable = true
    }
    out.push(wt)
  }
  return out
}

/**
 * Entries of `git status --porcelain=v1 -z`: `XY path` each, NUL-terminated; a rename or a copy
 * carries its source as one more NUL field, which is not a second file.
 */
export function countPorcelainZ(stdout: string): number {
  const fields = stdout.split('\0')
  let n = 0
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    if (!f || f.length < 4) continue
    n++
    if (f[0] === 'R' || f[0] === 'C' || f[1] === 'R' || f[1] === 'C') i++
  }
  return n
}

/** the remote default branch as a ref (`refs/remotes/origin/main`), or null when there is none */
export async function remoteDefaultRef(cwd: string): Promise<string | null> {
  const head = await git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], 15_000)
  const ref = head.code === 0 ? head.stdout.trim() : ''
  if (ref.startsWith('refs/remotes/')) return ref
  for (const candidate of ['refs/remotes/origin/main', 'refs/remotes/origin/master']) {
    const r = await git(cwd, ['rev-parse', '--verify', '--quiet', candidate], 15_000)
    if (r.code === 0) return candidate
  }
  return null
}

/** what removing a worktree would lose, as git sees it; `merged` here is the ancestry answer only */
export interface WorktreeGitFacts {
  changed: number | null
  unpushed: number | null
  merged: boolean
}

/**
 * Changed files, commits not on the server, and whether the tip is already in the remote default
 * branch. With an upstream «not on the server» is `@{upstream}..HEAD`; without one it is what no
 * remote-tracking ref has (`--not --remotes`), so a branch pushed under another name still counts
 * as pushed.
 */
export async function worktreeGitFacts(path: string, defaultRef: string | null): Promise<WorktreeGitFacts> {
  const [st, up] = await Promise.all([
    git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], 30_000),
    git(path, ['rev-parse', '--verify', '--quiet', '@{upstream}'], 15_000),
  ])
  const changed = st.code === 0 ? countPorcelainZ(st.stdout) : null
  const range = up.code === 0 ? ['@{upstream}..HEAD'] : ['HEAD', '--not', '--remotes']
  const [count, ancestor] = await Promise.all([
    git(path, ['rev-list', '--count', ...range], 30_000),
    defaultRef ? git(path, ['merge-base', '--is-ancestor', 'HEAD', defaultRef], 30_000) : null,
  ])
  const n = Number(count.stdout.trim())
  return {
    changed,
    unpushed: count.code === 0 && Number.isFinite(n) ? n : null,
    merged: ancestor?.code === 0,
  }
}

/**
 * Removing a worktree an agent made, and its local branch. Without `force` git itself refuses a
 * worktree with changes and a branch that is not merged (`-d`): the caller has already checked,
 * and git checks once more. A branch that stays is a caveat, not a failure.
 */
export async function removeLinkedWorktree(
  repo: string,
  path: string,
  branch: string | null,
  force: boolean,
): Promise<OpResult & { warning?: string }> {
  const r = await git(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), path])
  if (r.code !== 0) return fail(r)
  await git(repo, ['worktree', 'prune'])
  if (branch && !branch.startsWith('-')) {
    const dropped = await git(repo, ['branch', force ? '-D' : '-d', branch])
    if (dropped.code !== 0) return { ok: true, warning: errText(dropped), code: 'worktree-removed-branch-kept' }
  }
  return { ok: true }
}
