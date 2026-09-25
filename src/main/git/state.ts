/** Unfinished repository operations: conflicts, continuing, and the shared runner for merge-like commands. */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { GitOpResult, MessageParams, OpResult, RepoState } from '../../shared/types'
import { fail, git, lastLine, literal, literals, refuse } from './exec'

/**
 * Which long operation a conflict stop is reported for. It travels as data rather than as a
 * label: «Rebase на «main»» is a sentence, and the sentence belongs to the renderer — main has
 * no locale. `ref` is absent for a pull, which names no branch of its own.
 */
export interface MergeOp {
  operation: 'merge' | 'rebase' | 'pull'
  ref?: string
}

/** an unfinished rebase/merge shows up as bookkeeping files in the .git directory */
export async function repoState(cwd: string): Promise<RepoState> {
  const gitDir = await git(cwd, ['rev-parse', '--absolute-git-dir'])
  if (gitDir.code !== 0) return { operation: 'none', conflicted: [] }
  const dir = gitDir.stdout.trim()

  const exists = async (rel: string): Promise<boolean> => {
    try {
      await fs.access(join(dir, rel))
      return true
    } catch {
      return false
    }
  }

  let operation: RepoState['operation'] = 'none'
  let step: string | undefined
  if ((await exists('rebase-merge')) || (await exists('rebase-apply'))) {
    operation = 'rebase'
    try {
      const base = (await exists('rebase-merge')) ? 'rebase-merge' : 'rebase-apply'
      const [msgnum, end] = await Promise.all([
        fs.readFile(join(dir, base, 'msgnum'), 'utf8').catch(() => ''),
        fs.readFile(join(dir, base, 'end'), 'utf8').catch(() => ''),
      ])
      if (msgnum.trim() && end.trim()) step = `${msgnum.trim()}/${end.trim()}`
    } catch {
      /* optional files */
    }
  } else if (await exists('MERGE_HEAD')) operation = 'merge'
  else if (await exists('CHERRY_PICK_HEAD')) operation = 'cherry-pick'
  else if (await exists('REVERT_HEAD')) operation = 'revert'

  const conflicts = await git(cwd, ['diff', '--name-only', '--diff-filter=U'])
  const conflicted = conflicts.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  // git reports the step only for a rebase, and not always even then: no step means no key
  return { operation, conflicted, ...(step ? { step } : {}) }
}

/** continuing or aborting an unfinished operation without launching an editor */
export async function continueOperation(
  cwd: string,
  op: RepoState['operation'],
  action: 'continue' | 'skip' | 'abort',
): Promise<GitOpResult> {
  // the map is exhaustive over the operation union on purpose: a new kind of operation must
  // fail to compile here rather than silently report «no operation in progress»
  const cmd: Record<Exclude<RepoState['operation'], 'none'>, string> = {
    rebase: 'rebase',
    merge: 'merge',
    'cherry-pick': 'cherry-pick',
    revert: 'revert',
  }
  if (op === 'none') return refuse({ code: 'no-operation-in-progress' })
  if (action !== 'abort' && op === 'merge') {
    const r = await git(cwd, ['commit', '--no-edit'], 300_000)
    if (r.code !== 0) return fail(r)
    return { ok: true, output: lastLine(r.stdout) }
  }
  // GIT_EDITOR=true: continuing must not open an editor — nothing in the app could close it
  const r = await git(cwd, [cmd[op], `--${action}`], 300_000, { GIT_EDITOR: 'true' })
  if (r.code !== 0) return fail(r)
  return { ok: true, output: lastLine(r.stdout || r.stderr) }
}

/**
 * A stop on a conflict is not an error of the command but its normal outcome: git returns a
 * non-zero code and prints hints, yet the work carries on in the changes panel. So this case is
 * kept apart from a real failure (no access, no such branch and so on).
 */
async function conflictStop(cwd: string, op: MergeOp): Promise<GitOpResult | null> {
  const state = await repoState(cwd)
  if (state.operation === 'none' || !state.conflicted.length) return null
  // the count is a parameter, not a word: plural forms differ per language and are the
  // renderer's business, and so is the name of the panel the files are resolved in
  const params: MessageParams = {
    operation: op.operation,
    files: state.conflicted.length,
    ...(op.ref ? { ref: op.ref } : {}),
  }
  return { ok: true, code: 'conflict-stop', params }
}

/**
 * merge, rebase, pull and «sync with base» share one shape: run a long command, treat a stop on
 * conflict as success, otherwise report the last line of the output. `prefix` is added to that
 * line only on a clean finish — a conflict message already names the operation itself.
 */
export async function runMergeLike(cwd: string, args: string[], op: MergeOp, prefix = ''): Promise<GitOpResult> {
  const r = await git(cwd, args, 300_000)
  if (r.code !== 0) {
    const stopped = await conflictStop(cwd, op)
    return stopped ?? fail(r)
  }
  return { ok: true, output: prefix + lastLine(r.stdout || r.stderr) }
}

/** take one side whole and mark the file resolved right away */
export async function acceptSide(cwd: string, file: string, side: 'ours' | 'theirs'): Promise<OpResult> {
  const checkout = await git(cwd, ['checkout', `--${side}`, '--', literal(file)])
  if (checkout.code !== 0) return fail(checkout)
  const add = await git(cwd, ['add', '--', literal(file)])
  if (add.code !== 0) return fail(add)
  return { ok: true }
}

export async function markResolved(cwd: string, files: string[]): Promise<OpResult> {
  if (!files.length) return refuse({ code: 'no-files-selected' })
  const r = await git(cwd, ['add', '--', ...literals(files)])
  if (r.code !== 0) return fail(r)
  return { ok: true }
}
