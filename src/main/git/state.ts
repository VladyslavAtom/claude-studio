/** Unfinished repository operations: conflicts, continuing, and the shared runner for merge-like commands. */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ConflictInfo, ConflictSide, GitOpResult, MessageParams, OpResult, RepoState } from '../../shared/types'
import { fail, git, lastLine, literal, literals, refuse } from './exec'

/**
 * Which long operation a conflict stop is reported for. It travels as data rather than as a
 * label: «Rebase onto “main”» is a sentence, and the sentence belongs to the renderer — main has
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

/** a commit as a label: the branch pointing at it (local first), its short sha and subject */
async function describeCommit(cwd: string, rev: string): Promise<ConflictSide> {
  const [log, refs] = await Promise.all([
    git(cwd, ['log', '-1', '--format=%h%x00%s', rev, '--']),
    git(cwd, ['for-each-ref', `--points-at=${rev}`, '--format=%(refname:short)', 'refs/heads', 'refs/remotes']),
  ])
  const side: ConflictSide = {}
  if (log.code === 0) {
    const [sha, subject] = log.stdout.trim().split('\0')
    if (sha) side.sha = sha
    if (subject) side.subject = subject
  }
  // `origin/HEAD` is an alias, not a name anyone gave the branch
  const ref = refs.code === 0 ? refs.stdout.split('\n').find((r) => r && !r.endsWith('/HEAD')) : undefined
  if (ref) side.ref = ref
  return side
}

/**
 * The two sides of a conflicted file as people name them, and its base chunks.
 *
 * The labels come from the repository, not from the markers: during a rebase HEAD's marker says
 * `HEAD` and the other one a sha, while what the person needs is «main (upstream)» and «your
 * commit». The rebase's `onto` and `head-name` are read from its bookkeeping directory.
 */
export async function conflictInfo(cwd: string, file: string): Promise<ConflictInfo> {
  const state = await repoState(cwd)
  const gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).stdout.trim()
  const read = (rel: string): Promise<string> =>
    gitDir
      ? fs.readFile(join(gitDir, rel), 'utf8').then(
          (s) => s.trim(),
          () => '',
        )
      : Promise.resolve('')

  let ours: ConflictSide = {}
  let theirs: ConflictSide = {}
  if (state.operation === 'rebase') {
    const dir = (await read('rebase-merge/onto')) ? 'rebase-merge' : 'rebase-apply'
    const [onto, headName] = await Promise.all([read(`${dir}/onto`), read(`${dir}/head-name`)])
    // read from a file, so checked before it becomes an argument
    ours = /^[0-9a-f]{7,64}$/.test(onto) ? await describeCommit(cwd, onto) : {}
    theirs = await describeCommit(cwd, 'REBASE_HEAD')
    // the commit being replayed belongs to the branch being rebased, whatever else points at it
    const branch = headName.replace(/^refs\/heads\//, '')
    if (branch && branch !== 'detached HEAD') theirs.ref = branch
    else delete theirs.ref
  } else {
    const head = await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])
    ours = await describeCommit(cwd, 'HEAD')
    if (head.code === 0 && head.stdout.trim()) ours.ref = head.stdout.trim()
    const other: Partial<Record<RepoState['operation'], string>> = {
      merge: 'MERGE_HEAD',
      'cherry-pick': 'CHERRY_PICK_HEAD',
      revert: 'REVERT_HEAD',
    }
    const rev = other[state.operation]
    if (rev) theirs = await describeCommit(cwd, rev)
    // a picked or reverted commit is that commit, not whichever branch happens to point at it
    if (state.operation !== 'merge') delete theirs.ref
  }

  // `:N:./path` is a revision, not a pathspec: no glob to escape, and `./` keeps it relative to
  // cwd. git merge-file exits with the number of conflicts, so a positive code is still output.
  const stage = (n: number): string => `:${n}:./${file}`
  const merged = await git(cwd, ['merge-file', '-p', '--diff3', '--object-id', stage(2), stage(1), stage(3)])
  const diff3 = merged.code >= 0 && merged.code < 128 && !merged.problem ? merged.stdout : undefined
  return { operation: state.operation, ours, theirs, ...(diff3 ? { diff3 } : {}) }
}

export async function markResolved(cwd: string, files: string[]): Promise<OpResult> {
  if (!files.length) return refuse({ code: 'no-files-selected' })
  const r = await git(cwd, ['add', '--', ...literals(files)])
  if (r.code !== 0) return fail(r)
  return { ok: true }
}
