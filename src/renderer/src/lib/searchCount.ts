import type { EditorState } from '@codemirror/state'
import { getSearchQuery } from '@codemirror/search'

/** past this many matches the counter stops counting: a 2 MB file of `e` is not worth a scan */
const COUNT_CAP = 1000

/**
 * What the editor's search panel counter says: `3/12` on the third of twelve matches, `?/12`
 * when the selection is on none of them, `1000+` past the cap. Digits only, so it needs no
 * translation. Null with no valid query (an empty field, a broken regexp).
 */
export function searchCount(state: EditorState): string | null {
  const query = getSearchQuery(state)
  if (!query.valid) return null
  const { from, to } = state.selection.main
  let index = 0
  let total = 0
  const cursor = query.getCursor(state)
  for (let m = cursor.next(); !m.done; m = cursor.next()) {
    total++
    if (m.value.from === from && m.value.to === to) index = total
    if (total >= COUNT_CAP) return `${index || '?'}/${COUNT_CAP}+`
  }
  return `${index || '?'}/${total}`
}
