import { describe, expect, it } from 'vitest'
import { MAX_SNAPSHOTS, MAX_SNAPSHOT_CHARS, dropSnapshots, putSnapshot } from '../src/renderer/src/lib/snapshots'

/**
 * The store behind the frozen screen of a sleeping tab. Two of its rules are the ones that can be
 * wrong without anything looking wrong: a snapshot that outstays the tab it belonged to is memory
 * nobody will ever reclaim, and a snapshot left in place after a failed capture puts the screen of
 * a previous life in front of a person who has no way of knowing it is old.
 */

const screen = (text: string): string => `\x1b[32m${text}\x1b[0m`

describe('putSnapshot', () => {
  it('keeps the last screen under its terminal id', () => {
    const store = putSnapshot(new Map(), 'a', screen('hello'))
    expect(store.get('a')).toBe(screen('hello'))
  })

  it('replaces the previous screen of the same tab', () => {
    const store = putSnapshot(putSnapshot(new Map(), 'a', screen('old')), 'a', screen('new'))
    expect(store.get('a')).toBe(screen('new'))
    expect(store.size).toBe(1)
  })

  it('does not touch the map it was given', () => {
    const before = putSnapshot(new Map(), 'a', screen('one'))
    putSnapshot(before, 'b', screen('two'))
    expect([...before.keys()]).toEqual(['a'])
  })

  // a capture that came to nothing must not leave an older screen on view
  it('an empty capture removes what was stored', () => {
    const store = putSnapshot(putSnapshot(new Map(), 'a', screen('old')), 'a', '')
    expect(store.has('a')).toBe(false)
  })

  it('a capture past the size limit is dropped, not truncated', () => {
    const huge = 'x'.repeat(MAX_SNAPSHOT_CHARS + 1)
    const store = putSnapshot(putSnapshot(new Map(), 'a', screen('old')), 'a', huge)
    expect(store.has('a')).toBe(false)
  })

  // the same object back means React is not told to re-render for a change that did not happen
  it('an empty capture for an unknown tab changes nothing', () => {
    const before = putSnapshot(new Map(), 'a', screen('one'))
    expect(putSnapshot(before, 'b', '')).toBe(before)
  })

  it('forgets the oldest once too many pile up', () => {
    let store = new Map<string, string>()
    for (let i = 0; i < MAX_SNAPSHOTS + 3; i++) store = putSnapshot(store, `t${i}`, screen(`screen ${i}`))
    expect(store.size).toBe(MAX_SNAPSHOTS)
    expect(store.has('t0')).toBe(false)
    expect(store.has('t2')).toBe(false)
    expect(store.has(`t${MAX_SNAPSHOTS + 2}`)).toBe(true)
  })

  // re-capturing a tab makes it the newest, or a tab that is looked at again would be evicted
  // while tabs nobody has touched since survive
  it('a fresh capture moves the tab to the back of the queue', () => {
    let store = new Map<string, string>()
    for (let i = 0; i < MAX_SNAPSHOTS; i++) store = putSnapshot(store, `t${i}`, screen(`screen ${i}`))
    store = putSnapshot(store, 't0', screen('again'))
    store = putSnapshot(store, 'new', screen('newcomer'))
    expect(store.has('t0')).toBe(true)
    expect(store.has('t1')).toBe(false)
  })
})

describe('dropSnapshots', () => {
  it('forgets the screens of closed tabs', () => {
    const store = dropSnapshots(putSnapshot(putSnapshot(new Map(), 'a', screen('a')), 'b', screen('b')), ['a'])
    expect([...store.keys()]).toEqual(['b'])
  })

  it('gives the same map back when none of the ids are stored', () => {
    const before = putSnapshot(new Map(), 'a', screen('a'))
    expect(dropSnapshots(before, ['b', 'c'])).toBe(before)
  })
})
