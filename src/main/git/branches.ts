/** Branches: the list for the menu, creating, switching, renaming, deleting, merge/rebase. */
import type { BranchInfo, GitOpResult, OpResult } from '../../shared/types'
import { fail, git, refuse } from './exec'
import { runMergeLike } from './state'
import { listWorktrees } from './worktree'

/** a name that git would parse as an option: `checkout -b -x` is not a branch called «-x» */
const optionLike = (ref: string): boolean => ref.startsWith('-')
const leadingDash = (ref: string): OpResult => refuse({ code: 'ref-leading-dash', params: { ref } })

/**
 * git refused because uncommitted edits are in the way. Matched against git's own English output,
 * like the other refusals of this layer. Untracked files in the way are not this case: a stash
 * without `-u` would not move them, so offering one would only fail again.
 */
export function dirtyTreeRefusal(text: string): boolean {
  return /your local changes to the following files would be overwritten|cannot rebase: (you have unstaged changes|your index contains uncommitted changes)/i.test(
    text,
  )
}

/**
 * A failure caused by a dirty tree becomes a question rather than git's raw complaint: the
 * renderer offers to stash, run the operation again with `autostash`, and put the edits back —
 * the way pull already does with `--autostash`.
 */
export function askToStash(r: GitOpResult, operation: 'checkout' | 'merge' | 'rebase', ref: string): GitOpResult {
  if (r.ok || r.code || !dirtyTreeRefusal(r.error ?? '')) return r
  return refuse({ code: 'dirty-tree', params: { operation, ref } })
}

/** the message our stash entries carry; a timestamp makes each one findable again */
const STASH_TAG = 'claude-studio autostash'

/**
 * Our entry in the stash list, by its message. The list is shared by every worktree of the
 * repository and an agent may push onto it meanwhile, so `stash@{0}` is not necessarily ours.
 */
async function stashEntry(cwd: string, tag: string): Promise<{ hash: string; ref: string } | null> {
  const r = await git(cwd, ['stash', 'list', '--format=%H%x01%gd%x01%gs'])
  for (const line of r.stdout.split('\n')) {
    const [hash, ref, subject] = line.split('\u0001')
    if (hash && ref && subject?.endsWith(tag)) return { hash, ref }
  }
  return null
}

/**
 * `checkout` has no `--autostash` of its own, so this is what that flag does elsewhere: stash the
 * edits, switch, apply them on top. A conflict while applying is a success with a caveat — the
 * markers are in the files and the edits also stay in the stash.
 */
async function checkoutStashed(cwd: string, branch: string): Promise<OpResult> {
  const tag = `${STASH_TAG} ${Date.now()}`
  const saved = await git(cwd, ['stash', 'push', '-m', tag])
  if (saved.code !== 0) return fail(saved)
  const r = await git(cwd, ['checkout', branch])
  // nothing to stash leaves no entry; a failed checkout still gets its edits back where they were
  const entry = await stashEntry(cwd, tag)
  if (entry) {
    const back = await git(cwd, ['stash', 'apply', entry.hash])
    if (back.code !== 0) return r.code === 0 ? { ok: true, code: 'autostash-conflict' } : fail(r)
    const still = await stashEntry(cwd, tag)
    if (still) await git(cwd, ['stash', 'drop', still.ref])
  }
  return r.code === 0 ? { ok: true } : fail(r)
}

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

/** `autostash`: the person agreed to have uncommitted edits stashed and put back */
export async function mergeBranch(cwd: string, branch: string, autostash = false): Promise<GitOpResult> {
  if (optionLike(branch)) return leadingDash(branch)
  const args = ['merge', '--no-edit', ...(autostash ? ['--autostash'] : []), branch]
  return askToStash(await runMergeLike(cwd, args, { operation: 'merge', ref: branch }), 'merge', branch)
}

/** `autostash`: the person agreed to have uncommitted edits stashed and put back */
export async function rebaseOnto(cwd: string, branch: string, autostash = false): Promise<GitOpResult> {
  if (optionLike(branch)) return leadingDash(branch)
  const args = ['rebase', ...(autostash ? ['--autostash'] : []), branch]
  return askToStash(await runMergeLike(cwd, args, { operation: 'rebase', ref: branch }), 'rebase', branch)
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

/** `autostash`: the person agreed to have uncommitted edits stashed and put back */
export async function checkout(cwd: string, branch: string, autostash = false): Promise<OpResult> {
  if (optionLike(branch)) return leadingDash(branch)
  if (autostash) return checkoutStashed(cwd, branch)
  const r = await git(cwd, ['checkout', branch])
  if (r.code !== 0) return askToStash(fail(r), 'checkout', branch)
  return { ok: true }
}

export async function createBranch(cwd: string, branch: string, baseRef?: string): Promise<OpResult> {
  if (optionLike(branch)) return leadingDash(branch)
  if (baseRef && optionLike(baseRef)) return leadingDash(baseRef)
  const args = baseRef ? ['checkout', '-b', branch, baseRef] : ['checkout', '-b', branch]
  const r = await git(cwd, args)
  if (r.code !== 0) return fail(r)
  return { ok: true }
}
