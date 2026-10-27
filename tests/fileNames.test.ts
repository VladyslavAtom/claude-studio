import { describe, expect, it } from 'vitest'
import { copyName, ignoreLine, isValidName, withIgnoreLine } from '../src/shared/fileNames'

describe('isValidName', () => {
  it('takes an ordinary name, dotfiles included', () => {
    expect(isValidName('a.ts')).toBe(true)
    expect(isValidName('.env')).toBe(true)
    expect(isValidName('with space')).toBe(true)
  })

  it('refuses what would leave the directory or name it', () => {
    expect(isValidName('')).toBe(false)
    expect(isValidName('.')).toBe(false)
    expect(isValidName('..')).toBe(false)
    expect(isValidName('a/b')).toBe(false)
    expect(isValidName('../x')).toBe(false)
    expect(isValidName('a\0b')).toBe(false)
  })
})

describe('copyName', () => {
  it('keeps the name when it is free', () => {
    expect(copyName('a.ts', false, new Set())).toBe('a.ts')
  })

  it('puts the suffix before the extension and counts up', () => {
    expect(copyName('a.ts', false, new Set(['a.ts']))).toBe('a copy.ts')
    expect(copyName('a.ts', false, new Set(['a.ts', 'a copy.ts']))).toBe('a copy 2.ts')
    expect(copyName('a.ts', false, new Set(['a.ts', 'a copy.ts', 'a copy 2.ts']))).toBe('a copy 3.ts')
  })

  it('puts it at the end of a directory and a dotfile', () => {
    expect(copyName('src.d', true, new Set(['src.d']))).toBe('src.d copy')
    expect(copyName('.env', false, new Set(['.env']))).toBe('.env copy')
    expect(copyName('Makefile', false, new Set(['Makefile']))).toBe('Makefile copy')
  })
})

describe('ignoreLine', () => {
  it('anchors the path and marks a directory', () => {
    expect(ignoreLine('build/out.log', false)).toBe('/build/out.log')
    expect(ignoreLine('dist', true)).toBe('/dist/')
  })

  it('escapes glob characters so the line names exactly one entry', () => {
    expect(ignoreLine('case[2].json', false)).toBe('/case\\[2\\].json')
    expect(ignoreLine('a*b?.txt', false)).toBe('/a\\*b\\?.txt')
  })
})

describe('withIgnoreLine', () => {
  it('creates the file content from nothing', () => {
    expect(withIgnoreLine('', '/dist/')).toBe('/dist/\n')
  })

  it('adds the missing newline before appending', () => {
    expect(withIgnoreLine('node_modules', '/dist/')).toBe('node_modules\n/dist/\n')
    expect(withIgnoreLine('node_modules\n', '/dist/')).toBe('node_modules\n/dist/\n')
  })

  it('does not add a line that is already there in another spelling', () => {
    expect(withIgnoreLine('/dist/\n', '/dist/')).toBeNull()
    expect(withIgnoreLine('dist\n', '/dist/')).toBeNull()
    expect(withIgnoreLine('  /dist  \n', '/dist/')).toBeNull()
  })
})
