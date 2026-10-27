import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'
import {
  baseSeeds,
  layout,
  parseConflicts,
  renderBlocks,
  renderResult,
  sideLabels,
  spacers,
} from '../src/renderer/src/lib/merge3'
import { gapsFor, regionsExtension, regionsField, sideSpec } from '../src/renderer/src/lib/mergeState'

const MERGE = 'a\n<<<<<<< HEAD\nmine\n=======\ntheirs 1\ntheirs 2\n>>>>>>> feature\nz\n'
const DIFF3 = 'a\n<<<<<<< HEAD\nmine\n||||||| base\nold\n=======\ntheirs\n>>>>>>> feature\nz\n'

describe('parseConflicts / renderBlocks', () => {
  it.each([
    ['merge style', MERGE],
    ['diff3 style', DIFF3],
    ['an empty base chunk', 'a\n<<<<<<< HEAD\nx\n||||||| base\n=======\ny\n>>>>>>> b\n'],
    ['an empty side', 'a\n<<<<<<< HEAD\n=======\ny\n>>>>>>> b\nz'],
    ['a side holding one empty line', '<<<<<<< HEAD\n\n=======\ny\n>>>>>>> b\n'],
    ['two conflicts back to back', '<<<<<<< H\n1\n=======\n2\n>>>>>>> b\n<<<<<<< H\n3\n=======\n4\n>>>>>>> b\n'],
  ])('gives back %s unchanged', (_, text) => {
    expect(renderBlocks(parseConflicts(text))).toBe(text)
  })

  it('tells an empty side from one empty line', () => {
    const [empty] = parseConflicts('<<<<<<< H\n=======\ny\n>>>>>>> b\n')
    const [blank] = parseConflicts('<<<<<<< H\n\n=======\ny\n>>>>>>> b\n')
    expect(empty).toMatchObject({ kind: 'conflict', ours: [] })
    expect(blank).toMatchObject({ kind: 'conflict', ours: [''] })
  })
})

describe('baseSeeds', () => {
  it('takes the base from the file when its markers carry one', () => {
    expect(baseSeeds(parseConflicts(DIFF3), undefined)).toEqual([['old']])
  })

  it('takes it from the re-merged stages by matching both sides', () => {
    const diff3 = 'a\n<<<<<<< x\nmine\n||||||| y\nold 1\nold 2\n=======\ntheirs 1\ntheirs 2\n>>>>>>> z\nz\n'
    expect(baseSeeds(parseConflicts(MERGE), diff3)).toEqual([['old 1', 'old 2']])
  })

  it('starts a conflict it cannot match empty', () => {
    expect(baseSeeds(parseConflicts(MERGE), DIFF3)).toEqual([[]])
  })
})

describe('layout', () => {
  it("puts git's «ours» on the left for a merge and «theirs» for a rebase", () => {
    const blocks = parseConflicts(MERGE)
    const merge = layout(blocks, [['old']], 'ours')
    expect(merge.left).toBe('a\nmine\nz\n')
    expect(merge.right).toBe('a\ntheirs 1\ntheirs 2\nz\n')
    expect(merge.result).toBe('a\nold\nz\n')
    const rebase = layout(blocks, [['old']], 'theirs')
    expect(rebase.left).toBe('a\ntheirs 1\ntheirs 2\nz\n')
    expect(rebase.right).toBe('a\nmine\nz\n')
  })

  it('places the conflict in the result on whole lines', () => {
    const l = layout(parseConflicts(MERGE), [['old']], 'ours')
    const [r] = l.regions
    expect(l.result.slice(r?.from, r?.to)).toBe('old\n')
    expect(l.leftHeights).toEqual([1, 1, 2])
    expect(l.rightHeights).toEqual([1, 2, 2])
  })

  it('writes an untouched result back as the original file', () => {
    const l = layout(parseConflicts(MERGE), [['old']], 'ours')
    const states = l.regions.map((r) => ({ from: r.from, to: r.to, resolved: false }))
    expect(renderResult(l.result, l.regions, states, l.blocks)).toBe(MERGE)
  })
})

describe('spacers', () => {
  it('fills every pane up to the tallest, block by block', () => {
    expect(
      spacers([
        [1, 1, 2],
        [1, 0, 2],
        [1, 3, 2],
      ]),
    ).toEqual([
      [0, 2, 0],
      [0, 3, 0],
      [0, 0, 0],
    ])
  })
})

describe('the live result', () => {
  const l = layout(parseConflicts(MERGE), [['old']], 'ours')
  const fresh = (): EditorState => EditorState.create({ doc: l.result, extensions: [history(), regionsExtension(l)] })
  const region = l.regions[0]
  if (!region) throw new Error('no conflict')

  it('takes one side, then appends the other', () => {
    let s = fresh()
    s = s.update(sideSpec(s, 0, 'incoming', region.incoming) ?? {}).state
    expect(s.doc.toString()).toBe('a\ntheirs 1\ntheirs 2\nz\n')
    s = s.update(sideSpec(s, 0, 'yours', region.yours) ?? {}).state
    expect(s.doc.toString()).toBe('a\ntheirs 1\ntheirs 2\nmine\nz\n')
    expect(s.field(regionsField)[0]).toMatchObject({ yours: true, incoming: true, resolved: true })
    expect(sideSpec(s, 0, 'yours', region.yours)).toBeNull()
  })

  it('counts a hand edit inside a conflict as settling it, and one beside it as not', () => {
    let s = fresh()
    s = s.update({ changes: { from: 0, insert: 'x' } }).state
    expect(s.field(regionsField)[0]?.resolved).toBe(false)
    const r = s.field(regionsField)[0]
    s = s.update({ changes: { from: r?.from ?? 0, insert: 'new ' } }).state
    expect(s.field(regionsField)[0]?.resolved).toBe(true)
  })

  it('reopens the conflict on undo', () => {
    let s = fresh()
    s = s.update(sideSpec(s, 0, 'yours', region.yours) ?? {}).state
    undo({
      state: s,
      dispatch: (tr) => {
        s = tr.state
      },
    })
    expect(s.doc.toString()).toBe(l.result)
    expect(s.field(regionsField)[0]).toMatchObject({ resolved: false, yours: false })
  })

  it('writes settled conflicts as text and the rest as markers', () => {
    let s = fresh()
    const states = (): { from: number; to: number; resolved: boolean }[] => s.field(regionsField)
    expect(renderResult(s.doc.toString(), l.regions, states(), l.blocks)).toBe(MERGE)
    s = s.update(sideSpec(s, 0, 'yours', region.yours) ?? {}).state
    expect(renderResult(s.doc.toString(), l.regions, states(), l.blocks)).toBe('a\nmine\nz\n')
  })

  it('keeps the panes level as the result grows', () => {
    let s = fresh()
    expect(gapsFor(s, l)).toEqual([
      [0, 1, 0],
      [0, 1, 0],
      [0, 0, 0],
    ])
    s = s.update(sideSpec(s, 0, 'incoming', region.incoming) ?? {}).state
    s = s.update(sideSpec(s, 0, 'yours', region.yours) ?? {}).state
    expect(gapsFor(s, l)).toEqual([
      [0, 2, 0],
      [0, 0, 0],
      [0, 1, 0],
    ])
  })
})

describe('sideLabels', () => {
  it('names a rebase by meaning: the replayed commit is yours, HEAD is the upstream', () => {
    const labels = sideLabels({
      operation: 'rebase',
      ours: { ref: 'main', sha: 'aaa1111' },
      theirs: { ref: 'feature', sha: 'bbb2222', subject: 'Add x' },
    })
    expect(labels).toEqual({
      yoursIs: 'theirs',
      yours: { kind: 'yourCommit', commit: 'bbb2222 Add x' },
      incoming: { kind: 'upstream', ref: 'main' },
    })
  })

  it('names a merge by branch', () => {
    const labels = sideLabels({ operation: 'merge', ours: { ref: 'main' }, theirs: { ref: 'feature' } })
    expect(labels).toEqual({
      yoursIs: 'ours',
      yours: { kind: 'yoursOn', ref: 'main' },
      incoming: { kind: 'incomingFrom', ref: 'feature' },
    })
  })
})
