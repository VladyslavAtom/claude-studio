import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  ChangeSet,
  Compartment,
  EditorState,
  RangeSet,
  StateField,
  Transaction,
  type Extension,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutterLineClass,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import {
  MergeView,
  getChunks,
  getOriginalDoc,
  goToNextChunk,
  goToPreviousChunk,
  originalDocChangeEffect,
  unifiedMergeView,
  type Chunk,
} from '@codemirror/merge'
import type { EditorConfig, FileDiffStat, TerminalTab } from '../../../shared/types'
import { useT } from '../i18n'
import { resultMessage } from '../ui/useGitAction'
import { EDITOR_THEMES, diffTheme, languageFor, themeSlot } from '../lib/editor'
import { bandPath, changeKind, chunkAt, type ChangeKind, type Span } from '../lib/diffBands'
import { gateVerdict } from '../lib/diffGate'
import { join } from '../lib/util'
import { useThemed } from '../theme/themeContext'
import { editedByUser, fromDisk, useCheckedFile } from '../hooks/useCheckedFile'

type DiffSpec = NonNullable<TerminalTab['diff']>

interface Props {
  spec: DiffSpec
  editor: EditorConfig
  /**
   * The tab is the visible one. A hidden diff with unsaved edits stays mounted (see
   * TerminalArea): unmounting it would throw the buffer away. It does not poll while hidden.
   */
  active: boolean
  onClose: () => void
  onError: (msg: string) => void
  /** the right side has edits not yet on disk: the tab must not be unmounted meanwhile */
  onDirty: (dirty: boolean) => void
}

/** what one read of both sides produced */
interface Loaded {
  left: string
  right: string
  /** the right side is a text file that exists: it can be edited, and `»` can write into it */
  editable: boolean
  ref: string
}

/** the documents a view is built from; a new object means a new view */
interface Docs extends Loaded {
  seq: number
}

const POLL_MS = 5000

// ---------------------------------------------------------------------------------------------
// Change colours inside the editors

class KindGutter extends GutterMarker {
  constructor(readonly elementClass: string) {
    super()
  }
}

const LINE: Record<ChangeKind, Decoration> = {
  modified: Decoration.line({ class: 'cs-diff-modified' }),
  inserted: Decoration.line({ class: 'cs-diff-inserted' }),
  deleted: Decoration.line({ class: 'cs-diff-deleted' }),
}
const GUTTER: Record<ChangeKind, GutterMarker> = {
  modified: new KindGutter('cs-diff-modified'),
  inserted: new KindGutter('cs-diff-inserted'),
  deleted: new KindGutter('cs-diff-deleted'),
}
const WORD: Record<ChangeKind, Decoration> = {
  modified: Decoration.mark({ class: 'cs-diff-word-modified' }),
  inserted: Decoration.mark({ class: 'cs-diff-word-inserted' }),
  deleted: Decoration.mark({ class: 'cs-diff-word-deleted' }),
}

interface Marks {
  chunks: readonly Chunk[] | null
  deco: DecorationSet
  gutter: RangeSet<GutterMarker>
}

/**
 * Lines coloured by the kind of their change, IntelliJ's way: a modified block is the muted blue
 * and its differing words the full one, an inserted block green, a deleted one grey; the line
 * number beside it takes the line's colour. `@codemirror/merge` only knows "changed", so the
 * kinds are worked out here from its chunks.
 */
function buildMarks(state: EditorState): Marks {
  const info = getChunks(state)
  if (!info) return { chunks: null, deco: Decoration.none, gutter: RangeSet.empty }
  const isA = info.side === 'a'
  const doc = state.doc
  const deco: Range<Decoration>[] = []
  const gutter: Range<GutterMarker>[] = []
  for (const c of info.chunks) {
    const from = isA ? c.fromA : c.fromB
    const to = isA ? c.toA : c.toB
    if (from === to || from > doc.length) continue
    const kind = changeKind(c.fromA, c.toA, c.fromB, c.toB)
    const last = doc.lineAt(Math.min(isA ? c.endA : c.endB, doc.length)).number
    for (let l = doc.lineAt(from).number; l <= last; l++) {
      const at = doc.line(l).from
      deco.push(LINE[kind].range(at))
      gutter.push(GUTTER[kind].range(at))
    }
    if (kind !== 'modified') continue
    for (const ch of c.changes) {
      const f = from + (isA ? ch.fromA : ch.fromB)
      const t = Math.min(doc.length, from + (isA ? ch.toA : ch.toB))
      if (f < t) deco.push(WORD[changeKind(ch.fromA, ch.toA, ch.fromB, ch.toB)].range(f, t))
    }
  }
  return { chunks: info.chunks, deco: Decoration.set(deco, true), gutter: RangeSet.of(gutter, true) }
}

const diffMarks = StateField.define<Marks>({
  create: buildMarks,
  update(marks, tr) {
    const chunks = getChunks(tr.state)?.chunks ?? null
    if (chunks !== marks.chunks) return buildMarks(tr.state)
    // the merge view applies an edit first and hands over the new chunks in a second
    // transaction: until then the old marks are only moved along with the text
    if (!tr.docChanged) return marks
    return { chunks, deco: marks.deco.map(tr.changes), gutter: marks.gutter.map(tr.changes) }
  },
  provide: (f) => [EditorView.decorations.from(f, (m) => m.deco), gutterLineClass.from(f, (m) => m.gutter)],
})

// ---------------------------------------------------------------------------------------------
// The divider: curved bands between the two sides, IntelliJ's

const SVG_NS = 'http://www.w3.org/2000/svg'

/** one side of a chunk in pixels from the top of the divider; see `Span` */
function sideSpan(view: EditorView, from: number, to: number, end: number, offset: number): Span {
  if (from === to) {
    // nothing on this side: the band narrows to the boundary the change would sit at
    const y = offset + (from > 0 ? view.lineBlockAt(from - 1).bottom : 0)
    return { top: y, bottom: y }
  }
  return { top: offset + view.lineBlockAt(from).top, bottom: offset + view.lineBlockAt(end).bottom }
}

interface Bands {
  schedule: () => void
  destroy: () => void
}

/**
 * Draws the bands into an SVG laid over the gap the merge view leaves for its revert buttons.
 * The SVG lives inside the scrolled content, next to both editors, so it moves with them and
 * scrolling costs nothing; it is redrawn only when an editor updates (an edit, a resize, a
 * viewport that moved), coalesced to one draw per frame.
 */
function attachBands(merge: MergeView): Bands {
  const editors = merge.dom.querySelector<HTMLElement>('.cm-mergeViewEditors')
  const gap = merge.dom.querySelector<HTMLElement>('.cm-merge-revert')
  if (!editors || !gap) return { schedule: () => undefined, destroy: () => undefined }
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'diff-bands')
  svg.setAttribute('aria-hidden', 'true')
  editors.appendChild(svg)

  const draw = (): void => {
    const { a, b, chunks } = merge
    const top = editors.getBoundingClientRect().top
    const offA = a.documentTop - top
    const offB = b.documentTop - top
    const width = gap.offsetWidth
    svg.style.left = `${gap.offsetLeft}px`
    svg.setAttribute('width', String(width))
    const vpA = a.viewport
    const vpB = b.viewport
    const paths: SVGPathElement[] = []
    for (const c of chunks) {
      if (c.fromA > vpA.to && c.fromB > vpB.to) break
      if (c.toA < vpA.from && c.toB < vpB.from) continue
      const left = sideSpan(a, c.fromA, c.toA, c.endA, offA)
      const right = sideSpan(b, c.fromB, c.toB, c.endB, offB)
      const path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('class', changeKind(c.fromA, c.toA, c.fromB, c.toB))
      path.setAttribute('d', bandPath(width, left, right))
      paths.push(path)
    }
    svg.replaceChildren(...paths)
  }

  let frame = -1
  return {
    schedule: () => {
      if (frame < 0)
        frame = requestAnimationFrame(() => {
          frame = -1
          draw()
        })
    },
    destroy: () => {
      if (frame >= 0) cancelAnimationFrame(frame)
      svg.remove()
    },
  }
}

// ---------------------------------------------------------------------------------------------

const sameStat = (a: FileDiffStat | null, b: FileDiffStat): boolean =>
  !!a &&
  a.added === b.added &&
  a.removed === b.removed &&
  a.binary === b.binary &&
  a.bytes === b.bytes &&
  a.ref === b.ref

/** text put in from disk: neither an edit to save nor a step for Ctrl+Z to undo */
const diskAnnotations = [fromDisk, Transaction.addToHistory.of(false)]

function replaceAll(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: diskAnnotations })
}

export default function DiffView({ spec, editor, active, onClose, onError, onDirty }: Props): JSX.Element {
  const t = useT()
  const colours = useThemed(EDITOR_THEMES)
  const abs = join(spec.cwd, spec.path)
  const leftPath = spec.oldPath ?? spec.path

  const [stat, setStat] = useState<FileDiffStat | null>(null)
  /** "Load diff" was pressed for a large or generated file */
  const [forced, setForced] = useState(false)
  const [docs, setDocs] = useState<Docs | null>(null)
  /** the right side could not be read for a reason worth saying (too large, outside the roots) */
  const [note, setNote] = useState<string | null>(null)
  const [layout, setLayout] = useState<'split' | 'unified'>('split')
  const [collapse, setCollapse] = useState(true)
  const [wrap, setWrap] = useState(false)
  /** the unified view takes its fold setting only when built: bumping this rebuilds it */
  const [unifiedSeq, setUnifiedSeq] = useState(0)
  const [nav, setNav] = useState<{ current: number; total: number }>({ current: -1, total: 0 })

  const hostRef = useRef<HTMLDivElement>(null)
  const mergeRef = useRef<MergeView | null>(null)
  const unifiedRef = useRef<EditorView | null>(null)
  /** the editable buffer, when there is one: what the checked save writes */
  const rightRef = useRef<EditorView | null>(null)
  /** what the live view was built from, and the left text it now shows */
  const builtRef = useRef<{ docs: Docs; left: string } | null>(null)
  /** the right buffer as the previous view left it, for a rebuild of the same documents */
  const carryRef = useRef<string | null>(null)
  const seqRef = useRef(0)
  /** the compartments of the live view, per editor; a rebuilt view brings its own */
  const wrapSlots = useRef<{ view: EditorView; slot: Compartment }[]>([])
  const phraseSlots = useRef<{ view: EditorView; slot: Compartment }[]>([])

  const file = useCheckedFile({ path: abs, editor, viewRef: rightRef, onError })
  const { dirty, conflict, savedAt } = file

  // mirrors for the CodeMirror callbacks and the poll, written after the commit
  const fileRef = useRef(file)
  const coloursRef = useRef(colours)
  const wrapRef = useRef(wrap)
  const collapseRef = useRef(collapse)
  const tRef = useRef(t)
  // the parent passes a fresh closure every render: only a change of `dirty` is news to it
  const onDirtyRef = useRef(onDirty)
  const syncRef = useRef<(next: Loaded) => void>(() => undefined)
  useEffect(() => {
    fileRef.current = file
    coloursRef.current = colours
    wrapRef.current = wrap
    collapseRef.current = collapse
    tRef.current = t
    onDirtyRef.current = onDirty
  })

  useEffect(() => {
    onDirtyRef.current(dirty)
  }, [dirty])

  /**
   * One read of both sides lands in the live view. While the view stands on the same ref and
   * the same kind of right side, the texts are swapped in place — the scroll position, the
   * caret and the undo history stay. A dirty right buffer is never overwritten: a disk that
   * moved under it is shown as the editor's conflict, and the person picks a side.
   */
  useEffect(() => {
    syncRef.current = (next) => {
      const built = builtRef.current
      const sameShape = built && built.docs.ref === next.ref && built.docs.editable === next.editable
      if (!sameShape) {
        if (built && fileRef.current.isDirty()) {
          // the file vanished or the base moved while edits were pending: keep them, say so
          fileRef.current.flagConflict()
          return
        }
        if (next.editable) fileRef.current.loaded(next.right)
        seqRef.current += 1
        setDocs({ ...next, seq: seqRef.current })
        return
      }
      if (next.left !== built.left) {
        built.left = next.left
        const merge = mergeRef.current
        const unified = unifiedRef.current
        if (merge) replaceAll(merge.a, next.left)
        if (unified) {
          const orig = getOriginalDoc(unified.state)
          const changes = ChangeSet.of({ from: 0, to: orig.length, insert: next.left }, orig.length)
          unified.dispatch({ effects: originalDocChangeEffect(unified.state, changes) })
        }
      }
      const right = rightRef.current
      if (!next.editable || !right || next.right === fileRef.current.baseline()) return
      if (fileRef.current.isDirty()) {
        if (!fileRef.current.conflict) fileRef.current.flagConflict()
        return
      }
      fileRef.current.loaded(next.right)
      replaceAll(right, next.right)
    }
  })

  /**
   * The gate first, the content only if the gate lets it through: a lockfile is refused on its
   * numbers, before anything of it is read. Then both sides, every five seconds while the tab
   * is the visible one and the window is not hidden.
   */
  useEffect(() => {
    if (!active) return
    let alive = true
    const tick = async (): Promise<void> => {
      if (document.hidden) return
      const s = await window.api.git.fileDiffStat(
        spec.cwd,
        spec.path,
        spec.oldPath,
        spec.mode,
        spec.baseRef,
        spec.untracked,
      )
      if (!alive) return
      setStat((prev) => (sameStat(prev, s) ? prev : s))
      const verdict = gateVerdict(s, spec.path)
      // once a diff is on screen it stays: edits saved from this very view must not push it
      // past the line budget and take it away mid-edit
      const passed = forced || builtRef.current !== null
      if (verdict !== 'show' && !(passed && (verdict === 'large' || verdict === 'generated'))) return
      const [left, right] = await Promise.all([
        spec.untracked ? Promise.resolve(null) : window.api.git.fileAtRef(spec.cwd, s.ref, leftPath),
        window.api.files.read(abs),
      ])
      if (!alive) return
      // a refusal with a reason (too large, outside the roots, a picture) is said; a plain
      // failure is a file that is not there — a deletion, shown as an empty right side
      if ((!right.ok && right.code) || (right.ok && right.content === undefined)) {
        setNote(right.ok ? tRef.current('editor.diff.binary') : resultMessage(tRef.current, right))
        return
      }
      setNote(null)
      const text = right.ok ? right.content : undefined
      syncRef.current({ left: left ?? '', right: text ?? '', editable: text !== undefined, ref: s.ref })
    }
    void tick()
    const timer = window.setInterval(() => void tick(), POLL_MS)
    const onVisible = (): void => {
      if (!document.hidden) void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, forced, abs, leftPath, spec.cwd, spec.path, spec.oldPath, spec.mode, spec.baseRef, spec.untracked])

  // Declared before the view's own effect on purpose: on unmount React runs the cleanups in
  // this order, so the pending autosave is written while the buffer still exists.
  useEffect(() => () => fileRef.current.flush(abs), [abs])

  /**
   * The view itself: built when the documents arrive or the layout changes, destroyed with it.
   * A rebuild of the same documents (a layout switch) carries the right buffer over; the undo
   * history does not survive it — a new editor is a new state.
   */
  useEffect(() => {
    const host = hostRef.current
    if (!docs || !host) return
    const carried = builtRef.current?.docs === docs ? carryRef.current : null
    carryRef.current = null
    const rightText = carried ?? docs.right
    const tr = tRef.current

    const wrapSlot = new Compartment()
    const phraseSlot = new Compartment()
    let bands: Bands | null = null
    /**
     * The counter: how many differences, and which one the caret is in. Only the editor the
     * caret moved in (or the one being typed in) says which; the other side, which merely
     * received the new chunks, updates the total and leaves the position alone.
     */
    const reportNav = (view: EditorView, withCurrent: boolean): void => {
      const info = getChunks(view.state)
      if (!info) return
      const total = info.chunks.length
      if (!withCurrent) {
        setNav((prev) => (prev.total === total ? prev : { current: Math.min(prev.current, total - 1), total }))
        return
      }
      const isA = info.side === 'a'
      const ranges = info.chunks.map((c) => (isA ? { from: c.fromA, to: c.toA } : { from: c.fromB, to: c.toB }))
      const current = chunkAt(ranges, view.state.selection.main.head)
      setNav((prev) => (prev.current === current && prev.total === total ? prev : { current, total }))
    }
    const common = (path: string): Extension[] => {
      const lang = languageFor(path)
      return [
        lineNumbers(),
        highlightActiveLineGutter(),
        search(),
        highlightSelectionMatches(),
        themeSlot.of(coloursRef.current),
        diffTheme,
        diffMarks,
        wrapSlot.of(wrapRef.current ? EditorView.lineWrapping : []),
        phraseSlot.of(EditorState.phrases.of({ '$ unchanged lines': tr('editor.diff.unchanged') })),
        keymap.of([
          { key: 'F7', run: goToNextChunk },
          { key: 'Shift-F7', run: goToPreviousChunk },
        ]),
        EditorView.updateListener.of((u) => {
          bands?.schedule()
          if (u.selectionSet || (u.docChanged && u.view.hasFocus)) reportNav(u.view, true)
          else if (getChunks(u.startState)?.chunks !== getChunks(u.state)?.chunks) reportNav(u.view, false)
        }),
        lang ?? [],
      ]
    }
    const readOnly: Extension[] = [EditorState.readOnly.of(true), keymap.of(searchKeymap)]
    const right: Extension[] = docs.editable
      ? [
          history(),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                void fileRef.current.save()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((u) => {
            if (editedByUser(u)) fileRef.current.changed(u.state.doc.toString())
          }),
        ]
      : readOnly
    const revertTitle = tr('editor.diff.revert')
    const revertButton = (): HTMLElement => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'diff-revert'
      el.textContent = '»'
      el.title = revertTitle
      el.setAttribute('aria-label', revertTitle)
      // no right file to write into: the column stays (the bands are drawn in it), the arrows go
      if (!docs.editable) el.style.visibility = 'hidden'
      return el
    }
    const fold = collapseRef.current ? { collapseUnchanged: {} } : {}

    let views: EditorView[]
    if (layout === 'split') {
      const merge = new MergeView({
        a: { doc: docs.left, extensions: [...common(leftPath), ...readOnly] },
        b: { doc: rightText, extensions: [...common(spec.path), ...right] },
        parent: host,
        revertControls: 'a-to-b',
        renderRevertControl: revertButton,
        highlightChanges: false,
        gutter: false,
        ...fold,
      })
      mergeRef.current = merge
      bands = attachBands(merge)
      bands.schedule()
      rightRef.current = docs.editable ? merge.b : null
      views = [merge.a, merge.b]
    } else {
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: rightText,
          extensions: [
            ...common(spec.path),
            ...right,
            unifiedMergeView({
              original: docs.left,
              gutter: false,
              mergeControls: docs.editable
                ? (type, action) => {
                    const el = revertButton()
                    // "accept" would fold the change into HEAD's text inside the view only
                    if (type === 'accept') el.style.display = 'none'
                    else el.onmousedown = action
                    return el
                  }
                : false,
              ...fold,
            }),
          ],
        }),
      })
      unifiedRef.current = view
      rightRef.current = docs.editable ? view : null
      views = [view]
    }
    builtRef.current = { docs, left: docs.left }
    // the side the caret lives on: the working file, or the old one when nothing is left of it
    const primary = rightRef.current ?? views[0]
    if (primary) reportNav(primary, true)

    wrapSlots.current = views.map((v) => ({ view: v, slot: wrapSlot }))
    phraseSlots.current = views.map((v) => ({ view: v, slot: phraseSlot }))

    return () => {
      carryRef.current = rightRef.current ? rightRef.current.state.doc.toString() : null
      bands?.destroy()
      mergeRef.current?.destroy()
      unifiedRef.current?.destroy()
      mergeRef.current = null
      unifiedRef.current = null
      rightRef.current = null
      wrapSlots.current = []
      phraseSlots.current = []
    }
  }, [docs, layout, unifiedSeq, leftPath, spec.path])

  const liveViews = (): EditorView[] => {
    const merge = mergeRef.current
    if (merge) return [merge.a, merge.b]
    return unifiedRef.current ? [unifiedRef.current] : []
  }

  // recolour in place: the buffer, the undo history and the scroll survive a theme switch
  useEffect(() => {
    for (const v of liveViews()) v.dispatch({ effects: themeSlot.reconfigure(colours) })
  }, [colours])

  useEffect(() => {
    for (const { view, slot } of wrapSlots.current)
      view.dispatch({ effects: slot.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])

  useEffect(() => {
    const phrases = EditorState.phrases.of({ '$ unchanged lines': t('editor.diff.unchanged') })
    for (const { view, slot } of phraseSlots.current) view.dispatch({ effects: slot.reconfigure(phrases) })
  }, [t])

  const toggleCollapse = (): void => {
    const next = !collapse
    setCollapse(next)
    const merge = mergeRef.current
    if (merge) merge.reconfigure(next ? { collapseUnchanged: {} } : { collapseUnchanged: undefined })
    else setUnifiedSeq((n) => n + 1)
  }

  /** F7 / Shift+F7 from the toolbar, or from a key pressed outside both editors */
  const go = (dir: 1 | -1): void => {
    const views = liveViews()
    const target = views.find((v) => v.hasFocus) ?? rightRef.current ?? views[0]
    if (!target) return
    const command = dir > 0 ? goToNextChunk : goToPreviousChunk
    command({ state: target.state, dispatch: (tr) => target.dispatch(tr) })
    target.focus()
  }
  const goRef = useRef(go)
  useEffect(() => {
    goRef.current = go
  })

  useEffect(() => {
    // a hidden diff keeps its buffer but must not answer keys meant for the visible tab
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      // inside an editor the keymap has already taken it and said so
      if (e.key === 'F7' && !e.defaultPrevented) {
        e.preventDefault()
        goRef.current(e.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onClose])

  const verdict = stat ? gateVerdict(stat, spec.path) : null
  // documents exist only once the gate let them through, and from then on the gate is passed
  const gated = (verdict === 'large' || verdict === 'generated') && !docs
  const showView = !!docs && !note && verdict !== 'binary' && verdict !== 'too-large'
  const title = spec.oldPath ? `${spec.oldPath} → ${spec.path}` : spec.path
  const sizeKb = stat ? Math.round(stat.bytes / 1024) : 0

  return (
    <div className="diff-overlay" style={{ display: active ? 'flex' : 'none' }}>
      <div className="diff-head">
        <span className={'st ' + spec.status}>{spec.status}</span>
        <span className="file" title={title}>
          {title}
          {dirty && (
            <span className="dirty" title={t('editor.dirty')}>
              ●
            </span>
          )}
        </span>
        {stat && !stat.binary && (
          <>
            <span className="stat add">+{stat.added}</span>
            <span className="stat del">−{stat.removed}</span>
          </>
        )}
        {showView && (
          <span className="muted small">
            {!docs.editable
              ? t('editor.diff.readOnly')
              : conflict
                ? t('editor.status.conflict')
                : dirty
                  ? editor.autoSave
                    ? t('editor.status.saving')
                    : t('editor.status.unsaved')
                  : savedAt
                    ? t('editor.status.saved')
                    : ''}
          </span>
        )}
        <div className="spacer" />
        {showView && (
          <>
            <button
              className="ghost"
              onClick={() => go(-1)}
              title={t('editor.diff.prev')}
              aria-label={t('editor.diff.prev')}
            >
              ↑
            </button>
            <button
              className="ghost"
              onClick={() => go(1)}
              title={t('editor.diff.next')}
              aria-label={t('editor.diff.next')}
            >
              ↓
            </button>
            <span className="muted small diff-count">
              {nav.current >= 0 && nav.total > 0
                ? t('editor.diff.position', { current: nav.current + 1, total: nav.total })
                : t.plural('editor.diff.count', nav.total)}
            </span>
            <button
              className="ghost"
              onClick={() => setLayout((l) => (l === 'split' ? 'unified' : 'split'))}
              title={t('editor.diff.layout.title')}
            >
              {layout === 'split' ? t('editor.diff.layout.split') : t('editor.diff.layout.unified')}
            </button>
            <button
              className={'ghost' + (collapse ? ' on' : '')}
              aria-pressed={collapse}
              onClick={toggleCollapse}
              title={t('editor.diff.collapse.title')}
            >
              {t('editor.diff.collapse')}
            </button>
            <button className="ghost" onClick={() => setWrap((w) => !w)} title={t('editor.diff.wrap')}>
              {wrap ? t('editor.diff.wrap.on') : t('editor.diff.wrap.off')}
            </button>
          </>
        )}
        {conflict && (
          <>
            <button
              className="primary danger"
              onClick={() => void file.overwrite()}
              title={t('editor.overwrite.title')}
            >
              {t('editor.overwrite')}
            </button>
            <button onClick={() => void file.reload()} title={t('editor.reload.title')}>
              {t('editor.reload')}
            </button>
          </>
        )}
        {showView && docs.editable && !editor.autoSave && !conflict && (
          <button onClick={() => void file.save()} disabled={!dirty} title={t('editor.save.title')}>
            {t('editor.save')}
          </button>
        )}
        <button
          className="ghost"
          title={t('editor.diff.external')}
          onClick={() => void window.api.system.openPath(abs)}
        >
          ↗
        </button>
        <button className="ghost" onClick={onClose} title={t('editor.close')} aria-label={t('editor.diff.close.aria')}>
          ×
        </button>
      </div>

      {!stat && <div className="muted pad">{t('editor.diff.loading')}</div>}
      {verdict === 'binary' && <div className="muted pad">{t('editor.diff.binary')}</div>}
      {verdict === 'too-large' && <div className="muted pad">{t('editor.diff.tooLarge', { sizeKb })}</div>}
      {gated && !forced && (
        <div className="diff-note">
          <span className="muted">
            {verdict === 'generated'
              ? t('editor.diff.gate.generated')
              : t('editor.diff.gate.large', { lines: stat ? stat.added + stat.removed : 0, sizeKb })}
          </span>
          <button onClick={() => setForced(true)}>{t('editor.diff.gate.load')}</button>
        </div>
      )}
      {note && <div className="muted pad">{note}</div>}
      {stat && !docs && !note && (verdict === 'show' || (gated && forced)) && (
        <div className="muted pad">{t('editor.diff.loading')}</div>
      )}
      <div className="diff-host" ref={hostRef} style={showView ? undefined : { display: 'none' }} />
    </div>
  )
}
