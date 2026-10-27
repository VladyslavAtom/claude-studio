import { describe, expect, it } from 'vitest'
import type { RefreshTab } from '../src/renderer/src/lib/changesRefresh'
import {
  BLIND_POLL_MS,
  WORKING_POLL_MS,
  changesInvalidated,
  fallbackPollMs,
  onChangesInvalidated,
  pathsOverlap,
  sameJson,
} from '../src/renderer/src/lib/changesRefresh'

const tab = (over: Partial<RefreshTab>): RefreshTab => ({
  kind: 'agent',
  source: 'uuid',
  awake: true,
  silent: false,
  working: false,
  ...over,
})

describe('fallbackPollMs', () => {
  it('does not poll when nothing is open or everything reports', () => {
    expect(fallbackPollMs([])).toBeNull()
    expect(fallbackPollMs([tab({})])).toBeNull()
    expect(
      fallbackPollMs([tab({ kind: 'editor', source: undefined }), tab({ kind: 'diff', source: undefined })]),
    ).toBeNull()
  })

  it('ignores sleeping tabs whatever they are', () => {
    expect(fallbackPollMs([tab({ kind: 'shell', source: undefined, awake: false })])).toBeNull()
    expect(fallbackPollMs([tab({ source: 'codex', awake: false, working: true })])).toBeNull()
  })

  it('polls slowly for tabs that cannot report a turn end', () => {
    expect(fallbackPollMs([tab({ kind: 'shell', source: undefined })])).toBe(BLIND_POLL_MS)
    expect(fallbackPollMs([tab({ source: 'codex' })])).toBe(BLIND_POLL_MS)
    expect(fallbackPollMs([tab({ source: 'none' })])).toBe(BLIND_POLL_MS)
    expect(fallbackPollMs([tab({ silent: true })])).toBe(BLIND_POLL_MS)
  })

  it('polls faster while anything works, and the fastest wins', () => {
    expect(fallbackPollMs([tab({ working: true })])).toBe(WORKING_POLL_MS)
    expect(fallbackPollMs([tab({ source: 'codex' }), tab({ working: true })])).toBe(WORKING_POLL_MS)
    expect(WORKING_POLL_MS).toBeLessThan(BLIND_POLL_MS)
  })
})

describe('pathsOverlap', () => {
  it('matches the same path, either side inside the other, trailing slashes aside', () => {
    expect(pathsOverlap('/p', '/p/')).toBe(true)
    expect(pathsOverlap('/p/src/a.ts', '/p')).toBe(true)
    expect(pathsOverlap('/p', '/p/.claude/worktrees/w')).toBe(true)
  })

  it('does not match a sibling that merely shares a prefix', () => {
    expect(pathsOverlap('/p2/a.ts', '/p')).toBe(false)
    expect(pathsOverlap('/q', '/p')).toBe(false)
  })
})

describe('changesInvalidated', () => {
  it('reaches every listener until it unsubscribes', () => {
    const got: string[] = []
    const off = onChangesInvalidated((p) => got.push(p))
    changesInvalidated('/p/a')
    off()
    changesInvalidated('/p/b')
    expect(got).toEqual(['/p/a'])
  })
})

describe('sameJson', () => {
  it('compares by content', () => {
    expect(sameJson({ files: [{ path: 'a' }] }, { files: [{ path: 'a' }] })).toBe(true)
    expect(sameJson({ files: [{ path: 'a' }] }, { files: [{ path: 'b' }] })).toBe(false)
    expect(sameJson(null, { files: [] })).toBe(false)
  })
})
