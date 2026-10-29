/**
 * Review comments inside the diff's new side: a gutter to add them from, and each comment drawn
 * as a block under the last line it covers, shown or being edited.
 *
 * The comments themselves live in `state/ReviewProvider`, not in the editor. The view is handed
 * what to show through `setReview` and calls back through `handlers` — a ref, so a widget built
 * before the last render still reaches the current callbacks.
 */
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, type DecorationSet } from '@codemirror/view'
import { clickedRange, type ReviewComment } from '../lib/reviewComments'

export interface ReviewLabels {
  add: string
  commented: string
  placeholder: string
  save: string
  cancel: string
  edit: string
  remove: string
}

export interface ReviewHandlers {
  /** lines are 1-based and inclusive */
  add: (view: EditorView, from: number, to: number) => void
  save: (id: string, text: string) => void
  cancel: (id: string) => void
  startEdit: (id: string) => void
  remove: (id: string) => void
  /** the text typed so far into a comment being edited, kept across a rebuilt widget */
  draft: (id: string) => string | undefined
  setDraft: (id: string, text: string) => void
}

/** what the view shows: this file's comments, which one is open for editing, the words */
export interface ReviewShown {
  comments: readonly ReviewComment[]
  editing: string | null
  labels: ReviewLabels
}

export const setReview = StateEffect.define<ReviewShown>()

function button(label: string, cls: string, run: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = cls
  el.textContent = label
  el.onclick = (e) => {
    e.preventDefault()
    run()
  }
  return el
}

class CommentWidget extends WidgetType {
  constructor(
    readonly comment: ReviewComment,
    readonly editing: boolean,
    readonly labels: ReviewLabels,
    readonly handlers: { current: ReviewHandlers },
  ) {
    super()
  }

  override eq(other: CommentWidget): boolean {
    return other.comment === this.comment && other.editing === this.editing && other.labels === this.labels
  }

  override toDOM(): HTMLElement {
    const h = this.handlers
    const { id, text } = this.comment
    const box = document.createElement('div')
    box.className = 'cs-review' + (this.editing ? ' editing' : '')
    box.dataset.testid = 'review-comment'
    const actions = document.createElement('div')
    actions.className = 'cs-review-actions'

    if (this.editing) {
      const input = document.createElement('textarea')
      input.className = 'cs-review-input'
      input.rows = 3
      input.placeholder = this.labels.placeholder
      input.value = h.current.draft(id) ?? text
      input.oninput = () => h.current.setDraft(id, input.value)
      input.onkeydown = (e) => {
        // the diff closes on an Escape nobody took, and F7 jumps between changes: both stop here
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          h.current.cancel(id)
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          h.current.save(id, input.value)
        }
        e.stopPropagation()
      }
      actions.append(
        button(this.labels.save, 'primary', () => h.current.save(id, input.value)),
        button(this.labels.cancel, 'ghost', () => h.current.cancel(id)),
      )
      box.append(input, actions)
      requestAnimationFrame(() => {
        if (!input.isConnected) return
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      })
      return box
    }

    const body = document.createElement('div')
    body.className = 'cs-review-text'
    body.textContent = text
    body.ondblclick = () => h.current.startEdit(id)
    actions.append(
      button(this.labels.edit, 'ghost', () => h.current.startEdit(id)),
      button(this.labels.remove, 'ghost', () => h.current.remove(id)),
    )
    box.append(body, actions)
    return box
  }

  /** the widget's own textarea and buttons take their events; the editor stays out of them */
  override ignoreEvent(): boolean {
    return true
  }
}

class ReviewMarker extends GutterMarker {
  constructor(
    readonly commented: boolean,
    readonly title: string,
  ) {
    super()
  }
  override eq(other: ReviewMarker): boolean {
    return other.commented === this.commented && other.title === this.title
  }
  override toDOM(): Node {
    const el = document.createElement('span')
    el.className = this.commented ? 'cs-review-mark' : 'cs-review-add'
    el.textContent = this.commented ? '●' : '+'
    el.title = this.title
    return el
  }
}

interface Field {
  shown: ReviewShown | null
  deco: DecorationSet
  add: ReviewMarker
  commented: ReviewMarker
}

/**
 * The comments are pinned to line numbers, not mapped through edits: the working file is
 * replaced whole whenever the disk moves, which no mapping survives. A line past the end of a
 * file that shrank puts the comment under the last line.
 */
function decorate(state: EditorState, shown: ReviewShown, handlers: { current: ReviewHandlers }): DecorationSet {
  const doc = state.doc
  const ranges: Range<Decoration>[] = shown.comments.map((c) => {
    const at = doc.line(Math.max(1, Math.min(c.to, doc.lines))).to
    const widget = new CommentWidget(c, shown.editing === c.id, shown.labels, handlers)
    return Decoration.widget({ widget, block: true, side: 1 }).range(at)
  })
  return Decoration.set(ranges, true)
}

export function reviewExtension(handlers: { current: ReviewHandlers }): Extension {
  const field = StateField.define<Field>({
    create: () => ({
      shown: null,
      deco: Decoration.none,
      add: new ReviewMarker(false, ''),
      commented: new ReviewMarker(true, ''),
    }),
    update(value, tr) {
      for (const e of tr.effects)
        if (e.is(setReview))
          return {
            shown: e.value,
            deco: decorate(tr.state, e.value, handlers),
            add: new ReviewMarker(false, e.value.labels.add),
            commented: new ReviewMarker(true, e.value.labels.commented),
          }
      if (tr.docChanged && value.shown) return { ...value, deco: decorate(tr.state, value.shown, handlers) }
      return value
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })

  const marks = gutter({
    class: 'cs-review-gutter',
    lineMarker(view, block) {
      const v = view.state.field(field)
      const n = view.state.doc.lineAt(block.from).number
      return v.shown?.comments.some((c) => n >= c.from && n <= c.to) ? v.commented : v.add
    },
    lineMarkerChange: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(setReview))),
    initialSpacer: (view) => view.state.field(field).add,
    domEventHandlers: {
      mousedown(view, block, event) {
        if (!(event instanceof MouseEvent) || event.button !== 0) return false
        const { from, to } = clickedRange(view.state, view.state.doc.lineAt(block.from).number)
        handlers.current.add(view, from, to)
        return true
      },
    },
  })

  return [field, marks]
}
