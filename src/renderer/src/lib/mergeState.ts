/**
 * The state of each conflict in the live result of the merge tab: where it is, and whether it
 * is settled. Editor state only — no view, no DOM — so it runs under the tests. The view side
 * (arrows, colours, spacers) is `mergeEditor.ts`.
 */
import { StateEffect, StateField, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state'
import { invertedEffects } from '@codemirror/commands'
import { spacers, type Layout } from './merge3'

/** a conflict in the live result */
export interface LiveRegion {
  from: number
  to: number
  /** the arrow of that side was used */
  yours: boolean
  incoming: boolean
  /** typed into by hand: that settles it too */
  edited: boolean
  resolved: boolean
  /** its text after the last transaction, to tell an edit inside it from one next to it */
  text: string
}

const settled = (r: Pick<LiveRegion, 'yours' | 'incoming' | 'edited'>): boolean => r.yours || r.incoming || r.edited

/** sets one conflict's whole state; mapped, so the undo history can carry it */
const setRegion = StateEffect.define<{ index: number; region: LiveRegion }>({
  map: (v, m) => ({
    index: v.index,
    region: { ...v.region, from: m.mapPos(v.region.from, -1), to: m.mapPos(v.region.to, -1) },
  }),
})

/**
 * Both ends map with `assoc -1`: text typed at the start of a conflict's first line lands inside
 * it, text typed at the start of the line after it does not. An empty conflict therefore only
 * fills through its arrows, which is the one unambiguous way to say what goes there.
 */
export const regionsField = StateField.define<LiveRegion[]>({
  create: () => [],
  update(regions, tr) {
    let next = regions
    if (tr.docChanged) {
      next = regions.map((r) => {
        const from = tr.changes.mapPos(r.from, -1)
        const to = Math.max(from, tr.changes.mapPos(r.to, -1))
        const text = tr.newDoc.sliceString(from, to)
        const edited = r.edited || text !== r.text
        return { ...r, from, to, text, edited, resolved: settled({ ...r, edited }) }
      })
    }
    for (const e of tr.effects) {
      if (!e.is(setRegion) || e.value.index >= next.length) continue
      if (next === regions) next = [...regions]
      const { from, to } = e.value.region
      next[e.value.index] = { ...e.value.region, text: tr.newDoc.sliceString(from, to) }
    }
    return next
  },
})

/**
 * Ctrl+Z after an arrow or a hand edit puts the conflict's state back with the text: without it
 * the text returned but the conflict stayed «resolved», and Done wrote the base chunk out.
 */
const undoableRegions = invertedEffects.of((tr) => {
  const before = tr.startState.field(regionsField, false)
  const after = tr.state.field(regionsField, false)
  if (!before || !after || before === after) return []
  const out: StateEffect<unknown>[] = []
  before.forEach((r, index) => {
    const a = after[index]
    if (a && (a.yours !== r.yours || a.incoming !== r.incoming || a.edited !== r.edited))
      out.push(setRegion.of({ index, region: r }))
  })
  return out
})

/** the conflicts of a fresh result, all unresolved, plus their undo support */
export function regionsExtension(layout: Layout): Extension {
  return [
    regionsField.init(() =>
      layout.regions.map((r) => ({
        from: r.from,
        to: r.to,
        yours: false,
        incoming: false,
        edited: false,
        resolved: false,
        text: r.seed,
      })),
    ),
    undoableRegions,
  ]
}

/**
 * An arrow: the first one replaces the base chunk with that side, the second one appends its
 * side after the first — taking both in the order they were clicked, as PyCharm does.
 */
export function sideSpec(
  state: EditorState,
  index: number,
  side: 'yours' | 'incoming',
  text: string,
): TransactionSpec | null {
  const r = state.field(regionsField)[index]
  if (!r || r[side]) return null
  const fresh = !r.resolved
  const changes = fresh ? { from: r.from, to: r.to, insert: text } : { from: r.to, insert: text }
  const to = fresh ? r.from + text.length : r.to + text.length
  const region: LiveRegion = { ...r, [side]: true, to, resolved: true }
  return { changes, effects: setRegion.of({ index, region }), userEvent: 'input.merge' }
}

/** each block's height in lines in the live result */
export function resultHeights(state: EditorState, layout: Layout): number[] {
  const doc = state.doc
  const regions = state.field(regionsField)
  const starts: number[] = []
  let conflict = 0
  let after = 1
  for (const b of layout.blocks) {
    if (b.kind === 'conflict') {
      const r = regions[conflict++]
      const start = r ? doc.lineAt(Math.min(r.from, doc.length)).number : after
      starts.push(start)
      after = r ? doc.lineAt(Math.min(r.to, doc.length)).number : start
    } else starts.push(after)
  }
  return starts.map((s, i) => Math.max(0, (starts[i + 1] ?? doc.lines + 1) - s))
}

/** the three panes' spacers in lines, `[left, result, right]`, for the result as it stands */
export function gapsFor(state: EditorState, layout: Layout): number[][] {
  return spacers([layout.leftHeights, resultHeights(state, layout), layout.rightHeights])
}
