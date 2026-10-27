/**
 * What the file tree does to files: create, rename, move, copy, trash, reveal, open.
 *
 * Every path is checked here, in main, against the registered roots (`files.ts`): the source of
 * an operation by `entryWithin` (where its directory really is; a symlink is the link), the
 * directory something lands in by `realWithin` (links followed — that is where the bytes go).
 * Nothing overwrites: a taken name is a refusal, or a ` copy` suffix for a copy.
 *
 * A batch stops at its first failure and says so; what was done before it stays done.
 */
import { shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import type { OpResult } from '../shared/types'
import { copyName, isValidName } from '../shared/fileNames'
import { entryWithin, realWithin } from './files'

const outside = { ok: false, code: 'path-outside-roots' } as const
const failed = (err: unknown): OpResult => ({ ok: false, error: String(err) })

async function exists(path: string): Promise<boolean> {
  return fs.lstat(path).then(
    () => true,
    () => false,
  )
}

/** a new empty file or directory; the answer carries its path so a file can be opened at once */
export async function createEntry(dir: string, name: string, kind: 'file' | 'dir'): Promise<OpResult & { path?: string }> {
  if (!isValidName(name)) return { ok: false, code: 'file-name-invalid', params: { name } }
  const parent = await realWithin(dir)
  if (!parent) return outside
  const target = join(parent, name)
  try {
    // `wx` and a plain mkdir both fail on an existing name instead of touching it
    if (kind === 'file') await fs.writeFile(target, '', { flag: 'wx' })
    else await fs.mkdir(target)
    return { ok: true, path: join(dir, name) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return { ok: false, code: 'file-name-exists', params: { name } }
    return failed(err)
  }
}

/** a new name in the same directory */
export async function renameEntry(path: string, name: string): Promise<OpResult> {
  if (!isValidName(name)) return { ok: false, code: 'file-name-invalid', params: { name } }
  const src = await entryWithin(path)
  if (!('real' in src)) return { ok: false, code: src.code }
  const dest = join(dirname(src.real), name)
  if (dest === src.real) return { ok: true }
  if (await exists(dest)) return { ok: false, code: 'file-name-exists', params: { name } }
  return fs.rename(src.real, dest).then(() => ({ ok: true }), failed)
}

/** Cut + Paste: each entry keeps its name in the new directory; a taken name is refused */
export async function moveEntries(paths: string[], destDir: string): Promise<OpResult> {
  const dest = await realWithin(destDir)
  if (!dest) return outside
  for (const path of paths) {
    const src = await entryWithin(path)
    if (!('real' in src)) return { ok: false, code: src.code }
    const name = basename(src.real)
    // a directory into itself or below itself: rename would refuse too, but with EINVAL
    if (dest === src.real || dest.startsWith(src.real + sep)) {
      return { ok: false, code: 'file-move-into-itself', params: { name } }
    }
    const target = join(dest, name)
    if (target === src.real) continue // pasted back where it was cut from
    if (await exists(target)) return { ok: false, code: 'file-name-exists', params: { name } }
    try {
      await fs.rename(src.real, target)
    } catch (err) {
      return failed(err)
    }
  }
  return { ok: true }
}

/**
 * Copy + Paste and Duplicate (a copy into the entry's own directory). A taken name gets
 * ` copy`, ` copy 2`… Symlinks are copied as links, verbatim: a copy never reads through a
 * link, so it cannot pull a file from outside the roots into a project.
 */
export async function copyEntries(paths: string[], destDir: string): Promise<OpResult> {
  const dest = await realWithin(destDir)
  if (!dest) return outside
  for (const path of paths) {
    const src = await entryWithin(path)
    if (!('real' in src)) return { ok: false, code: src.code }
    try {
      const st = await fs.lstat(src.real)
      const isDir = st.isDirectory()
      if (isDir && dest.startsWith(src.real + sep)) {
        return { ok: false, code: 'file-move-into-itself', params: { name: basename(src.real) } }
      }
      const taken = new Set(await fs.readdir(dest))
      const target = join(dest, copyName(basename(src.real), isDir, taken))
      await fs.cp(src.real, target, {
        recursive: true,
        verbatimSymlinks: true,
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
      })
    } catch (err) {
      return failed(err)
    }
  }
  return { ok: true }
}

/** Delete: to the system trash, so it can be got back from there */
export async function trashEntries(paths: string[]): Promise<OpResult> {
  for (const path of paths) {
    const src = await entryWithin(path)
    if (!('real' in src)) return { ok: false, code: src.code }
    try {
      await shell.trashItem(src.real)
    } catch (err) {
      return failed(err)
    }
  }
  return { ok: true }
}

/** Open in ▸ File manager: the folder holding the entry, with the entry selected */
export async function revealEntry(path: string): Promise<OpResult> {
  const real = await realWithin(path)
  if (!real) return outside
  shell.showItemInFolder(real)
  return { ok: true }
}

/** Open in ▸ Default app; the desktop's refusal is its own text */
export async function openEntry(path: string): Promise<OpResult> {
  const real = await realWithin(path)
  if (!real) return outside
  const error = await shell.openPath(real)
  return error ? { ok: false, error } : { ok: true }
}
