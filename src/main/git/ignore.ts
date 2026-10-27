/** Git ▸ Add to .gitignore from the file tree. */
import { promises as fs } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { OpResult } from '../../shared/types'
import { ignoreLine, withIgnoreLine } from '../../shared/fileNames'
import { entryWithin, readFile, writeFile } from '../files'
import { repoRoot } from './refs'

/**
 * Appends the entry, repo-relative and anchored, to the `.gitignore` at the repository root —
 * created when there is none, left alone when the entry is already listed. The `.gitignore`
 * must itself lie inside the open roots: a session opened on a subfolder of a repository cannot
 * write above itself. The write is the editor's atomic one, which also follows a symlinked
 * `.gitignore` only when its target is inside the roots.
 */
export async function addToGitignore(path: string): Promise<OpResult> {
  const entry = await entryWithin(path)
  if (!('real' in entry)) return { ok: false, code: entry.code }
  const repo = await repoRoot(dirname(entry.real))
  if (!repo) return { ok: false, code: 'not-in-repo' }
  // git prints the toplevel resolved; the entry's directory was resolved the same way
  const real = await fs.realpath(repo).catch(() => repo)
  const rel = relative(real, entry.real)
  if (!rel || rel.startsWith('..' + sep) || rel === '..') return { ok: false, code: 'not-in-repo' }
  const isDir = await fs.lstat(entry.real).then(
    (st) => st.isDirectory(),
    () => false,
  )
  const line = ignoreLine(rel.split(sep).join('/'), isDir)
  const file = join(real, '.gitignore')
  let existing = ''
  // only a missing file starts from nothing: an unreadable one must not be replaced by one line
  if (await fs.lstat(file).then(() => true, () => false)) {
    const current = await readFile(file)
    if (!current.ok || current.content === undefined) {
      const { code, params, error } = current
      return { ok: false, ...(code ? { code } : {}), ...(params ? { params } : {}), ...(error ? { error } : {}) }
    }
    existing = current.content
  }
  const next = withIgnoreLine(existing, line)
  if (next === null) return { ok: true, code: 'gitignore-already-listed', params: { entry: line } }
  return writeFile(file, next)
}
