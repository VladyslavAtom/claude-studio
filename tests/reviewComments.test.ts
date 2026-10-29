import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import {
  clickedRange,
  fenceFor,
  formatReviewPrompt,
  locationOf,
  reviewReducer,
  sortComments,
  type ReviewComment,
  type ReviewStore,
} from '../src/renderer/src/lib/reviewComments'
import { PASTE_END, PASTE_START, typedForm } from '../src/renderer/src/lib/agentInput'

const CWD = '/w/feature'

const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 'c1',
  cwd: CWD,
  path: 'src/a.ts',
  from: 1,
  to: 1,
  code: 'const a = 1',
  text: 'why one?',
  ...over,
})

describe('reviewReducer', () => {
  it('adds, edits and removes per session, and drops a session left empty', () => {
    let s: ReviewStore = {}
    s = reviewReducer(s, { type: 'added', sessionId: 's1', comment: comment({ id: 'a' }) })
    s = reviewReducer(s, { type: 'added', sessionId: 's1', comment: comment({ id: 'b' }) })
    s = reviewReducer(s, { type: 'added', sessionId: 's2', comment: comment({ id: 'c' }) })
    s = reviewReducer(s, { type: 'edited', sessionId: 's1', id: 'b', text: 'new' })
    expect(s.s1?.map((c) => [c.id, c.text])).toEqual([
      ['a', 'why one?'],
      ['b', 'new'],
    ])
    s = reviewReducer(s, { type: 'removed', sessionId: 's1', ids: ['a', 'b'] })
    expect(s.s1).toBeUndefined()
    expect(s.s2).toHaveLength(1)
  })

  it('returns the same store when nothing matched', () => {
    const s: ReviewStore = { s1: [comment({})] }
    expect(reviewReducer(s, { type: 'edited', sessionId: 's1', id: 'nope', text: 'x' })).toBe(s)
    expect(reviewReducer(s, { type: 'removed', sessionId: 's1', ids: ['nope'] })).toBe(s)
  })
})

describe('sortComments', () => {
  it('orders by file, then by line', () => {
    const list = [
      comment({ id: '1', path: 'b.ts', from: 1 }),
      comment({ id: '2', path: 'a.ts', from: 9 }),
      comment({ id: '3', path: 'a.ts', from: 2 }),
    ]
    expect(sortComments(list).map((c) => c.id)).toEqual(['3', '2', '1'])
  })
})

describe('fenceFor', () => {
  it('outlasts any run of backticks in the code', () => {
    expect(fenceFor('plain')).toBe('```')
    expect(fenceFor('a ```js b')).toBe('````')
  })
})

describe('locationOf', () => {
  it('names one line or a range, relative to the session, absolute outside it', () => {
    expect(locationOf(comment({ from: 42, to: 42 }), CWD)).toBe('src/a.ts:42')
    expect(locationOf(comment({ from: 42, to: 45 }), CWD)).toBe('src/a.ts:42-45')
    expect(locationOf(comment({ cwd: '/other/' }), CWD)).toBe('/other/src/a.ts:1')
  })
})

describe('formatReviewPrompt', () => {
  it('numbers the comments in reading order, each with its lines in a fence', () => {
    const text = formatReviewPrompt(
      [
        comment({ id: '2', path: 'z.ts', from: 3, to: 4, code: 'x\r\ny', text: '  rename\r\n' }),
        comment({ id: '1', path: 'a.ts', from: 7, to: 7, code: 'k()', text: 'drop it' }),
      ],
      CWD,
    )
    expect(text).toBe(
      [
        'Review comments on your changes (2). Address each one; the quoted lines are the working file as the reviewer saw it.',
        '1. a.ts:7\n```\nk()\n```\ndrop it',
        '2. z.ts:3-4\n```\nx\ny\n```\nrename',
      ].join('\n\n'),
    )
  })
})

describe('typedForm', () => {
  it('wraps multi-line text in a bracketed paste and types one line raw', () => {
    expect(typedForm('one line')).toBe('one line')
    expect(typedForm('a\nb')).toBe(`${PASTE_START}a\nb${PASTE_END}`)
  })
})

describe('clickedRange', () => {
  const doc = 'l1\nl2\nl3\nl4\nl5'
  const at = (anchor: number, head: number): EditorState =>
    EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })

  it('takes the selected lines when the click is inside them', () => {
    // from inside l2 to inside l4
    expect(clickedRange(at(4, 10), 3)).toEqual({ from: 2, to: 4 })
  })
  it('takes the clicked line alone outside the selection or without one', () => {
    expect(clickedRange(at(4, 10), 5)).toEqual({ from: 5, to: 5 })
    expect(clickedRange(at(0, 0), 2)).toEqual({ from: 2, to: 2 })
  })
  it('leaves out a line the selection only touches at its start', () => {
    // l2 start .. l4 start: l4 is not taken
    expect(clickedRange(at(3, 9), 2)).toEqual({ from: 2, to: 3 })
  })
})
