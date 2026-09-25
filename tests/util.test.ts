import { describe, expect, it } from 'vitest'
import { basename, join, slugify, splitPath } from '../src/renderer/src/lib/util'

describe('slugify', () => {
  it('transliterates Cyrillic', () => {
    expect(slugify('Привет мир')).toBe('privet-mir')
    expect(slugify('Ёжик')).toBe('ezhik')
    expect(slugify('Щука')).toBe('schuka')
    expect(slugify('Объезд')).toBe('obezd') // ъ and ь map to nothing
    expect(slugify('Юля')).toBe('yulya')
  })

  it('collapses every run of non-slug characters into one dash', () => {
    expect(slugify('a   b')).toBe('a-b')
    expect(slugify('fix: the __thing__ (again)')).toBe('fix-the-thing-again')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugify('  hello  ')).toBe('hello')
    expect(slugify('---x---')).toBe('x')
  })

  it('clamps to 40 characters', () => {
    const out = slugify('a'.repeat(60))
    expect(out).toHaveLength(40)
    expect(out).toBe('a'.repeat(40))
  })

  it('clamps after transliteration, not before', () => {
    // 30 Cyrillic ж become 60 latin characters; the clamp has to see the long form
    expect(slugify('ж'.repeat(30))).toHaveLength(40)
  })

  it('can leave a trailing dash when the clamp lands on one', () => {
    // documents current behaviour: the trim runs before the slice
    expect(slugify(`${'a'.repeat(39)} b`)).toBe(`${'a'.repeat(39)}-`)
  })

  it('falls back to "session" when nothing survives', () => {
    expect(slugify('')).toBe('session')
    expect(slugify('!!!')).toBe('session')
    expect(slugify('привет'.replace(/./g, 'ь'))).toBe('session')
    expect(slugify('日本語')).toBe('session')
  })

  it('keeps digits and lowercases', () => {
    expect(slugify('Fix Bug 42')).toBe('fix-bug-42')
  })
})

describe('join', () => {
  it('joins with a single slash', () => {
    expect(join('a', 'b', 'c')).toBe('a/b/c')
  })

  it('drops empty parts', () => {
    expect(join('a', '', 'b')).toBe('a/b')
    expect(join('', 'b')).toBe('b')
  })

  it('collapses duplicate slashes at the seams', () => {
    expect(join('a/', '/b')).toBe('a/b')
    expect(join('a//', '//b')).toBe('a/b')
  })

  it('keeps a leading absolute slash', () => {
    expect(join('/home/bv', 'projects')).toBe('/home/bv/projects')
  })

  it('collapses a leading double slash too — so it cannot build a UNC-looking path', () => {
    expect(join('//server', 'share')).toBe('/server/share')
  })

  it('returns an empty string for no usable parts', () => {
    expect(join()).toBe('')
    expect(join('', '')).toBe('')
  })
})

describe('splitPath', () => {
  it('splits directory from name, keeping the trailing slash on the directory', () => {
    expect(splitPath('src/lib/jwt.ts')).toEqual(['src/lib/', 'jwt.ts'])
  })

  it('returns an empty directory for a bare name', () => {
    expect(splitPath('README.md')).toEqual(['', 'README.md'])
  })

  it('handles absolute paths', () => {
    expect(splitPath('/a/b')).toEqual(['/a/', 'b'])
  })

  it('handles a trailing slash by returning an empty name', () => {
    expect(splitPath('src/lib/')).toEqual(['src/lib/', ''])
  })

  it('keeps spaces and unicode intact', () => {
    expect(splitPath('doc s/файл имя.md')).toEqual(['doc s/', 'файл имя.md'])
  })
})

describe('basename', () => {
  it('takes the last segment', () => {
    expect(basename('/a/b/c.ts')).toBe('c.ts')
  })

  it('ignores trailing slashes', () => {
    expect(basename('/a/b/')).toBe('b')
    expect(basename('/a/b///')).toBe('b')
  })

  it('returns the input when there is no segment left', () => {
    expect(basename('/')).toBe('/')
    expect(basename('')).toBe('')
  })

  it('handles a bare name', () => {
    expect(basename('c.ts')).toBe('c.ts')
  })
})
