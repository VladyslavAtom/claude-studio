import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import type { ConflictInfo } from '../../../shared/types'
import { useT, type T } from '../i18n'
import { changesInvalidated } from '../lib/changesRefresh'
import { EDITOR_THEMES, languageFor, themeSlot } from '../lib/editor'
import { baseSeeds, layout, parseConflicts, renderResult, sideLabels, type Layout, type SideLabel } from '../lib/merge3'
import { applySide, mergeTheme, resultExtensions, setSideInfo, sideExtensions } from '../lib/mergeEditor'
import { gapsFor, regionsField } from '../lib/mergeState'
import { basename } from '../lib/util'
import { useThemed } from '../theme/themeContext'
import { resultMessage } from '../ui/useGitAction'

interface Props {
  cwd: string
  path: string
  onClose: () => void
  onError: (msg: string) => void
  onResolved: () => void
}

interface Loaded {
  layout: Layout
  info: ConflictInfo
}

function sideText(t: T, label: SideLabel): string {
  switch (label.kind) {
    case 'yours':
      return t('changes.merge.side.yours')
    case 'yoursOn':
      return t('changes.merge.side.yoursOn', { ref: label.ref })
    case 'yourCommit':
      return t('changes.merge.side.yourCommit', { commit: label.commit })
    case 'incoming':
      return t('changes.merge.side.incoming')
    case 'incomingFrom':
      return t('changes.merge.side.incomingFrom', { ref: label.ref })
    case 'upstream':
      return t('changes.merge.side.upstream', { ref: label.ref })
  }
}

/**
 * The three-way merge editor, PyCharm's layout: «yours» on the left, the result in the middle
 * (editable, starting from the common base in every conflict), the incoming side on the right,
 * an arrow per conflict on each side. The panes are kept level by spacers and scroll together.
 */
export default function MergeTab({ cwd, path, onClose, onError, onResolved }: Props): JSX.Element {
  const t = useT()
  const colours = useThemed(EDITOR_THEMES)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [unresolved, setUnresolved] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  const leftHost = useRef<HTMLDivElement>(null)
  const resultHost = useRef<HTMLDivElement>(null)
  const rightHost = useRef<HTMLDivElement>(null)
  const viewsRef = useRef<EditorView[]>([])
  const resultRef = useRef<EditorView | null>(null)
  /** edits not yet on disk; a ref so the unmount flush sees the last value */
  const dirtyRef = useRef(false)
  /** Ctrl+S inside the result, which is built once: the save of the latest render */
  const saveRef = useRef<(markResolved: boolean) => Promise<void>>(() => Promise.resolve())
  const coloursRef = useRef(colours)
  const tRef = useRef(t)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    coloursRef.current = colours
    tRef.current = t
    onErrorRef.current = onError
  })

  const rel = path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path
  const sides = loaded ? sideLabels(loaded.info) : null
  const yoursIs = sides?.yoursIs ?? 'ours'

  useEffect(() => {
    let alive = true
    void Promise.all([window.api.files.read(path), window.api.git.conflictInfo(cwd, rel)]).then(([res, info]) => {
      if (!alive) return
      if (!res.ok || res.content === undefined) {
        // a refusal the app decided on itself (outside the roots, too large, binary) arrives
        // as a code and is worded here; the filesystem's own message passes through as it is
        onErrorRef.current(resultMessage(tRef.current, res, tRef.current('changes.merge.openFailed')))
        return
      }
      const blocks = parseConflicts(res.content)
      setLoaded({ layout: layout(blocks, baseSeeds(blocks, info.diff3), sideLabels(info).yoursIs), info })
    })
    return () => {
      alive = false
    }
  }, [cwd, path, rel])

  /** the file as it should be written now: settled conflicts as edited, the rest as markers */
  const fileText = (): string | null => {
    const view = resultRef.current
    if (!view || !loaded) return null
    const { regions, blocks } = loaded.layout
    return renderResult(view.state.doc.toString(), regions, view.state.field(regionsField), blocks)
  }
  const fileTextRef = useRef(fileText)
  useEffect(() => {
    fileTextRef.current = fileText
  })

  // Declared before the views' own effect on purpose: on unmount React runs the cleanups in
  // this order, so pending edits are written while the result still exists. Unresolved
  // conflicts go back as markers, so nothing of the conflict is lost by closing the tab.
  useEffect(
    () => () => {
      if (!dirtyRef.current) return
      const text = fileTextRef.current()
      if (text !== null) void window.api.files.write(path, text).then(() => changesInvalidated(path))
    },
    [path],
  )

  useEffect(() => {
    const hosts = [leftHost.current, resultHost.current, rightHost.current]
    if (!loaded || hosts.some((h) => !h)) return
    const [leftEl, resultEl, rightEl] = hosts as HTMLDivElement[]
    const lay = loaded.layout
    const language = languageFor(path)
    const common: Extension = [
      lineNumbers(),
      highlightActiveLineGutter(),
      themeSlot.of(coloursRef.current),
      mergeTheme,
      language ?? [],
    ]
    const take = tRef.current('changes.merge.takeChange')

    const sync = (): void => {
      const [left, result, right] = viewsRef.current
      if (!left || !result || !right) return
      const regions = result.state.field(regionsField)
      const gaps = gapsFor(result.state, lay)
      const resolved = regions.map((r) => r.resolved)
      left.dispatch({
        effects: setSideInfo.of({ gaps: gaps[0] ?? [], resolved, applied: regions.map((r) => r.yours) }),
      })
      right.dispatch({
        effects: setSideInfo.of({ gaps: gaps[2] ?? [], resolved, applied: regions.map((r) => r.incoming) }),
      })
      setUnresolved(regions.filter((r) => !r.resolved).length)
    }

    const arrow = (side: 'yours' | 'incoming') => (index: number) => {
      const result = resultRef.current
      const region = lay.regions[index]
      if (result && region) applySide(result, index, side, side === 'yours' ? region.yours : region.incoming)
    }

    const side = (doc: string, parent: HTMLElement, ext: Extension): EditorView =>
      new EditorView({
        parent,
        state: EditorState.create({ doc, extensions: [common, EditorState.readOnly.of(true), ext] }),
      })

    const left = side(lay.left, leftEl, sideExtensions(lay, 'left', take, arrow('yours')))
    const right = side(lay.right, rightEl, sideExtensions(lay, 'right', take, arrow('incoming')))
    const result = new EditorView({
      parent: resultEl,
      state: EditorState.create({
        doc: lay.result,
        extensions: [
          common,
          highlightActiveLine(),
          history(),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                void saveRef.current(false)
                return true
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          resultExtensions(lay),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              dirtyRef.current = true
              setDirty(true)
            }
            if (u.docChanged || u.startState.field(regionsField) !== u.state.field(regionsField)) sync()
          }),
        ],
      }),
    })
    viewsRef.current = [left, result, right]
    resultRef.current = result
    sync()

    // the spacers make the three documents equally tall, so one scrollTop fits all three
    const scrollers = viewsRef.current.map((v) => v.scrollDOM)
    const onScroll = (e: Event): void => {
      const from = e.currentTarget as HTMLElement
      for (const s of scrollers) {
        if (s !== from && Math.abs(s.scrollTop - from.scrollTop) > 1) s.scrollTop = from.scrollTop
        if (s !== from && Math.abs(s.scrollLeft - from.scrollLeft) > 1) s.scrollLeft = from.scrollLeft
      }
    }
    for (const s of scrollers) s.addEventListener('scroll', onScroll)
    return () => {
      for (const s of scrollers) s.removeEventListener('scroll', onScroll)
      for (const v of viewsRef.current) v.destroy()
      viewsRef.current = []
      resultRef.current = null
    }
  }, [loaded, path])

  // a theme switch recolours the live editors: rebuilding them would lose the result's edits
  useEffect(() => {
    for (const v of viewsRef.current) v.dispatch({ effects: themeSlot.reconfigure(colours) })
  }, [colours])

  const save = async (markResolved: boolean): Promise<void> => {
    const text = fileText()
    if (text === null) return
    setBusy(true)
    try {
      const res = await window.api.files.write(path, text)
      if (!res.ok) {
        onError(resultMessage(t, res, t('changes.merge.writeFailed')))
        return
      }
      dirtyRef.current = false
      setDirty(false)
      // the panel and any diff of this file re-read: the markers are gone from disk
      changesInvalidated(path)
      if (!markResolved) return
      const marked = await window.api.git.markResolved(cwd, [rel])
      if (!marked.ok) {
        onError(resultMessage(t, marked, t('changes.merge.addFailed')))
        return
      }
      changesInvalidated(path)
      onResolved()
      onClose()
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    saveRef.current = save
  })

  /** one side for the whole file, through git: «yours» is git's `theirs` during a rebase */
  const acceptWhole = async (side: 'yours' | 'incoming'): Promise<void> => {
    const gitSide = side === 'yours' ? yoursIs : yoursIs === 'ours' ? 'theirs' : 'ours'
    setBusy(true)
    try {
      const res = await window.api.git.acceptSide(cwd, rel, gitSide)
      if (!res.ok) {
        onError(resultMessage(t, res, t('changes.merge.sideFailed')))
        return
      }
      // git wrote the file: the unmount flush must not write the result over it
      dirtyRef.current = false
      changesInvalidated(path)
      onResolved()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const labels = sides ? { yours: sideText(t, sides.yours), incoming: sideText(t, sides.incoming) } : null

  return (
    <div className="merge-tab">
      <div className="merge-head">
        <span className="file" title={path}>
          {basename(path)}
        </span>
        <span className="muted small">{t.plural('changes.merge.conflicts', unresolved)}</span>
        <div className="spacer" />
        <button
          onClick={() => void acceptWhole('yours')}
          disabled={!loaded || busy}
          title={t('changes.merge.wholeFile')}
        >
          {t('changes.merge.takeYours')}
        </button>
        <button
          onClick={() => void acceptWhole('incoming')}
          disabled={!loaded || busy}
          title={t('changes.merge.wholeFile')}
        >
          {t('changes.merge.takeIncoming')}
        </button>
        <button onClick={() => void save(false)} disabled={!dirty || busy}>
          {t('common.save')}
        </button>
        <button className="primary" onClick={() => void save(true)} disabled={!loaded || unresolved > 0 || busy}>
          {t('common.done')}
        </button>
        <button className="ghost" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
          ×
        </button>
      </div>

      {!loaded && <div className="muted pad">{t('changes.merge.reading')}</div>}
      <div className="merge-panes" hidden={!loaded} data-testid="merge-panes">
        <div className="merge-pane">
          <div className="merge-pane-head yours" title={labels?.yours}>
            {labels?.yours}
          </div>
          <div className="merge-pane-body" ref={leftHost} data-testid="merge-yours" />
        </div>
        <div className="merge-pane">
          <div className="merge-pane-head result" title={t('changes.merge.hint')}>
            {t('changes.merge.side.result')}
          </div>
          <div className="merge-pane-body" ref={resultHost} data-testid="merge-result" />
        </div>
        <div className="merge-pane">
          <div className="merge-pane-head incoming" title={labels?.incoming}>
            {labels?.incoming}
          </div>
          <div className="merge-pane-body" ref={rightHost} data-testid="merge-incoming" />
        </div>
      </div>
    </div>
  )
}
