import { describe, expect, it } from 'vitest'
import { filterTree } from '../src/renderer/src/lib/fileFilter'

const file = (path: string): { name: string; path: string; isDir: boolean } => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  isDir: false,
})
const dir = (path: string): { name: string; path: string; isDir: boolean } => ({ ...file(path), isDir: true })

const root = [dir('/r/src'), dir('/r/docs'), file('/r/README.md')]
const read: Record<string, ReturnType<typeof file>[]> = {
  '/r/src': [dir('/r/src/lib'), file('/r/src/main.ts')],
  '/r/src/lib': [file('/r/src/lib/fileFilter.ts'), file('/r/src/lib/util.ts')],
}
const childrenOf = (d: string): ReturnType<typeof file>[] | undefined => read[d]

describe('filterTree', () => {
  it('is no filter for an empty or blank query', () => {
    expect(filterTree(root, childrenOf, '')).toBeNull()
    expect(filterTree(root, childrenOf, '  ')).toBeNull()
  })

  it('finds a name in an open subfolder and keeps its ancestors', () => {
    expect(filterTree(root, childrenOf, 'FILTER')).toEqual(
      new Set(['/r/src', '/r/src/lib', '/r/src/lib/fileFilter.ts']),
    )
  })

  it('matches top-level names as before', () => {
    expect(filterTree(root, childrenOf, 'readme')).toEqual(new Set(['/r/README.md']))
  })

  it('does not look into folders that are not read', () => {
    expect(filterTree(root, () => undefined, 'util')).toEqual(new Set())
  })

  it('shows a matching folder even with nothing matching inside', () => {
    expect(filterTree(root, childrenOf, 'doc')).toEqual(new Set(['/r/docs']))
  })
})
