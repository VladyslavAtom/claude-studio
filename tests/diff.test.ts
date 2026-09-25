import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../src/renderer/src/lib/diff'

const SIMPLE = [
  'diff --git a/f.txt b/f.txt',
  'index e69de29..4b825dc 100644',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,3 +1,4 @@',
  ' line1',
  '-line2',
  '+line2 changed',
  '+line3',
  ' line4',
].join('\n')

describe('parseUnifiedDiff — headers', () => {
  it('drops git headers and keeps only the hunk and its body', () => {
    const { lines } = parseUnifiedDiff(SIMPLE)
    expect(lines.map((l) => l.type)).toEqual(['hunk', 'context', 'del', 'add', 'add', 'context'])
  })

  it('drops rename and mode headers', () => {
    const raw = [
      'diff --git a/old.txt b/new.txt',
      'similarity index 92%',
      'rename from old.txt',
      'rename to new.txt',
      'new file mode 100644',
      'deleted file mode 100644',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n')
    expect(parseUnifiedDiff(raw).lines.map((l) => l.type)).toEqual(['hunk', 'del', 'add'])
  })

  it('returns nothing for empty input', () => {
    const { lines, stats } = parseUnifiedDiff('')
    expect(lines).toEqual([])
    expect(stats).toEqual({ additions: 0, deletions: 0, binary: false })
  })

  it('keeps a trailing empty line as context — a diff string should not end with a newline', () => {
    const { lines } = parseUnifiedDiff('@@ -1 +1 @@\n a\n')
    expect(lines.map((l) => l.type)).toEqual(['hunk', 'context', 'context'])
    expect(lines[2]).toMatchObject({ text: '', oldNo: 2, newNo: 2 })
  })
})

describe('parseUnifiedDiff — line numbering', () => {
  it('numbers from the hunk header', () => {
    const { lines } = parseUnifiedDiff(SIMPLE)
    expect(lines.slice(1).map((l) => [l.type, l.oldNo, l.newNo])).toEqual([
      ['context', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['add', null, 3],
      ['context', 3, 4],
    ])
  })

  it('gives the hunk line itself no numbers', () => {
    expect(parseUnifiedDiff(SIMPLE).lines[0]).toMatchObject({ type: 'hunk', oldNo: null, newNo: null })
  })

  it('restarts numbering at each hunk header', () => {
    const raw = ['@@ -1,1 +1,1 @@', ' a', '@@ -40,2 +50,2 @@', ' b', ' c'].join('\n')
    const nums = parseUnifiedDiff(raw)
      .lines.filter((l) => l.type === 'context')
      .map((l) => [l.oldNo, l.newNo])
    expect(nums).toEqual([
      [1, 1],
      [40, 50],
      [41, 51],
    ])
  })

  it('reads a hunk header without line counts', () => {
    const { lines } = parseUnifiedDiff('@@ -7 +9 @@\n a')
    expect(lines[1]).toMatchObject({ oldNo: 7, newNo: 9 })
  })

  it('reads a hunk header with a trailing function context', () => {
    const { lines } = parseUnifiedDiff('@@ -12,3 +14,3 @@ export function parse() {')
    expect(lines[0].type).toBe('hunk')
    expect(parseUnifiedDiff('@@ -12,3 +14,3 @@ func()\n x').lines[1]).toMatchObject({ oldNo: 12, newNo: 14 })
  })

  it('leaves the counters alone on an unparsable hunk header', () => {
    const { lines } = parseUnifiedDiff('@@ garbage @@\n a')
    expect(lines[0].type).toBe('hunk')
    expect(lines[1]).toMatchObject({ oldNo: 0, newNo: 0 })
  })
})

describe('parseUnifiedDiff — content', () => {
  it('strips the leading marker from added and deleted lines', () => {
    const { lines } = parseUnifiedDiff('@@ -1 +1 @@\n-old\n+new')
    expect(lines[1]).toMatchObject({ type: 'del', text: 'old' })
    expect(lines[2]).toMatchObject({ type: 'add', text: 'new' })
  })

  it('strips exactly one leading space from a context line', () => {
    const { lines } = parseUnifiedDiff('@@ -1 +1 @@\n   indented')
    expect(lines[1].text).toBe('  indented')
  })

  it('keeps content that itself starts with a marker', () => {
    const { lines } = parseUnifiedDiff('@@ -1 +1 @@\n++added\n--removed')
    expect(lines[1]).toMatchObject({ type: 'add', text: '+added' })
    expect(lines[2]).toMatchObject({ type: 'del', text: '-removed' })
  })

  it('keeps unicode and spaces intact', () => {
    const { lines } = parseUnifiedDiff('@@ -1 +1 @@\n+  привет  мир  ')
    expect(lines[1].text).toBe('  привет  мир  ')
  })
})

describe('parseUnifiedDiff — special markers', () => {
  it('marks "\\ No newline at end of file" as meta and does not count it', () => {
    const { lines, stats } = parseUnifiedDiff('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b')
    expect(lines.map((l) => l.type)).toEqual(['hunk', 'del', 'meta', 'add'])
    expect(stats).toMatchObject({ additions: 1, deletions: 1 })
  })

  it('flags a binary file from the "Binary files" line', () => {
    const raw = 'diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ'
    const { lines, stats } = parseUnifiedDiff(raw)
    expect(stats.binary).toBe(true)
    expect(lines).toEqual([{ type: 'meta', text: 'Binary files a/x.png and b/x.png differ', oldNo: null, newNo: null }])
  })

  it('flags a binary patch', () => {
    const { stats } = parseUnifiedDiff('diff --git a/x.bin b/x.bin\nGIT binary patch\nliteral 4')
    expect(stats.binary).toBe(true)
  })
})

describe('parseUnifiedDiff — stats', () => {
  it('counts additions and deletions', () => {
    expect(parseUnifiedDiff(SIMPLE).stats).toEqual({ additions: 2, deletions: 1, binary: false })
  })

  it('counts across several hunks', () => {
    const raw = ['@@ -1 +1 @@', '-a', '+b', '@@ -9 +9 @@', '-c', '+d', '+e'].join('\n')
    expect(parseUnifiedDiff(raw).stats).toEqual({ additions: 3, deletions: 2, binary: false })
  })
})
