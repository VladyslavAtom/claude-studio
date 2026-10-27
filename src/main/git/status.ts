/** What changed: parsing of `status`/`--name-status`, and the diff of a single file. */
import { stat } from 'node:fs/promises'
import { join, resolve as resolvePath } from 'node:path'
import type { ChangedFile, ChangeStatus, DiffMode, FileDiffStat, GitStatusResult } from '../../shared/types'
import { git, literal, literals } from './exec'
import { currentBranch, repoRoot, resolveBaseRef, upstreamOf } from './refs'
import { listWorktrees } from './worktree'

export function mapStatusCode(code: string): ChangeStatus {
  switch (code) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'added'
    case 'U':
      return 'conflict'
    default:
      return 'modified'
  }
}

/** `git status --porcelain -z` with rename pairs handled */
export async function workingStatus(cwd: string): Promise<ChangedFile[]> {
  const r = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (r.code !== 0) return []
  const parts = r.stdout.split('\0')
  const files: ChangedFile[] = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry) continue
    // a status entry is `XY path`; a truncated one has no code in that column, which reads
    // the same as git's own "unmodified here" space
    const [x = ' ', y = ' '] = entry
    const path = entry.slice(3)
    if (x === '?' && y === '?') {
      files.push({ path, status: 'untracked', staged: false, untracked: true })
      continue
    }
    let oldPath: string | undefined
    if (x === 'R' || x === 'C') {
      // rename: current entry holds the new path, the old one follows in the next NUL chunk
      oldPath = parts[++i]
    }
    const staged = x !== ' ' && x !== '?'
    const primary = x !== ' ' && x !== '?' ? x : y
    files.push({
      path,
      // the key is left out entirely when there is no old path: `oldPath: undefined` is a
      // different thing from "not a rename" for anything that checks with `in`
      ...(oldPath ? { oldPath } : {}),
      status: x === 'U' || y === 'U' ? 'conflict' : mapStatusCode(primary),
      staged,
      untracked: false,
    })
  }
  return files
}

/** parses `--name-status -z`: «code, path» pairs, triples for renames */
export function parseNameStatus(stdout: string): ChangedFile[] {
  const parts = stdout.split('\0').filter((p) => p !== '')
  const files: ChangedFile[] = []
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]
    if (!code) continue
    const [letter = ''] = code
    // Output cut short mid-record leaves a code with no path behind it. There is no file to
    // name, and every field after it belongs to a record we can no longer align, so stop.
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[++i]
      const newPath = parts[++i]
      if (!oldPath || !newPath) break
      files.push({ path: newPath, oldPath, status: 'renamed', staged: false, untracked: false })
    } else {
      const path = parts[++i]
      if (!path) break
      files.push({ path, status: mapStatusCode(letter), staged: false, untracked: false })
    }
  }
  return files
}

/**
 * Old paths of staged renames among the selected files. `git mv` is a pair of index entries:
 * the old path deleted and the new one added, while only the new one is visible in the panel.
 * With the pathspec limited to the new path, the deletion of the old one reaches neither the
 * commit (the file is doubled in it and the deletion is left hanging in the index) nor the revert.
 */
export function renameSources(files: string[], entries: ChangedFile[]): string[] {
  const wanted = new Set(files)
  const sources = entries.filter((f) => f.oldPath && wanted.has(f.path)).map((f) => f.oldPath as string)
  return [...new Set(sources)]
}

/** committed + working changes relative to a base ref (used for worktree sessions) */
async function diffAgainst(cwd: string, ref: string): Promise<ChangedFile[]> {
  const r = await git(cwd, ['diff', '--name-status', '-z', '--find-renames', ref])
  if (r.code !== 0) return []
  return parseNameStatus(r.stdout)
}

export async function status(cwd: string, mode: DiffMode, baseRef?: string): Promise<GitStatusResult> {
  const root = await repoRoot(cwd)
  if (!root) return { files: [], branch: null, ahead: 0, behind: 0, error: 'not a git repository' }
  const branch = await currentBranch(cwd)
  // both the file list and the counters are taken from one ref — the very ref syncWithBase updates to
  const base = baseRef ? await resolveBaseRef(cwd, baseRef) : undefined

  /**
   * A nested worktree is a separate working copy. In the status of its own repository it shows
   * up as somebody else's files whenever its directory is not listed in exclude (it was created
   * by another tool, say), so they are cut out explicitly.
   */
  const nested = (await listWorktrees(cwd))
    .map((w) => resolvePath(w.path))
    .filter((p) => p !== resolvePath(cwd) && p.startsWith(resolvePath(cwd) + '/'))
    .map((p) => p.slice(resolvePath(cwd).length + 1) + '/')
  const outsideNested = (f: ChangedFile): boolean => !nested.some((n) => f.path.startsWith(n))

  let files: ChangedFile[]
  if (mode === 'base' && base) {
    const tracked = await diffAgainst(cwd, base)
    const untracked = (await workingStatus(cwd)).filter((f) => f.untracked)
    const seen = new Set(tracked.map((f) => f.path))
    files = [...tracked, ...untracked.filter((f) => !seen.has(f.path))]
  } else {
    files = await workingStatus(cwd)
  }

  // how far the branch has moved from the base is needed in the ordinary mode too: it is the
  // caption of the commits section
  let ahead = 0
  let behind = 0
  if (base) {
    const r = await git(cwd, ['rev-list', '--left-right', '--count', `${base}...HEAD`])
    if (r.code === 0) {
      const [b, a] = r.stdout
        .trim()
        .split(/\s+/)
        .map((n) => parseInt(n, 10) || 0)
      behind = b ?? 0
      ahead = a ?? 0
    }
  }

  // the exchange with upstream is counted apart from the divergence from the base: these are
  // two different questions — «what have I not sent yet» and «what already lies on the server
  // but has not been pulled»
  const upstream = await upstreamOf(cwd)
  let unpushed = 0
  let unpulled = 0
  if (upstream) {
    const counted = await git(cwd, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`])
    if (counted.code === 0) {
      const [incoming, outgoing] = counted.stdout
        .trim()
        .split(/\s+/)
        .map((n) => parseInt(n, 10) || 0)
      unpulled = incoming ?? 0
      unpushed = outgoing ?? 0
    }
  }

  files = files.filter(outsideNested)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { files, branch, ahead, behind, upstream, unpushed, unpulled }
}

/**
 * Which revision a file's diff is taken against: the session base in base mode, HEAD otherwise
 * (null). The same choice as the file list makes — otherwise the file is there in the panel
 * while its diff is empty. The base still has to go through `resolveBaseRef`.
 */
export function diffBase(mode: DiffMode, baseRef: string | undefined): string | null {
  return mode === 'base' && baseRef ? baseRef : null
}

async function diffRef(cwd: string, mode: DiffMode, baseRef: string | undefined): Promise<string> {
  const base = diffBase(mode, baseRef)
  return base ? resolveBaseRef(cwd, base) : 'HEAD'
}

/**
 * Sums `git diff --numstat -z`. A record is `added\tremoved\tpath\0`, or for a detected rename
 * `added\tremoved\t\0old\0new\0`; a binary file counts `-` for both. Summing rather than taking
 * the first record keeps a rename git did not pair up (a deletion plus an addition) honest.
 */
export function parseNumstat(stdout: string): { added: number; removed: number; binary: boolean } {
  const parts = stdout.split('\0')
  let added = 0
  let removed = 0
  let binary = false
  for (let i = 0; i < parts.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(parts[i] ?? '')
    if (!m) continue
    const [, a = '-', r = '-', path = ''] = m
    if (a === '-' || r === '-') binary = true
    else {
      added += parseInt(a, 10)
      removed += parseInt(r, 10)
    }
    // the two paths of a rename follow in fields of their own and must not be read as records
    if (path === '') i += 2
  }
  return { added, removed, binary }
}

async function fileSize(path: string): Promise<number> {
  try {
    const st = await stat(path)
    return st.isFile() ? st.size : 0
  } catch {
    // a deleted file has no working side; that is a size of nothing, not an error
    return 0
  }
}

/**
 * The size of one file's diff, for the gate in front of the diff view. Rename-aware: with the
 * old path in the pathspec git pairs the two up and counts the edit, not a whole-file addition.
 */
export async function fileDiffStat(
  cwd: string,
  file: string,
  oldPath: string | undefined,
  mode: DiffMode,
  baseRef: string | undefined,
  untracked: boolean,
): Promise<FileDiffStat> {
  const abs = join(cwd, file)
  if (untracked) {
    // --no-index exits 1 when the files differ, which is the normal case here
    const r = await git(cwd, ['diff', '--no-index', '--numstat', '-z', '--', '/dev/null', abs])
    return { ...parseNumstat(r.stdout), bytes: await fileSize(abs), ref: 'HEAD' }
  }
  const ref = await diffRef(cwd, mode, baseRef)
  const paths = oldPath && oldPath !== file ? [oldPath, file] : [file]
  const [numstat, blob, size] = await Promise.all([
    git(cwd, ['diff', '--numstat', '-z', '--find-renames', ref, '--', ...literals(paths)]),
    git(cwd, ['cat-file', '-s', `${ref}:${oldPath ?? file}`]),
    fileSize(abs),
  ])
  const blobSize = blob.code === 0 ? parseInt(blob.stdout.trim(), 10) || 0 : 0
  return { ...parseNumstat(numstat.stdout), bytes: Math.max(size, blobSize), ref }
}

export async function fileDiff(
  cwd: string,
  file: string,
  mode: DiffMode,
  baseRef: string | undefined,
  untracked: boolean,
): Promise<string> {
  if (untracked) {
    const abs = join(cwd, file)
    const r = await git(cwd, ['diff', '--no-index', '--', '/dev/null', abs])
    // --no-index exits 1 when files differ, which is the normal case here
    if (r.stdout) return r.stdout
    return r.stderr || ''
  }
  const ref = await diffRef(cwd, mode, baseRef)
  const r = await git(cwd, ['diff', ref, '--', literal(file)])
  if (r.code !== 0 && !r.stdout) return r.stderr || ''
  return r.stdout
}

/**
 * A compact summary for the question asked in /btw: there are no tools there and the message
 * length is limited, so only the status, the path and the size of the edit — without the diff
 * lines themselves.
 *
 * This is model input, not interface text: it is pasted into a prompt, never drawn on screen, so
 * its two words deliberately follow the prompt language and not the interface locale.
 */
export async function diffSummary(cwd: string, files: string[], ref = 'HEAD', maxFiles = 25): Promise<string> {
  const r = await git(cwd, ['diff', '--numstat', '--name-status', ref, '--', ...literals(files)])
  const raw = r.stdout.split('\n').filter((l) => l.trim())
  const rows = raw.map((l) => l.trim())
  const shown = rows.slice(0, maxFiles).map((l) => l.replace(/\s+/g, ' '))
  const rest = rows.length - shown.length
  // exact path match: endsWith counted «a.ts» as changed whenever some row ended with «src/a.ts»,
  // and the file then vanished from the summary the commit-message draft is built from
  const changed = new Set(raw.map((l) => l.split('\t').slice(-1)[0]))
  const untracked = files.filter((f) => !changed.has(f))
  const lines = [...shown, ...untracked.slice(0, 5).map((f) => `new ${f}`)]
  if (rest > 0) lines.push(`…and ${rest} more files`)
  return lines.join('; ')
}
