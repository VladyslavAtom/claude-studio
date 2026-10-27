import { describe, expect, it } from 'vitest'
import type { Session } from '../src/shared/types'
import { depthOf, descendants, treeRows } from '../src/renderer/src/lib/sessionTree'

function s(id: string, parentId?: string): Session {
  return {
    id,
    name: id,
    cwd: `/repo/${id}`,
    terminals: [],
    activeTerminalId: null,
    createdAt: 0,
    ...(parentId ? { parentId } : {}),
  }
}

const rows = (list: Session[], collapsed: string[] = []): string[] =>
  treeRows(list, new Set(collapsed)).map((r) => `${'  '.repeat(r.depth)}${r.session.id}`)

describe('treeRows', () => {
  it('puts children under their parent, in list order, whatever the order of the flat list', () => {
    expect(rows([s('b', 'a'), s('x'), s('a'), s('c', 'b'), s('d', 'a')])).toEqual(['x', 'a', '  b', '    c', '  d'])
  })

  it('keeps the flat index: drag and drop reorders the stored list, not the rows', () => {
    const r = treeRows([s('b', 'a'), s('a')], new Set())
    expect(r.map((x) => [x.session.id, x.index])).toEqual([
      ['a', 1],
      ['b', 0],
    ])
  })

  it('shows a session whose parent is gone at the top level instead of hiding it', () => {
    expect(rows([s('a'), s('orphan', 'closed')])).toEqual(['a', 'orphan'])
  })

  it('a cycle from a corrupt file loses no session', () => {
    expect(
      rows([s('a', 'b'), s('b', 'a')])
        .map((x) => x.trim())
        .sort(),
    ).toEqual(['a', 'b'])
  })

  it('folds the whole subtree into the parent row, which carries it for the pulse', () => {
    const list = [s('a'), s('b', 'a'), s('c', 'b')]
    expect(rows(list, ['a'])).toEqual(['a'])
    const [row] = treeRows(list, new Set(['a']))
    expect(row?.childCount).toBe(1)
    expect(row?.hidden.map((x) => x.id)).toEqual(['b', 'c'])
  })
})

describe('descendants and depthOf', () => {
  const list = [s('a'), s('b', 'a'), s('c', 'b'), s('d')]

  it('lists the subtree parents first', () => {
    expect(descendants(list, 'a').map((x) => x.id)).toEqual(['b', 'c'])
    expect(descendants(list, 'd')).toEqual([])
  })

  it('counts the levels above a session', () => {
    expect(depthOf(list, 'a')).toBe(0)
    expect(depthOf(list, 'c')).toBe(2)
    expect(depthOf([s('x', 'gone')], 'x')).toBe(0)
  })
})
