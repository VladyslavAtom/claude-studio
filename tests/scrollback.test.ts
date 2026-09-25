import { describe, expect, it } from 'vitest'
import type { Scrollback } from '../src/main/scrollback'
import {
  CHARS_PER_LINE,
  NO_LIMIT,
  appendChunk,
  charLimitForLines,
  clearChunks,
  joinChunks,
  trimToTail,
} from '../src/main/scrollback'

/**
 * The buffer main replays to a pane that (re)attaches. What can be wrong here without looking
 * wrong is the shape the chunk list is left in: `chunksLen` is kept alongside the chunks instead
 * of being counted, so any operation that edits one and not the other makes the limit lie, and
 * the lie only surfaces a session switch later as output that is missing or doubled.
 */

const empty = (): Scrollback => ({ chunks: [], chunksLen: 0 })

/** the invariant every function here has to leave standing */
const consistent = (s: Scrollback): boolean => s.chunksLen === joinChunks(s).length

describe('appendChunk', () => {
  it('keeps what was written, in order', () => {
    const s = empty()
    appendChunk(s, 'one ')
    appendChunk(s, 'two')
    expect(joinChunks(s)).toBe('one two')
    expect(consistent(s)).toBe(true)
  })

  it('drops the oldest chunks once past the limit', () => {
    const s = empty()
    appendChunk(s, 'aaaa', 6)
    appendChunk(s, 'bbbb', 6)
    expect(joinChunks(s)).toBe('bbbb')
    expect(consistent(s)).toBe(true)
  })

  // the last chunk is never dropped whole: it is the newest output, and something has to be shown
  it('trims inside the last chunk when that one alone is too long', () => {
    const s = empty()
    appendChunk(s, 'abcdefghij', 4)
    expect(joinChunks(s)).toBe('ghij')
    expect(consistent(s)).toBe(true)
  })

  // the default of the setting is «no limit», so it has to be the default here too: a caller
  // that forgets the argument must keep everything rather than silently cut at some old number
  it('keeps everything when no limit is given', () => {
    const s = empty()
    for (let i = 0; i < 1000; i++) appendChunk(s, 'x'.repeat(1000))
    expect(s.chunksLen).toBe(1_000_000)
    expect(consistent(s)).toBe(true)
  })

  it('never trims under NO_LIMIT, however much arrives', () => {
    const s = empty()
    appendChunk(s, 'first ', NO_LIMIT)
    appendChunk(s, 'second', NO_LIMIT)
    expect(joinChunks(s)).toBe('first second')
    expect(s.chunks).toHaveLength(2)
    expect(consistent(s)).toBe(true)
  })
})

describe('charLimitForLines', () => {
  // the two limits count different things; this is the stated, generous rate between them
  it('converts lines to characters at the declared rate', () => {
    expect(charLimitForLines(1000)).toBe(1000 * CHARS_PER_LINE)
  })

  it('gives no limit at all for «no limit»', () => {
    expect(charLimitForLines(null)).toBe(NO_LIMIT)
  })

  // a limit of zero characters would trim every chunk to nothing on arrival, and the pane would
  // re-attach to an empty screen; the smallest limit still keeps the newest characters
  it('never returns zero, whatever tiny line count it is given', () => {
    expect(charLimitForLines(0)).toBeGreaterThan(0)
    expect(charLimitForLines(0.001)).toBeGreaterThan(0)
  })

  it('is generous rather than exact: a line of output fits several times over', () => {
    expect(CHARS_PER_LINE).toBeGreaterThan(80)
  })
})

describe('clearChunks', () => {
  it('leaves nothing to replay', () => {
    const s = empty()
    appendChunk(s, 'printed before the clear')
    clearChunks(s)
    expect(joinChunks(s)).toBe('')
    expect(consistent(s)).toBe(true)
  })

  // the point of the whole thing: what is written afterwards is all a re-attach may paint back
  it('a later append starts the history afresh', () => {
    const s = empty()
    appendChunk(s, 'old output')
    clearChunks(s)
    appendChunk(s, 'new output')
    expect(joinChunks(s)).toBe('new output')
    expect(consistent(s)).toBe(true)
  })

  it('the limit still holds after a clear', () => {
    const s = empty()
    appendChunk(s, 'aaaa', 6)
    clearChunks(s)
    appendChunk(s, 'bbbb', 6)
    appendChunk(s, 'cccc', 6)
    expect(joinChunks(s)).toBe('cccc')
    expect(consistent(s)).toBe(true)
  })

  it('clearing an empty buffer is not an error', () => {
    const s = empty()
    clearChunks(s)
    expect(joinChunks(s)).toBe('')
    expect(consistent(s)).toBe(true)
  })
})

describe('trimToTail', () => {
  it('keeps the last chars and nothing else', () => {
    const s = empty()
    appendChunk(s, 'first ')
    appendChunk(s, 'second')
    trimToTail(s, 6)
    expect(joinChunks(s)).toBe('second')
    expect(consistent(s)).toBe(true)
  })

  // an exited pty is trimmed to whatever limit is in force, and at no limit that is nothing to do
  it('no limit leaves the whole buffer, chunks and all', () => {
    const s = empty()
    appendChunk(s, 'first ')
    appendChunk(s, 'second')
    const chunksBefore = s.chunks.length
    trimToTail(s, NO_LIMIT)
    expect(joinChunks(s)).toBe('first second')
    // not merely correct — untouched: no join, no copy of a history that is not being cut
    expect(s.chunks.length).toBe(chunksBefore)
    expect(consistent(s)).toBe(true)
  })

  it('a buffer shorter than the tail is left alone', () => {
    const s = empty()
    appendChunk(s, 'short')
    trimToTail(s, 400)
    expect(joinChunks(s)).toBe('short')
    expect(consistent(s)).toBe(true)
  })

  // `slice(-0)` is `slice(0)` and would have kept the whole buffer
  it('a tail of nothing keeps nothing', () => {
    const s = empty()
    appendChunk(s, 'output')
    trimToTail(s, 0)
    expect(joinChunks(s)).toBe('')
    expect(s.chunks).toEqual([])
    expect(consistent(s)).toBe(true)
  })

  it('an append after a trim is appended, not lost', () => {
    const s = empty()
    appendChunk(s, 'first second')
    trimToTail(s, 6)
    appendChunk(s, ' third')
    expect(joinChunks(s)).toBe('second third')
    expect(consistent(s)).toBe(true)
  })
})
