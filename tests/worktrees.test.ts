import { describe, expect, it } from 'vitest'
import { countPorcelainZ, parseWorktreeList } from '../src/main/git/worktree'
import { liveHints, sessionWorktrees, viewPath, viewSession } from '../src/renderer/src/lib/worktrees'
import type { Project, ProjectWorktrees, RepoWorktree, Session } from '../src/shared/types'
import { isInside, ownerOf, relativeTo, safeToRemove, type RemovalFacts } from '../src/shared/worktrees'

describe('parseWorktreeList', () => {
  it('reads main, linked, detached, locked and prunable entries', () => {
    const out = [
      'worktree /repo',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/x',
      'HEAD bbb',
      'branch refs/heads/feature/x',
      'locked reason here',
      '',
      'worktree /repo-detached',
      'HEAD ccc',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n')
    expect(parseWorktreeList(out)).toEqual<RepoWorktree[]>([
      { path: '/repo', head: 'aaa', branch: 'main', locked: false, prunable: false, isMain: true },
      { path: '/repo/.worktrees/x', head: 'bbb', branch: 'feature/x', locked: true, prunable: false, isMain: false },
      { path: '/repo-detached', head: 'ccc', branch: null, locked: false, prunable: true, isMain: false },
    ])
  })

  it('a bare main entry is left out and does not make the next one main', () => {
    const out = 'worktree /srv/repo.git\nbare\n\nworktree /srv/wt\nHEAD ddd\nbranch refs/heads/b\n'
    expect(parseWorktreeList(out)).toEqual([
      { path: '/srv/wt', head: 'ddd', branch: 'b', locked: false, prunable: false, isMain: false },
    ])
  })

  it('a path with spaces is kept whole', () => {
    expect(parseWorktreeList('worktree /a b/c d\nHEAD e\nbranch refs/heads/m\n')[0]?.path).toBe('/a b/c d')
  })
})

describe('countPorcelainZ', () => {
  it('counts entries, a rename source is not a second file', () => {
    expect(countPorcelainZ('')).toBe(0)
    expect(countPorcelainZ(' M a.ts\0?? new dir/\0R  to.ts\0from.ts\0D  gone.ts\0')).toBe(4)
  })
})

describe('path rules', () => {
  it('isInside does not take a sibling with the same prefix', () => {
    expect(isInside('/repo/x', '/repo')).toBe(true)
    expect(isInside('/repo', '/repo')).toBe(true)
    expect(isInside('/repo-x', '/repo')).toBe(false)
  })

  it('ownerOf picks the longest path', () => {
    const c = ['/repo', '/repo/.worktrees/x', '/repo-wt']
    expect(ownerOf('/repo/.worktrees/x/src/a.ts', c)).toBe('/repo/.worktrees/x')
    expect(ownerOf('/repo/src', c)).toBe('/repo')
    expect(ownerOf('/repo-wt/src', c)).toBe('/repo-wt')
    expect(ownerOf('/elsewhere', c)).toBeNull()
  })

  it('relativeTo names in-repo, sibling and far worktrees', () => {
    expect(relativeTo('/p/repo/.worktrees/x', '/p/repo')).toBe('.worktrees/x')
    expect(relativeTo('/p/repo-x', '/p/repo')).toBe('../repo-x')
    expect(relativeTo('/q/other', '/p/repo')).toBe('/q/other')
  })
})

describe('safeToRemove', () => {
  const ok: RemovalFacts = { isMain: false, locked: false, live: false, changed: 0, unpushed: 0, merged: true }
  it('takes only a clean, pushed, merged, unused linked worktree', () => {
    expect(safeToRemove(ok)).toBe(true)
    expect(safeToRemove({ ...ok, isMain: true })).toBe(false)
    expect(safeToRemove({ ...ok, locked: true })).toBe(false)
    expect(safeToRemove({ ...ok, live: true })).toBe(false)
    expect(safeToRemove({ ...ok, changed: 1 })).toBe(false)
    expect(safeToRemove({ ...ok, unpushed: 2 })).toBe(false)
    expect(safeToRemove({ ...ok, merged: false })).toBe(false)
  })
  it('an unknown count is not zero', () => {
    expect(safeToRemove({ ...ok, changed: null })).toBe(false)
    expect(safeToRemove({ ...ok, unpushed: null })).toBe(false)
  })
})

function session(over: Partial<Session> = {}): Session {
  return { id: 's1', name: 'S', cwd: '/repo', terminals: [], activeTerminalId: null, createdAt: 0, ...over }
}

const wt = (path: string, branch: string | null, isMain = false): RepoWorktree => ({
  path,
  head: 'h',
  branch,
  locked: false,
  prunable: false,
  isMain,
})

const data: ProjectWorktrees = {
  repos: [
    {
      repo: '/repo',
      worktrees: [
        wt('/repo', 'main', true),
        wt('/repo/.worktrees/a', 'A'),
        wt('/repo-b', 'B'),
        wt('/repo/.worktrees/c', 'C'),
      ],
    },
  ],
  sessions: {
    s1: [
      { path: '/repo/.worktrees/a', mentions: 254, lastAt: 200 },
      { path: '/repo-b', mentions: 11, lastAt: 100 },
      { path: '/repo', mentions: 900, lastAt: 300 },
    ],
  },
}

describe('session worktrees (renderer)', () => {
  it('lists linked worktrees in mention order, never the main copy', () => {
    expect(sessionWorktrees(session(), data).map((w) => [w.rel, w.branch])).toEqual([
      ['.worktrees/a', 'A'],
      ['../repo-b', 'B'],
    ])
  })

  it('a session living in a worktree has it first', () => {
    const list = sessionWorktrees(session({ cwd: '/repo/.worktrees/c' }), data)
    expect(list.map((w) => w.path)).toEqual(['/repo/.worktrees/c', '/repo/.worktrees/a', '/repo-b'])
  })

  it('viewPath: the pick while it is still the session’s, else the primary, else the own folder', () => {
    const s = session()
    const list = sessionWorktrees(s, data)
    expect(viewPath(s, list)).toBe('/repo/.worktrees/a')
    expect(viewPath({ ...s, worktreeView: '/repo-b' }, list)).toBe('/repo-b')
    expect(viewPath({ ...s, worktreeView: '/repo' }, list)).toBe('/repo')
    expect(viewPath({ ...s, worktreeView: '/gone' }, list)).toBe('/repo/.worktrees/a')
    expect(viewPath(s, [])).toBe('/repo')
  })

  it('viewSession shows another folder without the session’s own worktree record', () => {
    const s = session({
      cwd: '/repo/.worktrees/c',
      worktree: { path: '/repo/.worktrees/c', branch: 'C', baseRef: 'main' },
    })
    expect(viewSession(s, s.cwd)).toBe(s)
    const shown = viewSession(s, '/repo-b')
    expect(shown.cwd).toBe('/repo-b')
    expect(shown.worktree).toBeUndefined()
  })

  it('liveHints: every session folder, and every worktree a running agent touched', () => {
    const running = session({ terminals: [{ id: 't1', kind: 'agent', title: 'a' }] })
    const idle = session({ id: 's2', cwd: '/repo/.worktrees/c', terminals: [{ id: 't2', kind: 'agent', title: 'b' }] })
    const project = { sessions: [running, idle] } as unknown as Project
    expect(liveHints([project], new Set(['t1']), data).sort()).toEqual([
      '/repo',
      '/repo-b',
      '/repo/.worktrees/a',
      '/repo/.worktrees/c',
    ])
  })
})
