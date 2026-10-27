import { describe, expect, it } from 'vitest'
import type { Project, Session } from '../src/shared/types'
import { safeToDiscard, watchedDirs } from '../src/renderer/src/lib/sessionHealth'

const session = (cwd: string): Session => ({
  id: cwd,
  name: cwd,
  cwd,
  terminals: [],
  activeTerminalId: null,
  createdAt: 0,
  runs: [],
})

const project = (path: string, cwds: string[]): Project =>
  ({
    id: path,
    name: path,
    path,
    isGit: true,
    sessions: cwds.map(session),
    activeSessionId: null,
  }) as unknown as Project

describe('watchedDirs', () => {
  it('lists each project folder and session directory once, sorted', () => {
    const dirs = watchedDirs([project('/b', ['/b', '/b/.wt/x']), project('/a', ['/a'])])
    expect(dirs).toEqual(['/a', '/b', '/b/.wt/x'])
  })
})

describe('safeToDiscard', () => {
  it('only clean, fully merged work may go by default', () => {
    expect(safeToDiscard({ files: 0, ahead: 0 })).toBe(true)
  })
  it('keeps uncommitted files, unmerged commits, and anything not yet known', () => {
    expect(safeToDiscard({ files: 2, ahead: 0 })).toBe(false)
    expect(safeToDiscard({ files: 0, ahead: 1 })).toBe(false)
    expect(safeToDiscard(null)).toBe(false)
    expect(safeToDiscard(undefined)).toBe(false)
  })
})
