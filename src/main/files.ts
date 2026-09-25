import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { DirEntry, FileContent, OpResult, ReadDirResult } from '../shared/types'

const MAX_EDITABLE = 2 * 1024 * 1024
/**
 * An image is carried to the renderer as a data URL, i.e. base64 inside an IPC message, so its
 * limit is its own and larger than the editable one: a screenshot an agent has just taken is the
 * usual case, and 2 MB of text is a different measure of «too big» than 2 MB of PNG.
 */
const MAX_IMAGE = 16 * 1024 * 1024

/**
 * What is shown rather than edited. SVG is deliberately absent: it is source, it opens in the
 * editor as it always has, and rendering it instead would take editing away.
 *
 * The extension decides, not the content: the file is opened because the person clicked it, and
 * a sniffed type would only disagree with the name they clicked.
 */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

/** the media type this path is shown as, or null when it is something to read as text */
export function imageMimeFor(path: string): string | null {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null // no extension, and a dotfile is not an image because of its dot
  return IMAGE_TYPES[name.slice(dot + 1).toLowerCase()] ?? null
}
const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store'])

/** The allowed roots: the paths of the projects and worktrees the user has opened. */
const allowedRoots = new Set<string>()

/** Registers a directory as a root allowed for reading and writing through files:*. */
export function registerRoot(path: string): void {
  allowedRoots.add(resolve(path))
}

/**
 * A file the user clicked in terminal output.
 *
 * Agents name files that lie nowhere near a project: an agent's scratchpad under
 * `/tmp/claude-1000/…` is outside every root, so a plain `files:read` of it is refused. A click
 * on a path is explicit intent — the same act as choosing a file in the open dialog, which
 * registers a root too — so the click is what widens the sandbox, and it widens it by **exactly
 * one file**. `isAllowed` matches `target === root` as well as a prefix, so a file works as a
 * root on its own; registering its directory instead would hand over the whole tree, and its
 * subtree with it, in exchange for one clicked line of output.
 *
 * This is its own channel rather than a call to `registerRoot` from the renderer, so that what
 * is being granted, and on whose behalf, is visible at the process boundary and in the channel
 * table instead of being a matter of who called what.
 *
 * A directory is refused, not registered: this opens files in the editor and a directory has
 * nothing to open. So is anything that is not a regular file — a fifo or a device would hang the
 * read that follows.
 */
export async function openFromTerminal(path: string): Promise<OpResult> {
  const target = resolve(path)
  let isFile: boolean
  try {
    isFile = (await fs.stat(target)).isFile()
  } catch {
    return { ok: false, code: 'terminal-path-gone' }
  }
  if (!isFile) return { ok: false, code: 'terminal-path-not-a-file' }
  allowedRoots.add(target)
  return { ok: true }
}

function isAllowed(path: string): boolean {
  const target = resolve(path)
  for (const root of allowedRoots) {
    if (target === root || target.startsWith(root + sep)) return true
  }
  return false
}

/**
 * A failure is told apart from an empty directory. A bare array made «permission denied», «not
 * a directory», «outside the allowed roots» and «genuinely empty» indistinguishable, and the
 * file tree drew its empty state for all four. The `code` is what the tree turns into a
 * sentence — the message itself is the renderer's business, since only it knows the locale.
 */
export async function readDir(dir: string): Promise<ReadDirResult> {
  if (!isAllowed(dir)) {
    console.error('[files] readDir outside allowed roots:', dir)
    return { ok: false, code: 'outside-roots' }
  }
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    console.error('[files] readDir failed:', dir, err)
    return { ok: false, code: readDirFailure(err) }
  }
  const out: DirEntry[] = []
  for (const e of entries) {
    if (HIDDEN.has(e.name)) continue
    out.push({
      name: e.name,
      path: join(dir, e.name),
      isDir: e.isDirectory() || (e.isSymbolicLink() && (await isDirSafe(join(dir, e.name)))),
      isSymlink: e.isSymbolicLink(),
    })
  }
  out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return { ok: true, entries: out }
}

/** errno of a failed readdir, reduced to the cases the tree can put into words */
function readDirFailure(err: unknown): Extract<ReadDirResult, { ok: false }>['code'] {
  switch ((err as NodeJS.ErrnoException).code) {
    case 'EACCES':
    case 'EPERM':
      return 'denied'
    case 'ENOENT':
      return 'missing'
    case 'ENOTDIR':
      return 'not-a-dir'
    default:
      return 'failed'
  }
}

async function isDirSafe(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function readFile(path: string): Promise<FileContent> {
  // every refusal this side decides on travels as a code: the wording is the renderer's, which
  // is the only side that knows the locale. Only what the filesystem itself said stays as text
  if (!isAllowed(path)) return { ok: false, code: 'path-outside-roots' }
  try {
    const st = await fs.stat(path)
    const mime = imageMimeFor(path)
    if (mime) {
      if (st.size > MAX_IMAGE) {
        return {
          ok: false,
          code: 'file-too-large',
          params: { limitMb: MAX_IMAGE / (1024 * 1024), sizeKb: Math.round(st.size / 1024) },
          size: st.size,
        }
      }
      const buf = await fs.readFile(path)
      return { ok: true, image: `data:${mime};base64,${buf.toString('base64')}`, size: st.size }
    }
    if (st.size > MAX_EDITABLE) {
      return {
        ok: false,
        code: 'file-too-large',
        params: { limitMb: MAX_EDITABLE / (1024 * 1024), sizeKb: Math.round(st.size / 1024) },
        size: st.size,
      }
    }
    const buf = await fs.readFile(path)
    // NUL byte in the first block is the usual "this is not text" signal
    if (buf.subarray(0, 8192).includes(0)) return { ok: false, binary: true, code: 'file-binary', size: st.size }
    return { ok: true, content: buf.toString('utf8'), size: st.size }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export async function writeFile(path: string, content: string): Promise<OpResult> {
  if (!isAllowed(path)) return { ok: false, code: 'path-outside-roots' }
  // A symlink must be written through, not replaced by a regular file, so resolve it
  // first. A file that does not exist yet has no realpath — write the given path.
  const target = await fs.realpath(path).catch(() => path)
  // The link may point outside the project; the allow-check has to hold for the real file too.
  if (target !== path && !isAllowed(target)) return { ok: false, code: 'path-outside-roots' }
  // rename replaces the inode, so the new file would get umask defaults: a 755 script
  // would silently become 644 and stop running, and git would report a mode change.
  // Carry the current mode over to the tmp file before the rename.
  // (Owner and ACLs still cannot be preserved without privileges.)
  const mode = await fs
    .stat(target)
    .then((st) => st.mode & 0o7777)
    .catch(() => null)
  // the write goes to a temporary file next to the target and is then renamed — a rename within
  // one filesystem is atomic, so a failure mid-write cannot leave the file half done.
  // The tmp file has to stay in the same directory (rename cannot cross filesystems);
  // a leading dot keeps a leftover from a crash out of the way of the changes panel.
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}-${Date.now()}.tmp`)
  try {
    await fs.writeFile(tmp, content, 'utf8')
    if (mode !== null) await fs.chmod(tmp, mode)
    await fs.rename(tmp, target)
    return { ok: true }
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    return { ok: false, error: String(err) }
  }
}
