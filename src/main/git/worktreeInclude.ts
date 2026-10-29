/**
 * `.worktreeinclude`: the git-ignored files a new worktree needs to work (`.env`, local config)
 * and git cannot give it, because git never checks out what it ignores.
 *
 * The format is shared with Claude Code, Codex and ccmanager: a gitignore-syntax list at the
 * repository root. A file is copied only when it matches the list **and** git itself ignores it —
 * the list never makes a tracked or an ordinary untracked file eligible. The two halves are the
 * two git calls ccmanager makes (`src/utils/worktreeInclude.ts` there): `ls-files` with the list
 * as the only exclude source, then `check-ignore` against the repository's real rules.
 *
 * Differences from ccmanager, each for a case it does not cover:
 *  - `--directory`: an ignored directory comes back as one `dir/` entry rather than every file in
 *    it, so listing `node_modules` is one copy, not a 100 000-line answer over the buffer limit;
 *  - heavy directories (`node_modules`, virtualenvs, build output) are entered only when the list
 *    names them: a broad `.env*` must not drag a copy of every `.env` inside `node_modules`;
 *  - other worktrees nested in the repository are never copied — the app puts its own under
 *    `.worktrees/`, which is ignored, and a `*` in the list would copy every session into the next;
 *  - nothing is followed out of either tree: a source whose real directory is outside the
 *    repository, or a target whose real directory is outside the worktree, is skipped, and
 *    symlinks are copied as links, never through.
 */
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, resolve as resolvePath, sep } from 'node:path'
import { git } from './exec'
import { listWorktrees } from './worktree'

export const WORKTREE_INCLUDE_FILE = '.worktreeinclude'

/** directories copied only when the list names them outright */
const HEAVY_DIRS = [
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'dist',
  'build',
  '.next',
  '.cache',
  '.gradle',
]

/** a relative path with nowhere to escape to: no root, no `..`, no `.git` */
export function isSafeEntry(entry: string): boolean {
  if (!entry || isAbsolute(entry) || entry.includes('\0')) return false
  const parts = entry.split('/').filter(Boolean)
  return parts.length > 0 && !parts.some((p) => p === '..' || p === '.' || p === '.git')
}

/** the list's own patterns, comments and blank lines dropped */
export function includePatterns(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

/**
 * Whether an entry may pass through the heavy directories in its path. A heavy directory is
 * allowed when some pattern names it as a whole path segment — `node_modules`, `/node_modules/`,
 * `packages/*\/node_modules` — and not when it is merely matched by a wildcard.
 */
export function heavyAllowed(entry: string, patterns: string[]): boolean {
  const named = new Set<string>()
  for (const p of patterns) for (const seg of p.replace(/^!/, '').split('/')) if (seg) named.add(seg)
  return entry
    .split('/')
    .filter(Boolean)
    .every((seg) => !HEAVY_DIRS.includes(seg) || named.has(seg))
}

function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/**
 * The entries to copy, repository-relative as git prints them; a directory ends in `/`.
 * Empty when there is no list, when git fails, or when nothing matches.
 */
export async function resolveWorktreeInclude(repoPath: string): Promise<{ entries: string[]; skipped: number }> {
  const listFile = join(repoPath, WORKTREE_INCLUDE_FILE)
  let text: string
  try {
    const st = await fs.lstat(listFile)
    if (!st.isFile()) return { entries: [], skipped: 0 }
    text = await fs.readFile(listFile, 'utf8')
  } catch {
    return { entries: [], skipped: 0 }
  }
  const patterns = includePatterns(text)
  if (patterns.length === 0) return { entries: [], skipped: 0 }

  // `--exclude-from` is the only exclude source here (no --exclude-standard): «ignored» means
  // «matched by the list», whatever the repository's own .gitignore says
  const listed = await git(repoPath, [
    'ls-files',
    '--others',
    '--ignored',
    '--directory',
    '--no-empty-directory',
    `--exclude-from=${listFile}`,
    '-z',
  ])
  if (listed.code !== 0) return { entries: [], skipped: 0 }
  const candidates = listed.stdout.split('\0').filter(Boolean)
  if (candidates.length === 0) return { entries: [], skipped: 0 }

  // the second half of the intersection: of these, what does the repository really ignore.
  // Exit 1 means «none of them», with nothing on stdout — the same empty answer
  const checked = await git(
    repoPath,
    ['check-ignore', '--stdin', '-z'],
    120_000,
    undefined,
    candidates.join('\0') + '\0',
  )
  const ignored = checked.code === 0 ? checked.stdout.split('\0').filter(Boolean) : []

  const real = await fs.realpath(repoPath).catch(() => resolvePath(repoPath))
  const others = (await listWorktrees(repoPath))
    .map((w) => resolvePath(w.path))
    .filter((p) => p !== resolvePath(repoPath) && p !== real)

  const entries: string[] = []
  let skipped = candidates.length - ignored.length
  for (const entry of ignored) {
    const abs = resolvePath(repoPath, entry)
    const inOther = others.some((o) => within(abs, o) || within(o, abs))
    if (!isSafeEntry(entry) || inOther || !heavyAllowed(entry, patterns)) {
      skipped++
      continue
    }
    entries.push(entry)
  }
  return { entries, skipped }
}

async function exists(path: string): Promise<boolean> {
  return fs.lstat(path).then(
    () => true,
    () => false,
  )
}

/**
 * Copies what `.worktreeinclude` selects from the repository root into a fresh worktree. Never
 * overwrites: an entry already present in the worktree is left as it is. Best effort — a file
 * that cannot be copied is counted as skipped, and the session is created regardless.
 */
export async function copyWorktreeInclude(
  repoPath: string,
  worktreePath: string,
): Promise<{ copied: number; skipped: number }> {
  const { entries, skipped: unsafe } = await resolveWorktreeInclude(repoPath)
  let copied = 0
  let skipped = unsafe
  if (entries.length === 0) return { copied, skipped }
  const repoReal = await fs.realpath(repoPath)
  const treeReal = await fs.realpath(worktreePath)
  for (const entry of entries) {
    const rel = entry.replace(/\/+$/, '')
    const source = join(repoPath, rel)
    const target = join(worktreePath, rel)
    try {
      // git never walks through a symlinked directory, but the path is checked anyway: what is
      // copied must really lie inside the repository the person opened
      const sourceDir = await fs.realpath(dirname(source))
      if (!within(sourceDir, repoReal) || (await exists(target))) {
        skipped++
        continue
      }
      await fs.mkdir(dirname(target), { recursive: true })
      // the target's parent may be a tracked symlink pointing out of the worktree
      if (!within(await fs.realpath(dirname(target)), treeReal)) {
        skipped++
        continue
      }
      // links are copied as links, verbatim: never dereferenced, never rewritten to point back
      // into the root checkout
      await fs.cp(source, target, {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
        preserveTimestamps: true,
        force: false,
        errorOnExist: false,
      })
      copied++
    } catch {
      skipped++
    }
  }
  return { copied, skipped }
}
