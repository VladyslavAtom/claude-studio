import { describe, expect, it } from 'vitest'
import { detectEol, toLf, withEol } from '../src/renderer/src/lib/lineEndings'
import { movedPath, onPathsMoved, pathsMoved } from '../src/renderer/src/lib/pathEvents'
import { appReducer } from '../src/renderer/src/state/appReducer'
import { emptyState, type AppState, type TerminalTab } from '../src/shared/types'

describe('line endings', () => {
  it('detects CRLF and LF by the majority of line breaks', () => {
    expect(detectEol('a\r\nb\r\n')).toBe('\r\n')
    expect(detectEol('a\nb\n')).toBe('\n')
    expect(detectEol('a\r\nb\nc\r\n')).toBe('\r\n')
    expect(detectEol('a\nb\nc\r\n')).toBe('\n')
    expect(detectEol('no break')).toBe('\n')
  })

  it('round-trips a CRLF file through an LF buffer unchanged', () => {
    const disk = 'one\r\ntwo\r\nthree\r\n'
    const buffer = toLf(disk)
    expect(buffer).toBe('one\ntwo\nthree\n')
    expect(withEol(buffer, detectEol(disk))).toBe(disk)
  })

  it('keeps an LF file as it is and folds a lone CR the way CodeMirror does', () => {
    expect(withEol('a\nb', '\n')).toBe('a\nb')
    expect(toLf('a\rb\r\nc')).toBe('a\nb\nc')
  })
})

describe('movedPath', () => {
  const moves = [{ from: '/p/src/old', to: '/p/src/new' }]

  it('follows the entry itself and anything under a moved folder', () => {
    expect(movedPath('/p/src/old', moves)).toBe('/p/src/new')
    expect(movedPath('/p/src/old/a/b.ts', moves)).toBe('/p/src/new/a/b.ts')
  })

  it('leaves a sibling with the same prefix alone', () => {
    expect(movedPath('/p/src/older.ts', moves)).toBeNull()
    expect(movedPath('/p/other.ts', moves)).toBeNull()
  })

  it('delivers moves to listeners until they unsubscribe, and drops an empty list', () => {
    const got: string[] = []
    const off = onPathsMoved((m) => got.push(...m.map((x) => x.to)))
    pathsMoved([])
    pathsMoved([{ from: '/a', to: '/b' }])
    off()
    pathsMoved([{ from: '/c', to: '/d' }])
    expect(got).toEqual(['/b'])
  })
})

describe('pathsMoved in the reducer', () => {
  const tab = (id: string, filePath: string, over: Partial<TerminalTab> = {}): TerminalTab => ({
    id,
    kind: 'editor',
    title: filePath.split('/').pop() ?? '',
    filePath,
    startedAt: 0,
    ...over,
  })
  const state = (terminals: TerminalTab[]): AppState => ({
    ...emptyState,
    projects: [
      {
        id: 'p1',
        name: 'repo',
        path: '/repo',
        isGit: true,
        sessions: [{ id: 's1', name: 's', cwd: '/repo', terminals, activeTerminalId: null, createdAt: 0 }],
        activeSessionId: 's1',
        history: [],
      },
    ],
  })

  it('moves editor tabs under a renamed folder, and their title unless a person named it', () => {
    const before = state([tab('a', '/repo/src/x.ts'), tab('b', '/repo/src/y.ts', { title: 'mine', titleManual: true })])
    const next = appReducer(before, { type: 'pathsMoved', moves: [{ from: '/repo/src', to: '/repo/lib' }] })
    const terms = next.projects[0]?.sessions[0]?.terminals ?? []
    expect(terms.map((t) => [t.filePath, t.title])).toEqual([
      ['/repo/lib/x.ts', 'x.ts'],
      ['/repo/lib/y.ts', 'mine'],
    ])
  })

  it('returns the same state when no tab is touched', () => {
    const before = state([tab('a', '/repo/src/x.ts')])
    expect(appReducer(before, { type: 'pathsMoved', moves: [{ from: '/repo/docs', to: '/repo/d' }] })).toBe(before)
  })
})
