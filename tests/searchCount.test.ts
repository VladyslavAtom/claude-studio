import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { SearchQuery, search, setSearchQuery } from '@codemirror/search'
import { searchCount } from '../src/renderer/src/lib/searchCount'

const withQuery = (doc: string, text: string, selection = EditorSelection.cursor(0)): EditorState =>
  EditorState.create({ doc, selection, extensions: [search()] }).update({
    effects: setSearchQuery.of(new SearchQuery({ search: text })),
  }).state

describe('searchCount', () => {
  it('is null with no query', () => {
    expect(searchCount(withQuery('abc', ''))).toBeNull()
  })

  it('counts the matches and says which one is selected', () => {
    expect(searchCount(withQuery('ab ab ab', 'ab'))).toBe('?/3')
    expect(searchCount(withQuery('ab ab ab', 'ab', EditorSelection.range(3, 5)))).toBe('2/3')
    expect(searchCount(withQuery('ab ab ab', 'zz'))).toBe('?/0')
  })

  it('stops at the cap', () => {
    expect(searchCount(withQuery('x'.repeat(1500), 'x'))).toBe('?/1000+')
  })
})
