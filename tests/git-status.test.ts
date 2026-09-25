import { describe, expect, it } from 'vitest'
import { mapStatusCode, parseNameStatus, renameSources } from '../src/main/git'

/** `-z` output is NUL-terminated, not NUL-separated: git ends the last record too */
const z = (...fields: string[]) => fields.map((f) => f + '\0').join('')

describe('mapStatusCode', () => {
  it('maps the codes the panel draws differently', () => {
    expect(mapStatusCode('A')).toBe('added')
    expect(mapStatusCode('D')).toBe('deleted')
    expect(mapStatusCode('R')).toBe('renamed')
    expect(mapStatusCode('U')).toBe('conflict')
  })

  it('shows a copy as an addition — the source file is untouched', () => {
    expect(mapStatusCode('C')).toBe('added')
  })

  it('treats M as modified', () => {
    expect(mapStatusCode('M')).toBe('modified')
  })

  it('falls back to modified for codes the UI has no shape for', () => {
    // T type change, X unknown, B broken pairing, ? untracked marker, and the empty string
    for (const code of ['T', 'X', 'B', '?', '']) expect(mapStatusCode(code)).toBe('modified')
  })

  it('is case sensitive: a lowercase code is not a status', () => {
    expect(mapStatusCode('a')).toBe('modified')
    expect(mapStatusCode('r')).toBe('modified')
  })

  it('does not match a similarity-scored code as a whole string', () => {
    // git writes R100 as one field; only the first letter is ever passed in, and the
    // full field must not be mistaken for a rename
    expect(mapStatusCode('R100')).toBe('modified')
    expect(mapStatusCode('R100'.slice(0, 1))).toBe('renamed')
  })
})

describe('parseNameStatus', () => {
  it('reads code/path pairs', () => {
    expect(parseNameStatus(z('M', 'src/a.ts', 'A', 'src/b.ts', 'D', 'src/c.ts'))).toEqual([
      { path: 'src/a.ts', status: 'modified', staged: false, untracked: false },
      { path: 'src/b.ts', status: 'added', staged: false, untracked: false },
      { path: 'src/c.ts', status: 'deleted', staged: false, untracked: false },
    ])
  })

  it('reads a rename as a triple: code, old path, new path', () => {
    expect(parseNameStatus(z('R100', 'old/name.ts', 'new/name.ts'))).toEqual([
      { path: 'new/name.ts', oldPath: 'old/name.ts', status: 'renamed', staged: false, untracked: false },
    ])
  })

  it('reads a copy as a triple as well', () => {
    expect(parseNameStatus(z('C75', 'src/a.ts', 'src/b.ts'))).toEqual([
      { path: 'src/b.ts', oldPath: 'src/a.ts', status: 'renamed', staged: false, untracked: false },
    ])
  })

  it('keeps its place when a rename sits between ordinary entries', () => {
    const raw = z('M', 'a.ts', 'R096', 'old.ts', 'new.ts', 'D', 'z.ts')
    expect(parseNameStatus(raw).map((f) => [f.status, f.path, f.oldPath ?? null])).toEqual([
      ['modified', 'a.ts', null],
      ['renamed', 'new.ts', 'old.ts'],
      ['deleted', 'z.ts', null],
    ])
  })

  it('returns nothing for empty output', () => {
    expect(parseNameStatus('')).toEqual([])
    expect(parseNameStatus('\0')).toEqual([])
    expect(parseNameStatus('\0\0\0')).toEqual([])
  })

  it('does not split on newlines — only NUL separates fields', () => {
    // the whole point of -z: a path may legally contain a newline
    const [file] = parseNameStatus(z('M', 'weird\nname.ts'))
    expect(file).toMatchObject({ path: 'weird\nname.ts', status: 'modified' })
  })

  it('keeps paths with spaces unquoted and whole', () => {
    const [file] = parseNameStatus(z('M', 'src/my folder/a file.ts'))
    expect(file?.path).toBe('src/my folder/a file.ts')
  })

  it('keeps unicode paths byte for byte', () => {
    const files = parseNameStatus(z('A', 'док/файл.md', 'M', '日本語/テスト.ts', 'D', 'emoji/🚀.txt'))
    expect(files.map((f) => f.path)).toEqual(['док/файл.md', '日本語/テスト.ts', 'emoji/🚀.txt'])
  })

  it('handles a rename whose paths contain spaces and unicode', () => {
    const [file] = parseNameStatus(z('R100', 'старое имя.ts', 'новое имя.ts'))
    expect(file).toMatchObject({ oldPath: 'старое имя.ts', path: 'новое имя.ts', status: 'renamed' })
  })

  it('reports unmerged entries as conflicts', () => {
    const [file] = parseNameStatus(z('U', 'src/conflict.ts'))
    expect(file).toMatchObject({ path: 'src/conflict.ts', status: 'conflict' })
  })

  it('maps a type change to modified rather than dropping the file', () => {
    const [file] = parseNameStatus(z('T', 'link-to-file.ts'))
    expect(file).toMatchObject({ path: 'link-to-file.ts', status: 'modified' })
  })

  it('never marks a parsed entry as staged or untracked — that is status(), not name-status', () => {
    for (const f of parseNameStatus(z('M', 'a', 'R100', 'b', 'c'))) {
      expect(f.staged).toBe(false)
      expect(f.untracked).toBe(false)
    }
  })

  it('drops a record whose path never arrived', () => {
    // output cut short mid-record used to produce an entry with an undefined path, which then
    // travelled all the way to the panel as a nameless row
    expect(parseNameStatus('M\0')).toEqual([])
  })

  it('stops at a truncated rename instead of naming the file after its own code', () => {
    // a rename is three fields; with the third missing, `newPath` used to come out undefined
    expect(parseNameStatus(z('M', 'a.ts') + 'R100\0old.ts\0')).toEqual([
      { path: 'a.ts', status: 'modified', staged: false, untracked: false },
    ])
  })
})

describe('renameSources', () => {
  const entries = [
    { path: 'new.ts', oldPath: 'old.ts', status: 'renamed' as const, staged: true, untracked: false },
    { path: 'plain.ts', status: 'modified' as const, staged: true, untracked: false },
    { path: 'new2.ts', oldPath: 'old2.ts', status: 'renamed' as const, staged: true, untracked: false },
  ]

  it('returns the old path of a selected rename', () => {
    expect(renameSources(['new.ts'], entries)).toEqual(['old.ts'])
  })

  it('returns nothing when the selection has no renames', () => {
    expect(renameSources(['plain.ts'], entries)).toEqual([])
  })

  it('ignores renames that were not selected', () => {
    expect(renameSources(['new2.ts'], entries)).toEqual(['old2.ts'])
  })

  it('collects several', () => {
    expect(renameSources(['new.ts', 'new2.ts'], entries).sort()).toEqual(['old.ts', 'old2.ts'])
  })

  it('matches on the new path, not the old one', () => {
    // selecting the old path is not how the panel works, and must not resurrect it
    expect(renameSources(['old.ts'], entries)).toEqual([])
  })

  it('deduplicates', () => {
    const dup = [entries[0]!, { ...entries[0]! }]
    expect(renameSources(['new.ts'], dup)).toEqual(['old.ts'])
  })

  it('handles empty inputs', () => {
    expect(renameSources([], entries)).toEqual([])
    expect(renameSources(['new.ts'], [])).toEqual([])
  })

  it('does not treat an empty oldPath as a source', () => {
    const odd = [{ path: 'x.ts', oldPath: '', status: 'renamed' as const, staged: true, untracked: false }]
    expect(renameSources(['x.ts'], odd)).toEqual([])
  })
})
