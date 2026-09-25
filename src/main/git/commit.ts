/** Committing the selected paths, reverting edits and reading history. */
import type { ChangedFile, CommitInfo, GitOpResult, OpResult } from '../../shared/types'
import { fail, git, literal, literals, refuse } from './exec'
import { parseNameStatus, renameSources, workingStatus } from './status'

/**
 * Commits exactly the selected paths. In «vs base» mode the list also holds changes that are
 * already committed — on such paths `git add` fails with `pathspec did not match any files`,
 * so first only those really modified in the working tree are kept.
 */
export async function commit(cwd: string, files: string[], message: string): Promise<GitOpResult> {
  if (!files.length) return refuse({ code: 'no-files-selected' })
  if (!message.trim()) return refuse({ code: 'commit-empty-message' })

  const entries = await workingStatus(cwd)
  const dirty = new Set(entries.map((f) => f.path))
  // the old path of a rename has no status entry of its own — it is not a «skipped» one
  const sources = renameSources(files, entries)
  const staged = files.filter((f) => dirty.has(f))
  const skipped = files.filter((f) => !dirty.has(f) && !sources.includes(f))

  if (!staged.length) return refuse({ code: 'commit-already-committed' })

  // -A is what makes deletions reach the index on a par with edits
  const added = await git(cwd, ['add', '-A', '--', ...literals(staged)])
  if (added.code !== 0) return fail(added)

  // the old path of a rename is not handed to `add`: it is gone from both the working tree and
  // the index, and the pathspec would match nothing (`did not match any files`). The commit does
  // need it — without it the deletion of the old path stays in the index and the file lands in
  // the commit twice
  const pathspec = [...new Set([...staged, ...sources])]
  const res = await git(cwd, ['commit', '-m', message, '--', ...literals(pathspec)])
  if (res.code !== 0) {
    // the pattern is matched against git's own English output, so it is not a translated string
    const failed = fail(res)
    if (/nothing to commit|no changes added/i.test(failed.error ?? '')) {
      return refuse({ code: 'commit-nothing-to-commit' })
    }
    return failed
  }

  // git's own first line goes out verbatim; the note about skipped files is the app's own words,
  // so it travels as a code the renderer appends in its locale
  const head = res.stdout.trim().split('\n')[0]
  if (!skipped.length) return { ok: true, output: head }
  return { ok: true, output: head, code: 'commit-skipped-committed', params: { count: skipped.length } }
}

export async function revertFiles(cwd: string, files: string[]): Promise<OpResult> {
  if (!files.length) return refuse({ code: 'no-files-selected' })
  // ls-files does not know the old path of a rename (it is gone from the index), and without it
  // a restore of the new path alone wipes the file out entirely, leaving the deletion of the old
  // one in the index
  const sources = renameSources(files, await workingStatus(cwd))
  const tracked: string[] = [...sources]
  const untracked: string[] = []
  for (const f of files) {
    if (sources.includes(f)) continue
    const known = await git(cwd, ['ls-files', '--error-unmatch', '--', literal(f)])
    ;(known.code === 0 ? tracked : untracked).push(f)
  }
  if (tracked.length) {
    const unstage = await git(cwd, ['restore', '--staged', '--worktree', '--', ...literals(tracked)])
    if (unstage.code !== 0) {
      const legacy = await git(cwd, ['checkout', 'HEAD', '--', ...literals(tracked)])
      if (legacy.code !== 0) return fail(unstage.stderr ? unstage : legacy)
    }
  }
  if (untracked.length) {
    const clean = await git(cwd, ['clean', '-fd', '--', ...literals(untracked)])
    if (clean.code !== 0) return fail(clean)
  }
  return { ok: true }
}

const LOG_SEP = '\u0001'

/** commits in a range (`origin/main..HEAD`, say) — for the window shown before a push */
export async function listCommits(cwd: string, range: string, limit = 200): Promise<CommitInfo[]> {
  const r = await git(cwd, [
    'log',
    `--max-count=${limit}`,
    `--format=%H${LOG_SEP}%h${LOG_SEP}%s${LOG_SEP}%an${LOG_SEP}%ct`,
    range,
  ])
  if (r.code !== 0) return []
  const out: CommitInfo[] = []
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue
    // output cut short can leave a line without its later fields; the commit is still worth
    // listing by hash, so the missing ones fall back to empty rather than dropping the row
    const [hash, short = '', subject = '', author = '', ts = ''] = line.split(LOG_SEP)
    if (!hash) continue
    out.push({ hash, short, subject, author, date: (parseInt(ts, 10) || 0) * 1000 })
  }
  return out
}

/** what a single commit changed: merges are shown against the first parent */
export async function commitFiles(cwd: string, hash: string): Promise<ChangedFile[]> {
  const r = await git(cwd, ['show', '--name-status', '-z', '--find-renames', '--format=', '-m', '--first-parent', hash])
  if (r.code !== 0) return []
  return parseNameStatus(r.stdout)
}
