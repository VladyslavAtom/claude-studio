/** Branches: the list for the menu, creating, switching, renaming, deleting, merge/rebase. */
import type { BranchInfo, GitOpResult, OpResult } from '../../shared/types'
import { fail, git, refuse } from './exec'
import { runMergeLike } from './state'
import { listWorktrees } from './worktree'

const FIELD = '\u0001'

/** local and remote branches with their date and last message — for the branch menu */
export async function listBranchInfo(cwd: string): Promise<BranchInfo[]> {
  const format = [
    '%(refname:short)',
    '%(upstream:short)',
    '%(HEAD)',
    '%(committerdate:unix)',
    '%(contents:subject)',
  ].join(FIELD)
  const r = await git(cwd, ['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes'])
  if (r.code !== 0) return []
  const out: BranchInfo[] = []
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue
    const [name, upstream, head, date, subject] = line.split(FIELD)
    if (!name || name.endsWith('/HEAD')) continue
    out.push({
      name,
      remote: name.includes('/') && name.startsWith('origin/'),
      // a branch without an upstream leaves the key out rather than carrying an empty one
      ...(upstream ? { upstream } : {}),
      current: head === '*',
      updatedAt: Number(date) * 1000 || 0,
      subject: subject ?? '',
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function mergeBranch(cwd: string, branch: string): Promise<GitOpResult> {
  return runMergeLike(cwd, ['merge', '--no-edit', branch], { operation: 'merge', ref: branch })
}

export async function rebaseOnto(cwd: string, branch: string): Promise<GitOpResult> {
  return runMergeLike(cwd, ['rebase', branch], { operation: 'rebase', ref: branch })
}

export async function renameBranch(cwd: string, from: string, to: string): Promise<OpResult> {
  const r = await git(cwd, ['branch', '-m', from, to])
  if (r.code !== 0) return fail(r)
  return { ok: true }
}

/**
 * git will not let a branch that some worktree points at be deleted — and rightly so: the
 * working copy would be left without a branch. Such worktrees are created not only by this
 * application (Claude Code puts its own under `.claude/worktrees`), so the message names which
 * directory exactly is in the way.
 */
export async function deleteBranch(cwd: string, branch: string, force: boolean): Promise<OpResult> {
  const used = (await listWorktrees(cwd)).find((w) => w.branch === branch)
  if (used) return refuse({ code: 'branch-used-by-worktree', params: { branch, path: used.path } })
  const r = await git(cwd, ['branch', force ? '-D' : '-d', branch])
  if (r.code !== 0) return fail(r)
  return { ok: true }
}

export async function checkout(cwd: string, branch: string): Promise<OpResult> {
  const r = await git(cwd, ['checkout', branch])
  if (r.code !== 0) return fail(r)
  return { ok: true }
}

export async function createBranch(cwd: string, branch: string, baseRef?: string): Promise<OpResult> {
  const args = baseRef ? ['checkout', '-b', branch, baseRef] : ['checkout', '-b', branch]
  const r = await git(cwd, args)
  if (r.code !== 0) return fail(r)
  return { ok: true }
}
