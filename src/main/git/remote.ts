/** Exchange with the server: push, pull and bringing a branch up to date with its base. */
import type { GitOpResult } from '../../shared/types'
import { askToStash } from './branches'
import { errText, fail, git, refuse } from './exec'
import { resolveBaseRef } from './refs'
import { runMergeLike } from './state'

export async function push(cwd: string, branch: string, setUpstream: boolean): Promise<GitOpResult> {
  const args = setUpstream ? ['push', '-u', 'origin', branch] : ['push']
  const r = await git(cwd, args, 300_000)
  if (r.code !== 0) return fail(r)
  return { ok: true, output: errText(r) }
}

/**
 * Pull («Pull — update the project»). The way is chosen by the person: rebase lays one's own commits on
 * top of other people's and leaves the history linear, merge keeps things as they were and adds
 * a merge commit. --autostash takes uncommitted edits away and puts them back, so that the
 * update does not run up against a dirty tree.
 */
export async function pull(cwd: string, strategy: 'merge' | 'rebase' = 'rebase'): Promise<GitOpResult> {
  const how = strategy === 'merge' ? '--no-rebase' : '--rebase'
  const r = await runMergeLike(cwd, ['pull', how, '--autostash'], { operation: 'pull' })
  // without an upstream there is nowhere to pull from, and git's hint about --set-upstream-to
  // is of no help here. The pattern matches git's own English output, not a translated string
  if (!r.ok && /no tracking information/i.test(r.error ?? '')) return refuse({ code: 'no-upstream' })
  return r
}

/** bring the worktree up to date with its base branch; falls back to merge when rebase refuses */
export async function syncWithBase(
  cwd: string,
  baseRef: string,
  mode: 'rebase' | 'merge',
  autostash = false,
): Promise<GitOpResult> {
  // `fetch origin <branch>` puts the result into FETCH_HEAD, not into origin/<branch>: so that
  // the operation starts from a fresh state, the remote-tracking refs are updated wholesale
  const remote = baseRef.includes('/') ? baseRef.slice(0, baseRef.indexOf('/')) : 'origin'
  await git(cwd, ['fetch', remote], 300_000)

  // the base may be given either as «main» or as «origin/main»; the ref is picked by the same
  // rule as in status — otherwise the panel keeps showing the branch as behind after the update
  const target = await resolveBaseRef(cwd, baseRef)

  // the prefix is the ref's own name: a git object, the same word in every locale
  // `autostash`: the person agreed to have uncommitted edits stashed and put back, as pull does
  const stash = autostash ? ['--autostash'] : []
  const r =
    mode === 'rebase'
      ? await runMergeLike(cwd, ['rebase', ...stash, target], { operation: 'rebase', ref: target }, `${target}: `)
      : await runMergeLike(
          cwd,
          ['merge', '--no-edit', ...stash, target],
          { operation: 'merge', ref: target },
          `${target}: `,
        )
  return askToStash(r, mode, target)
}
