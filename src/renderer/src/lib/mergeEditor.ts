/**
 * The view half of the three-way merge tab: the arrows on the side panes, and the spacers that keep the three panes level. The layout
 * itself is computed in `merge3.ts`, the conflicts' state in `mergeState.ts`.
 */
import { RangeSet, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, type DecorationSet } from '@codemirror/view'
import type { Layout } from './merge3'
import { gapsFor, regionsExtension, regionsField, resultHeights, sideSpec, type LiveRegion } from './mergeState'

export function applySide(view: EditorView, index: number, side: 'yours' | 'incoming', text: string): void {
  const spec = sideSpec(view.state, index, side, text)
  if (spec) view.dispatch(spec)
}

/** a gap of `lines` editor lines; `em` keeps it in step with the font the editor uses */
class Spacer extends WidgetType {
  constructor(
    readonly lines: number,
    readonly cls: string,
  ) {
    super()
  }
  eq(other: Spacer): boolean {
    return other.lines === this.lines && other.cls === this.cls
  }
  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = `cs-merge-spacer ${this.cls}`
    // 1.5 is the editor's line height (`lib/editor.ts`), the em is the content's font size
    el.style.height = `${this.lines * 1.5}em`
    return el
  }
  get estimatedHeight(): number {
    return -1
  }
}

/** the 1-based line each block starts on in a pane, from its heights */
const startsOf = (heights: readonly number[]): number[] => {
  const starts: number[] = []
  let line = 1
  for (const h of heights) {
    starts.push(line)
    line += h
  }
  return starts
}

/**
 * One pane's decorations: the lines of each conflict coloured by its state, and under each
 * block the spacer that brings it level with the tallest pane.
 */
function paneDecorations(
  state: EditorState,
  heights: readonly number[],
  gaps: readonly number[],
  regionBlocks: readonly number[],
  classes: readonly string[],
): DecorationSet {
  const doc = state.doc
  const starts = startsOf(heights)
  const out: Range<Decoration>[] = []
  const lineStart = (n: number): number => doc.line(Math.min(Math.max(n, 1), doc.lines)).from
  starts.forEach((start, b) => {
    const region = regionBlocks.indexOf(b)
    const cls = region >= 0 ? (classes[region] ?? '') : ''
    const h = heights[b] ?? 0
    if (cls) {
      for (let n = start; n < start + h && n <= doc.lines; n++)
        out.push(Decoration.line({ class: cls }).range(doc.line(n).from))
    }
    const gap = gaps[b] ?? 0
    const last = b === starts.length - 1
    // an empty side of a conflict still gets a (zero-height) bar, drawn as a line by CSS
    if (last || (gap <= 0 && !(cls && h === 0))) return
    const next = start + h
    const widgetClass = cls && h === 0 ? `${cls} cs-merge-empty` : cls
    const widget = Decoration.widget({ widget: new Spacer(Math.max(gap, 0), widgetClass), block: true, side: -1 })
    out.push(next > doc.lines ? widget.range(doc.length) : widget.range(lineStart(next)))
  })
  return Decoration.set(out, true)
}

/** the block a conflict is, per conflict: what the panes index the layout by */
const regionBlocksOf = (layout: Layout): number[] => layout.regions.map((r) => r.block)

const resultClass = (r: LiveRegion): string => (r.resolved ? 'cs-merge-resolved' : 'cs-merge-conflict')

/** the result pane: conflict state, colours, spacers */
export function resultExtensions(layout: Layout): Extension {
  const regionBlocks = regionBlocksOf(layout)
  return [
    regionsExtension(layout),
    EditorView.decorations.compute(['doc', regionsField], (state) =>
      paneDecorations(
        state,
        resultHeights(state, layout),
        gapsFor(state, layout)[1] ?? [],
        regionBlocks,
        state.field(regionsField).map(resultClass),
      ),
    ),
  ]
}

/** what a side pane is told after every change of the result */
export interface SideInfo {
  gaps: number[]
  /** per conflict */
  resolved: boolean[]
  applied: boolean[]
}

export const setSideInfo = StateEffect.define<SideInfo>()

const sideField = StateField.define<SideInfo>({
  create: () => ({ gaps: [], resolved: [], applied: [] }),
  update: (info, tr) => tr.effects.reduce((v, e) => (e.is(setSideInfo) ? e.value : v), info),
})

class Arrow extends GutterMarker {
  constructor(
    readonly glyph: string,
    readonly label: string,
  ) {
    super()
  }
  eq(other: Arrow): boolean {
    return other.glyph === this.glyph && other.label === this.label
  }
  toDOM(): Node {
    const el = document.createElement('span')
    el.className = 'cs-merge-arrow'
    el.textContent = this.glyph
    el.title = this.label
    return el
  }
}

/**
 * A side pane, read-only: its conflicts coloured, an arrow on the first line of each conflict
 * whose side has not been taken yet. `onArrow` gets the conflict's index.
 */
export function sideExtensions(
  layout: Layout,
  pane: 'left' | 'right',
  label: string,
  onArrow: (index: number) => void,
): Extension {
  const heights = pane === 'left' ? layout.leftHeights : layout.rightHeights
  const regionBlocks = regionBlocksOf(layout)
  const starts = startsOf(heights)
  const arrow = new Arrow(pane === 'left' ? '»' : '«', label)
  /** the conflict whose arrow sits on a line, by the line's start */
  const arrowAt = (state: EditorState, pos: number): number => {
    const line = state.doc.lineAt(pos).number
    const applied = state.field(sideField).applied
    return regionBlocks.findIndex((b, i) => {
      const start = starts[b] ?? 0
      return !applied[i] && Math.min(start, state.doc.lines) === line
    })
  }
  return [
    sideField,
    EditorView.decorations.compute(['doc', sideField], (state) => {
      const info = state.field(sideField)
      const classes = regionBlocks.map((_, i) =>
        info.applied[i] ? 'cs-merge-applied' : info.resolved[i] ? 'cs-merge-resolved' : 'cs-merge-conflict',
      )
      return paneDecorations(state, heights, info.gaps, regionBlocks, classes)
    }),
    gutter({
      class: 'cs-merge-arrows',
      markers: (view) => {
        const info = view.state.field(sideField)
        const doc = view.state.doc
        const marks = regionBlocks
          .map((b, i) => ({ i, line: Math.min(starts[b] ?? 1, doc.lines) }))
          .filter(({ i }) => !info.applied[i])
          .map(({ line }) => arrow.range(doc.line(line).from))
        return RangeSet.of(marks, true)
      },
      initialSpacer: () => arrow,
      domEventHandlers: {
        mousedown(view, line, event) {
          const index = arrowAt(view.state, line.from)
          if (index < 0 || !(event.target instanceof HTMLElement) || !event.target.closest('.cs-merge-arrow'))
            return false
          event.preventDefault()
          onArrow(index)
          return true
        },
      },
    }),
  ]
}

/**
 * The merge colours. Like `diffTheme`, the rules only name custom properties from
 * `styles/tokens.css`, so a theme switch recolours them without touching the views.
 */
export const mergeTheme: Extension = EditorView.theme({
  '& .cm-line.cs-merge-conflict, & .cs-merge-spacer.cs-merge-conflict': {
    backgroundColor: 'var(--merge-conflict)',
  },
  '& .cm-line.cs-merge-resolved, & .cs-merge-spacer.cs-merge-resolved': {
    backgroundColor: 'var(--diff-inserted)',
  },
  '& .cm-line.cs-merge-applied, & .cs-merge-spacer.cs-merge-applied': {
    backgroundColor: 'var(--bg-1)',
  },
  // an empty side: a bar where its lines would be
  '& .cs-merge-spacer': { boxSizing: 'border-box' },
  '& .cs-merge-spacer.cs-merge-empty': { borderTop: '2px solid var(--fg-dim)' },
  '& .cs-merge-arrows .cm-gutterElement': { padding: '0 4px', cursor: 'default' },
  '& .cs-merge-arrow': {
    cursor: 'pointer',
    color: 'var(--accent)',
    fontWeight: 'bold',
    userSelect: 'none',
  },
  '& .cs-merge-arrow:hover': { color: 'var(--fg)' },
})
