/** Ref resolution: where HEAD is, what the base and the upstream of a branch are. */
import { git } from './exec'

export async function repoRoot(dir: string): Promise<string | null> {
  const r = await git(dir, ['rev-parse', '--show-toplevel'])
  if (r.code !== 0) return null
  const out = r.stdout.trim()
  return out ? out : null
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (r.code !== 0) return null
  const b = r.stdout.trim()
  return b && b !== 'HEAD' ? b : null
}

/** local branch names; only `addWorktree` asks, to tell "checkout it" from "create it" apart */
export async function listBranches(cwd: string): Promise<string[]> {
  const r = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  if (r.code !== 0) return []
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * One base ref for every operation. The base comes from the session settings either as «main»
 * or as «origin/main», while the work goes from the remote-tracking ref: nobody moves the local
 * `main` inside a worktree, and the «behind by N» counter would keep hanging there after a
 * rebase onto `origin/main`. Hence: if `refs/remotes/<base>` exists, take it as is, otherwise
 * `origin/<base>`, otherwise (no remote, or the branch is local only) the base itself.
 */
export async function resolveBaseRef(cwd: string, baseRef: string): Promise<string> {
  if (!baseRef) return baseRef
  const asRemote = await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/${baseRef}`])
  if (asRemote.code === 0) return baseRef
  const tracked = await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${baseRef}`])
  if (tracked.code === 0) return `origin/${baseRef}`
  return baseRef
}

/**
 * The main branch of the repository: where a pull request goes by default. The remote is asked
 * first (`origin/HEAD` is set up by clone and by `remote set-head`), on failure the usual names
 * are tried, and only as a last resort the current branch is taken.
 */
export async function defaultBranch(cwd: string): Promise<string | null> {
  const head = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (head.code === 0) {
    const name = head.stdout.trim().replace(/^origin\//, '')
    if (name) return name
  }
  for (const candidate of ['main', 'master']) {
    const local = await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`])
    if (local.code === 0) return candidate
  }
  return currentBranch(cwd)
}

/** upstream name of the current branch («origin/main»), or null when it has none */
export async function upstreamOf(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  return r.code === 0 ? r.stdout.trim() || null : null
}

export async function hasUpstream(cwd: string): Promise<boolean> {
  return (await upstreamOf(cwd)) !== null
}

/** the contents of a file at any revision: needed to highlight the «before» side in full */
export async function fileAtRef(cwd: string, ref: string, path: string): Promise<string | null> {
  const r = await git(cwd, ['show', `${ref}:${path}`])
  return r.code === 0 ? r.stdout : null
}
