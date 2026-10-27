/**
 * The changes panel's tree view: changed files grouped by directory. Pure, so it is tested
 * without a DOM; the panel only renders the rows `flattenTree` hands it.
 */

export interface TreeFile<F> {
  kind: 'file'
  /** the file's path, the same key the checked set uses */
  path: string
  /** what the row shows: the last path segment */
  name: string
  file: F
}

export interface TreeFolder<F> {
  kind: 'folder'
  /** the full directory path of the deepest folder in a compressed chain: the collapse key */
  path: string
  /** what the row shows, relative to the parent row: `src/renderer/src` for a compressed chain */
  name: string
  children: TreeNode<F>[]
  /** every file path under this folder, at any depth: what a folder checkbox counts and toggles */
  files: string[]
}

export type TreeNode<F> = TreeFolder<F> | TreeFile<F>

export type FolderCheck = 'all' | 'some' | 'none'

export interface TreeRow<F> {
  node: TreeNode<F>
  depth: number
  /** the folder row this row sits under, null at the top level */
  parent: string | null
}

/** case-insensitive, with the raw comparison as the tie-break so the order never depends on input */
function byName(a: string, b: string): number {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la !== lb) return la < lb ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

interface Draft<F> {
  dirs: Map<string, Draft<F>>
  files: TreeFile<F>[]
}

function finish<F>(draft: Draft<F>, prefix: string): TreeNode<F>[] {
  const folders: TreeFolder<F>[] = []
  for (const [segment, child] of draft.dirs) {
    // a folder holding nothing but one folder is shown as one row: `src/renderer/src`
    let name = segment
    let node = child
    for (;;) {
      const only = node.dirs.size === 1 && node.files.length === 0 ? [...node.dirs][0] : undefined
      if (!only) break
      name += '/' + only[0]
      node = only[1]
    }
    const path = prefix + name
    const children = finish(node, path + '/')
    const files: string[] = []
    for (const c of children) {
      if (c.kind === 'file') files.push(c.path)
      else files.push(...c.files)
    }
    folders.push({ kind: 'folder', path, name, children, files })
  }
  folders.sort((a, b) => byName(a.name, b.name))
  const files = [...draft.files].sort((a, b) => byName(a.name, b.name))
  return [...folders, ...files]
}

/**
 * Group files by directory: folders first, then files, each by name; chains of single-child
 * folders compressed into one row. A rename sits under its new path — `path` is the new one.
 */
export function buildChangesTree<F extends { path: string }>(files: readonly F[]): TreeNode<F>[] {
  const root: Draft<F> = { dirs: new Map(), files: [] }
  for (const file of files) {
    // a trailing slash (an untracked directory, should git ever report one) is not a segment
    const parts = file.path.split('/').filter((p) => p !== '')
    const name = parts.pop()
    if (name === undefined) continue
    let at = root
    for (const part of parts) {
      let next = at.dirs.get(part)
      if (!next) {
        next = { dirs: new Map(), files: [] }
        at.dirs.set(part, next)
      }
      at = next
    }
    at.files.push({ kind: 'file', path: file.path, name, file })
  }
  return finish(root, '')
}

/** how many of a folder's files are checked, as the three states its checkbox can show */
export function folderCheck(folder: { files: readonly string[] }, checked: ReadonlySet<string>): FolderCheck {
  let n = 0
  for (const p of folder.files) if (checked.has(p)) n++
  return n === 0 ? 'none' : n === folder.files.length ? 'all' : 'some'
}

/** a folder's checkbox clicked: all checked → uncheck them all; otherwise check them all */
export function toggleFolder(folder: { files: readonly string[] }, checked: ReadonlySet<string>): Set<string> {
  const next = new Set(checked)
  if (folderCheck(folder, checked) === 'all') for (const p of folder.files) next.delete(p)
  else for (const p of folder.files) next.add(p)
  return next
}

/** the rows on screen: depth-first, the children of a collapsed folder left out */
export function flattenTree<F>(nodes: readonly TreeNode<F>[], collapsed: ReadonlySet<string>): TreeRow<F>[] {
  const rows: TreeRow<F>[] = []
  const walk = (list: readonly TreeNode<F>[], depth: number, parent: string | null): void => {
    for (const node of list) {
      rows.push({ node, depth, parent })
      if (node.kind === 'folder' && !collapsed.has(node.path)) walk(node.children, depth + 1, node.path)
    }
  }
  walk(nodes, 0, null)
  return rows
}
