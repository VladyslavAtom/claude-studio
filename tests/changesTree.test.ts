import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../src/renderer/src/lib/changesTree'
import { buildChangesTree, flattenTree, folderCheck, toggleFolder } from '../src/renderer/src/lib/changesTree'

const f = (path: string, oldPath?: string): { path: string; oldPath?: string } =>
  oldPath === undefined ? { path } : { path, oldPath }

/** the tree as indented names: easier to read in a failure than nested objects */
function outline(nodes: readonly TreeNode<unknown>[], depth = 0): string[] {
  return nodes.flatMap((n) =>
    n.kind === 'folder'
      ? [`${'  '.repeat(depth)}${n.name}/ (${n.files.length})`, ...outline(n.children, depth + 1)]
      : [`${'  '.repeat(depth)}${n.name}`],
  )
}

describe('buildChangesTree', () => {
  it('compresses single-child folder chains into one row', () => {
    const tree = buildChangesTree([f('src/renderer/src/a.ts'), f('src/renderer/src/lib/b.ts')])
    expect(outline(tree)).toEqual(['src/renderer/src/ (2)', '  lib/ (1)', '    b.ts', '  a.ts'])
    const top = tree[0]
    expect(top?.kind === 'folder' && top.path).toBe('src/renderer/src')
  })

  it('does not compress a folder that holds files of its own', () => {
    const tree = buildChangesTree([f('src/x.ts'), f('src/renderer/y.ts')])
    expect(outline(tree)).toEqual(['src/ (2)', '  renderer/ (1)', '    y.ts', '  x.ts'])
    const renderer = tree[0]?.kind === 'folder' ? tree[0].children[0] : undefined
    expect(renderer?.path).toBe('src/renderer')
  })

  it('puts folders first, then files, each by name, case-insensitively', () => {
    const tree = buildChangesTree([f('b.ts'), f('Z/1'), f('A.ts'), f('a/1'), f('c/1')])
    expect(tree.map((n) => n.name)).toEqual(['a', 'c', 'Z', 'A.ts', 'b.ts'])
  })

  it('is stable whatever the input order', () => {
    const paths = ['src/b.ts', 'src/a.ts', 'docs/x.md', 'README.md', 'src/lib/c.ts']
    const one = outline(buildChangesTree(paths.map((p) => f(p))))
    const two = outline(buildChangesTree([...paths].reverse().map((p) => f(p))))
    expect(one).toEqual(two)
  })

  it('counts every file under a folder, at any depth', () => {
    const tree = buildChangesTree([f('a/b/c.ts'), f('a/d.ts'), f('a/b/e/f.ts')])
    const a = tree[0]
    expect(a?.kind === 'folder' && [...a.files].sort()).toEqual(['a/b/c.ts', 'a/b/e/f.ts', 'a/d.ts'])
  })

  it('places a rename by its new path and keeps the file object', () => {
    const renamed = f('new/place.ts', 'old/place.ts')
    const tree = buildChangesTree([renamed])
    expect(outline(tree)).toEqual(['new/ (1)', '  place.ts'])
    const leaf = tree[0]?.kind === 'folder' ? tree[0].children[0] : undefined
    expect(leaf?.kind === 'file' && leaf.file).toBe(renamed)
  })

  it('keeps root files at the top level and ignores a trailing slash', () => {
    expect(outline(buildChangesTree([f('README.md'), f('tmp/')]))).toEqual(['README.md', 'tmp'])
  })

  it('returns nothing for nothing', () => {
    expect(buildChangesTree([])).toEqual([])
  })
})

describe('folder check state', () => {
  const folder = { files: ['a/1', 'a/2', 'a/b/3'] }

  it('derives all / some / none from the checked set', () => {
    expect(folderCheck(folder, new Set())).toBe('none')
    expect(folderCheck(folder, new Set(['a/2', 'elsewhere']))).toBe('some')
    expect(folderCheck(folder, new Set(['a/1', 'a/2', 'a/b/3']))).toBe('all')
  })

  it('checks every file when some or none are checked, keeping the rest of the set', () => {
    expect([...toggleFolder(folder, new Set(['x', 'a/2']))].sort()).toEqual(['a/1', 'a/2', 'a/b/3', 'x'])
    expect([...toggleFolder(folder, new Set())].sort()).toEqual(['a/1', 'a/2', 'a/b/3'])
  })

  it('unchecks every file when all are checked, keeping the rest of the set', () => {
    expect([...toggleFolder(folder, new Set(['x', 'a/1', 'a/2', 'a/b/3']))]).toEqual(['x'])
  })

  it('does not mutate the set it was given', () => {
    const before = new Set(['a/1'])
    toggleFolder(folder, before)
    expect([...before]).toEqual(['a/1'])
  })
})

describe('flattenTree', () => {
  const tree = buildChangesTree([f('a/x.ts'), f('a/b/y.ts'), f('z.ts')])

  it('lists every row depth-first with its depth and parent', () => {
    expect(flattenTree(tree, new Set()).map((r) => [r.node.path, r.depth, r.parent])).toEqual([
      ['a', 0, null],
      ['a/b', 1, 'a'],
      ['a/b/y.ts', 2, 'a/b'],
      ['a/x.ts', 1, 'a'],
      ['z.ts', 0, null],
    ])
  })

  it('leaves out what is under a collapsed folder, but keeps the folder row', () => {
    expect(flattenTree(tree, new Set(['a'])).map((r) => r.node.path)).toEqual(['a', 'z.ts'])
    expect(flattenTree(tree, new Set(['a/b'])).map((r) => r.node.path)).toEqual(['a', 'a/b', 'a/x.ts', 'z.ts'])
  })
})
