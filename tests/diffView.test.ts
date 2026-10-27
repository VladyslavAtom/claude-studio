import { describe, expect, it } from 'vitest'
import { bandPath, changeKind, chunkAt, CTRL_PROXIMITY_X } from '../src/renderer/src/lib/diffBands'
import { GATE_BYTES, GATE_LINES, MAX_BYTES, gateVerdict, isGeneratedPath } from '../src/renderer/src/lib/diffGate'
import { diffBase, parseNumstat } from '../src/main/git'

/** the numbers of an SVG path, in order */
const nums = (d: string): number[] => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

describe('changeKind', () => {
  it('names a change by which side is empty', () => {
    expect(changeKind(5, 5, 5, 20)).toBe('inserted')
    expect(changeKind(5, 20, 5, 5)).toBe('deleted')
    expect(changeKind(5, 20, 5, 9)).toBe('modified')
  })
})

describe('bandPath', () => {
  it('draws the top edge forward and the bottom edge back, with control points at 0.3 / 0.7', () => {
    // left lines 100..140, right lines 100..180: the shape IntelliJ fills for a modified block
    const d = bandPath(30, { top: 100, bottom: 140 }, { top: 100, bottom: 180 })
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    // M x1 s1 C c1 s1 c2 s2 x2 s2 L x2 e2+1 C c2 e2+1 c1 e1+1 x1 e1+1
    expect(nums(d)).toEqual([0, 100, 9, 100, 21, 100, 30, 100, 30, 180, 21, 180, 9, 140, 0, 140])
    expect(30 * CTRL_PROXIMITY_X).toBe(9)
  })

  it('narrows an empty side to a two-pixel line at the boundary, as DividerPolygon.paint does', () => {
    // deleted on the left: nothing on the right, the band meets the gap between two lines
    const d = bandPath(36, { top: 40, bottom: 80 }, { top: 60, bottom: 60 })
    const [, s1, , , , , , s2, , e2, , , , , , e1] = nums(d)
    expect([s1, e1]).toEqual([40, 80])
    // start - 1 .. start, then +1 on the bottom edge
    expect([s2, e2]).toEqual([59, 61])
  })

  it('keeps one-pixel precision and no NaN', () => {
    const d = bandPath(33, { top: 10.26, bottom: 30.04 }, { top: 0, bottom: 0 })
    expect(d).not.toContain('NaN')
    expect(nums(d).every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9)).toBe(true)
  })
})

describe('chunkAt', () => {
  const chunks = [
    { from: 10, to: 20 },
    { from: 40, to: 40 },
    { from: 50, to: 70 },
  ]
  it('finds the chunk a position falls in, ends included', () => {
    expect(chunkAt(chunks, 10)).toBe(0)
    expect(chunkAt(chunks, 20)).toBe(0)
    expect(chunkAt(chunks, 40)).toBe(1)
    expect(chunkAt(chunks, 69)).toBe(2)
  })
  it('is -1 between chunks', () => {
    expect(chunkAt(chunks, 0)).toBe(-1)
    expect(chunkAt(chunks, 30)).toBe(-1)
    expect(chunkAt([], 5)).toBe(-1)
  })
})

describe('gate', () => {
  const stat = { added: 10, removed: 5, binary: false, bytes: 2000 }

  it('shows an ordinary diff', () => {
    expect(gateVerdict(stat, 'src/app.ts')).toBe('show')
  })
  it('refuses binary before anything else', () => {
    expect(gateVerdict({ ...stat, binary: true, bytes: MAX_BYTES * 2 }, 'a.png')).toBe('binary')
  })
  it('refuses what the app cannot read at all', () => {
    expect(gateVerdict({ ...stat, bytes: MAX_BYTES + 1 }, 'src/app.ts')).toBe('too-large')
  })
  it('holds lockfiles and generated files behind a click, however small', () => {
    expect(gateVerdict(stat, 'package-lock.json')).toBe('generated')
    expect(gateVerdict(stat, 'web/yarn.lock')).toBe('generated')
    expect(gateVerdict(stat, 'dist/app.min.js')).toBe('generated')
  })
  it('holds a diff past the line or the byte budget', () => {
    expect(gateVerdict({ ...stat, added: GATE_LINES, removed: 1 }, 'a.ts')).toBe('large')
    expect(gateVerdict({ ...stat, added: GATE_LINES, removed: 0 }, 'a.ts')).toBe('show')
    expect(gateVerdict({ ...stat, bytes: GATE_BYTES + 1 }, 'a.ts')).toBe('large')
  })
  it('matches generated names by the file name only', () => {
    expect(isGeneratedPath('Cargo.lock')).toBe(true)
    expect(isGeneratedPath('proto/x.pb.go')).toBe(true)
    expect(isGeneratedPath('api/x_pb2.py')).toBe(true)
    expect(isGeneratedPath('src/lock.ts')).toBe(false)
    expect(isGeneratedPath('package-lock.json.d/readme.md')).toBe(false)
    expect(isGeneratedPath('src/minimal.js')).toBe(false)
  })
})

describe('parseNumstat', () => {
  const z = (...fields: string[]): string => fields.map((f) => f + '\0').join('')

  it('reads a plain record', () => {
    expect(parseNumstat(z('3\t1\tsrc/a.ts'))).toEqual({ added: 3, removed: 1, binary: false })
  })
  it('skips the two path fields of a rename', () => {
    expect(parseNumstat(z('2\t2\t', 'old.ts', 'new.ts'))).toEqual({ added: 2, removed: 2, binary: false })
  })
  it('sums a rename git did not pair up', () => {
    expect(parseNumstat(z('0\t40\told.ts', '41\t0\tnew.ts'))).toEqual({ added: 41, removed: 40, binary: false })
  })
  it('marks binary', () => {
    expect(parseNumstat(z('-\t-\timg.png'))).toEqual({ added: 0, removed: 0, binary: true })
  })
  it('is empty on no output', () => {
    expect(parseNumstat('')).toEqual({ added: 0, removed: 0, binary: false })
  })
})

describe('diffBase', () => {
  it('takes the session base only in base mode', () => {
    expect(diffBase('base', 'main')).toBe('main')
    expect(diffBase('working', 'main')).toBeNull()
    expect(diffBase('base', undefined)).toBeNull()
    expect(diffBase('base', '')).toBeNull()
  })
})
