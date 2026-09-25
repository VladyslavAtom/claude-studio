import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search'
import { useT } from '../i18n'
import { resultMessage } from '../ui/useGitAction'
import { EDITOR_THEMES, languageFor } from '../lib/editor'
import { basename } from '../lib/util'
import { useThemed } from '../theme/themeContext'
import type { EditorConfig } from '../../../shared/types'

/**
 * The slot the editor colours occupy in the configuration. A compartment is how CodeMirror lets
 * one extension be swapped on a running view: everything else in the state — the document, the
 * undo history, the selection, the pending autosave — is untouched by the reconfigure, which a
 * rebuilt `EditorView` would throw away. One instance for all editors is correct: a compartment
 * is only an identity, and each state resolves it against its own contents.
 */
const themeSlot = new Compartment()

/**
 * Put the caret on a line and scroll it into view. Clamped rather than trusted: the line comes
 * from terminal output, and `git.ts:900` in a file of 40 lines is stale output, not a reason to
 * throw. Centred, because a line pinned to the top of the viewport shows none of its context.
 */
function revealLine(view: EditorView, line: number): void {
  const target = Math.max(1, Math.min(Math.trunc(line), view.state.doc.lines))
  const pos = view.state.doc.line(target).from
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
}

interface Props {
  path: string
  /** the line to go to, when whoever opened the tab named one (a `git.ts:42` in the output) */
  line?: number
  /** session cwd, so the agent gets a repo-relative path */
  cwd: string
  editor: EditorConfig
  /**
   * Tab is the visible one. An inactive editor stays mounted and hidden: unmounting it
   * would throw away the unsaved buffer on every tab switch.
   */
  active?: boolean
  /** hand the current file (and selected line range) to the active agent tab */
  onSend: (text: string) => void
  onClose: () => void
  onSaved?: (path: string) => void
  onError: (msg: string) => void
}

export default function FileEditor({
  path,
  line,
  cwd,
  editor,
  active = true,
  onSend,
  onClose,
  onSaved,
  onError,
}: Props): JSX.Element {
  const t = useT()
  const editorColours = useThemed(EDITOR_THEMES)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const savedTextRef = useRef('')
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const autoSaveTimer = useRef<number | null>(null)
  const [readOnlyNote, setReadOnlyNote] = useState<string | null>(null)
  /** file changed under us (an agent rewrote it): writing would drop that change */
  const [conflict, setConflict] = useState(false)
  /**
   * A picture is shown, never edited: main answers with a data URL instead of text, and the
   * whole editor below — CodeMirror, autosave, the conflict check — is simply not built. Half a
   * megabyte of PNG rendered as text was what the tab used to do with it.
   */
  const [image, setImage] = useState<string | null>(null)

  /**
   * Mirrors of props and state for the CodeMirror callbacks, which are created once, when the
   * view is built, and outlive every render. All of them are written after the commit rather
   * than during render: a ref mutated while rendering does not survive a render React throws
   * away. Nothing reads them synchronously during that first commit — the view itself is built
   * inside a promise callback — so the one-commit delay costs nothing.
   */
  const editorRef = useRef(editor)
  const conflictRef = useRef(conflict)
  // the unmount flush reports its own conflicts, and by then the component is gone
  const onErrorRef = useRef(onError)
  const activeRef = useRef(active)
  // the wording changes when the language does, and the load effect must not re-read the file
  // for that: it is a spelling of the same message, not a different file
  const tRef = useRef(t)
  // the file is read asynchronously, so the theme may have changed between the open and the
  // moment the view is built; the effect below only reaches a view that already exists
  const coloursRef = useRef(editorColours)
  // the file is read before the view exists, so the line to go to has to survive that wait
  const lineRef = useRef(line)
  const save = useRef(async (): Promise<void> => {})
  useEffect(() => {
    editorRef.current = editor
    conflictRef.current = conflict
    onErrorRef.current = onError
    activeRef.current = active
    tRef.current = t
    coloursRef.current = editorColours
    lineRef.current = line
  })

  /**
   * A different file means a different editor. Reset while rendering rather than from the
   * effect below: an effect runs after the paint, so `editor.status.saved` from the previous
   * file stood over the new one's header for a frame.
   */
  const [openFor, setOpenFor] = useState(path)
  if (openFor !== path) {
    setOpenFor(path)
    setLoading(true)
    setReadOnlyNote(null)
    setConflict(false)
    setImage(null)
  }

  useEffect(() => {
    let disposed = false
    // the mirror effect above has not run for this commit yet, and the load below must not see
    // the previous file's conflict
    conflictRef.current = false

    void window.api.files.read(path).then((res) => {
      if (disposed || !hostRef.current) return
      setLoading(false)
      if (res.ok && res.image) {
        setImage(res.image)
        return
      }
      if (!res.ok || res.content === undefined) {
        setReadOnlyNote(resultMessage(tRef.current, res, tRef.current('editor.open.failed')))
        return
      }

      savedTextRef.current = res.content
      const lang = languageFor(path)
      const extensions: Extension[] = [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        foldGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        search(),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              void save.current()
              return true
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        themeSlot.of(coloursRef.current),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          setDirty(u.state.doc.toString() !== savedTextRef.current)
          // autosave: written after a pause in typing; Ctrl+S stays as the manual way
          if (!editorRef.current.autoSave) return
          // a pending conflict is resolved by hand: retrying on every keystroke would only spam
          if (conflictRef.current) return
          if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current)
          autoSaveTimer.current = window.setTimeout(() => void save.current(), editorRef.current.delayMs)
        }),
      ]
      if (lang) extensions.push(lang as Extension)

      const view = new EditorView({
        state: EditorState.create({ doc: res.content, extensions }),
        parent: hostRef.current,
      })
      viewRef.current = view
      const goTo = lineRef.current
      if (goTo !== undefined) revealLine(view, goTo)
      // a tab opened in the background must not take focus away from the visible one
      if (activeRef.current) view.focus()
    })

    return () => {
      disposed = true
      if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current)
      // unsaved work is flushed when the file closes, or autosave would be a lie
      if (editorRef.current.autoSave && !conflictRef.current && viewRef.current) {
        const text = viewRef.current.state.doc.toString()
        const expected = savedTextRef.current
        // the tab is going away, so the check runs detached: on a mismatch we keep the
        // file as the agent left it and only report it
        if (text !== expected) {
          void window.api.files.read(path).then((disk) => {
            if (disk.ok && disk.content !== undefined && disk.content !== expected) {
              onErrorRef.current(tRef.current('editor.conflict.unsaved', { file: basename(path) }))
              return
            }
            void window.api.files.write(path, text)
          })
        }
      }
      viewRef.current?.destroy()
      viewRef.current = null
      setDirty(false)
    }
  }, [path])

  /**
   * The tab is already open and a link named another line in the same file: go there. On the
   * first open the view does not exist yet and this does nothing — the load above reveals the
   * line through `lineRef` once the file has been read.
   *
   * Clicking the very same `file:42` twice moves nothing, because the line did not change. That
   * is the honest answer: the editor is already on that line, and scrolling back to it would
   * undo a deliberate scroll away from it.
   */
  useEffect(() => {
    const view = viewRef.current
    if (line === undefined || !view) return
    revealLine(view, line)
  }, [line])

  /**
   * Recolour the open editor. A `reconfigure` is a transaction like any other: it replaces what
   * the compartment holds and leaves the rest of the state alone, so the buffer, the undo stack,
   * the caret and the scroll position survive a theme switch — which they would not if the view
   * were rebuilt, and the file is loaded from disk only once, on open.
   *
   * A no-op while the file is still being read: the view is then built with the current colours
   * through `coloursRef` instead.
   */
  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeSlot.reconfigure(editorColours) })
  }, [editorColours])

  /**
   * A checked write: while the tab was open, an agent may have rewritten the file. A blind
   * write would erase its version, so the contents on disk are compared with what we read, and
   * on a mismatch nothing is written — it is shown instead. Overwriting stays its own button.
   */
  const write = async (text: string, force: boolean): Promise<void> => {
    if (!force) {
      const disk = await window.api.files.read(path)
      if (disk.ok && disk.content !== undefined && disk.content !== savedTextRef.current) {
        setConflict(true)
        conflictRef.current = true
        onError(t('editor.conflict.cancelled', { file: basename(path) }))
        return
      }
    }
    const res = await window.api.files.write(path, text)
    if (!res.ok) {
      onError(resultMessage(t, res, t('editor.save.failed')))
      return
    }
    savedTextRef.current = text
    setConflict(false)
    conflictRef.current = false
    setDirty(false)
    setSavedAt(Date.now())
    onSaved?.(path)
  }

  useEffect(() => {
    save.current = async (): Promise<void> => {
      const view = viewRef.current
      if (!view) return
      await write(view.state.doc.toString(), false)
    }
  })

  /** the conflict was settled for our buffer: write over what is on disk */
  const overwrite = async (): Promise<void> => {
    const view = viewRef.current
    if (!view) return
    await write(view.state.doc.toString(), true)
  }

  /** the conflict was settled for the disk: re-read the file, our edits go */
  const reload = async (): Promise<void> => {
    const view = viewRef.current
    const disk = await window.api.files.read(path)
    if (!view || !disk.ok || disk.content === undefined) {
      onError(resultMessage(t, disk, t('editor.reload.failed')))
      return
    }
    // before dispatch: the change listener then compares against the new «saved» text at once
    savedTextRef.current = disk.content
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: disk.content } })
    setConflict(false)
    conflictRef.current = false
    setDirty(false)
  }

  /** "@src/lib/jwt.ts:20-40" — what both CLIs understand as a file reference */
  const sendToAgent = (): void => {
    const view = viewRef.current
    const rel = path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path
    let ref = '@' + rel
    if (view) {
      const { from, to } = view.state.selection.main
      if (from !== to) {
        const a = view.state.doc.lineAt(from).number
        const b = view.state.doc.lineAt(to).number
        ref += a === b ? `:${a}` : `:${a}-${b}`
      }
    }
    onSend(ref + ' ')
  }

  useEffect(() => {
    // hidden editor keeps its buffer but must not answer keys meant for the visible tab
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onClose])

  // returning to the tab should put the caret back where it was
  useEffect(() => {
    if (active) viewRef.current?.focus()
  }, [active])

  return (
    <div className="editor-overlay" style={{ display: active ? 'flex' : 'none' }}>
      <div className="editor-head">
        <span className="file" title={path}>
          {basename(path)}
          {dirty && (
            <span className="dirty" title={t('editor.dirty')}>
              ●
            </span>
          )}
        </span>
        <span className="muted small">
          {image
            ? ''
            : conflict
              ? t('editor.status.conflict')
              : dirty
                ? editor.autoSave
                  ? t('editor.status.saving')
                  : t('editor.status.unsaved')
                : savedAt
                  ? t('editor.status.saved')
                  : editor.autoSave
                    ? t('editor.status.autoSave')
                    : ''}
        </span>
        <span className="muted small path">{path}</span>
        <div className="spacer" />
        <button onClick={sendToAgent} title={t('editor.send.title')}>
          {t('editor.send')}
        </button>
        {conflict && (
          <>
            <button className="primary danger" onClick={() => void overwrite()} title={t('editor.overwrite.title')}>
              {t('editor.overwrite')}
            </button>
            <button onClick={() => void reload()} title={t('editor.reload.title')}>
              {t('editor.reload')}
            </button>
          </>
        )}
        {!editor.autoSave && !conflict && !image && (
          <button onClick={() => void save.current()} disabled={!dirty} title={t('editor.save.title')}>
            {t('editor.save')}
          </button>
        )}
        <button
          className="ghost"
          onClick={onClose}
          title={t('editor.close')}
          aria-label={t('editor.close.editor.aria')}
        >
          ×
        </button>
      </div>
      {loading && <div className="muted pad">{t('editor.loading')}</div>}
      {readOnlyNote && <div className="muted pad">{readOnlyNote}</div>}
      {image && (
        <div className="editor-image">
          <img src={image} alt={basename(path)} />
        </div>
      )}
      <div className="editor-host" ref={hostRef} style={image ? { display: 'none' } : undefined} />
    </div>
  )
}
