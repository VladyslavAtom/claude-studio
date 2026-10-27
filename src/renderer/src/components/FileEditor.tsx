import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search'
import { useT } from '../i18n'
import { resultMessage } from '../ui/useGitAction'
import { EDITOR_THEMES, languageFor, themeSlot } from '../lib/editor'
import { basename } from '../lib/util'
import { useThemed } from '../theme/themeContext'
import { editedByUser, undoHistory, useCheckedFile, type CloseGuard } from '../hooks/useCheckedFile'
import { useChangesRefresh } from '../hooks/useChangesRefresh'
import type { EditorConfig, TerminalTab } from '../../../shared/types'

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
  /**
   * The file. It changes only when the file itself was renamed or moved (see `pathsMoved`): the
   * buffer, its undo history and its unsaved edits stay, and the next save goes to the new path.
   */
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
  /** the session's tabs: whether the re-read needs a fallback poll (see `useChangesRefresh`) */
  terminals: readonly TerminalTab[]
  /** hand the current file (and selected line range) to the active agent tab */
  onSend: (text: string) => void
  onClose: () => void
  /** what closing would lose, asked before the tab closes; null as the editor goes away */
  onGuard?: (guard: CloseGuard | null) => void
  onSaved?: (path: string) => void
  onError: (msg: string) => void
}

export default function FileEditor({
  path,
  line,
  cwd,
  editor,
  active = true,
  terminals,
  onSend,
  onClose,
  onGuard,
  onSaved,
  onError,
}: Props): JSX.Element {
  const t = useT()
  const editorColours = useThemed(EDITOR_THEMES)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [loading, setLoading] = useState(true)
  const [readOnlyNote, setReadOnlyNote] = useState<string | null>(null)
  /** the checked save, the autosave and the conflict with the disk — shared with the diff view */
  const file = useCheckedFile({ path, editor, viewRef, onError, ...(onSaved ? { onSaved } : {}) })
  const { dirty, conflict, gone, savedAt } = file
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
  const fileRef = useRef(file)
  const activeRef = useRef(active)
  // the wording changes when the language does, and the load effect must not re-read the file
  // for that: it is a spelling of the same message, not a different file
  const tRef = useRef(t)
  // the file is read asynchronously, so the theme may have changed between the open and the
  // moment the view is built; the effect below only reaches a view that already exists
  const coloursRef = useRef(editorColours)
  // the file is read before the view exists, so the line to go to has to survive that wait
  const lineRef = useRef(line)
  // the file is read once, on mount: a later path is the same file moved, not a new one to load
  const pathRef = useRef(path)
  const onGuardRef = useRef(onGuard)
  useEffect(() => {
    fileRef.current = file
    activeRef.current = active
    tRef.current = t
    coloursRef.current = editorColours
    lineRef.current = line
    pathRef.current = path
    onGuardRef.current = onGuard
  })

  useEffect(() => {
    const register = onGuardRef.current
    register?.({
      risk: () => fileRef.current.closeRisk(),
      // in conflict, or with the file gone, saving is writing over the disk: the dialog said so
      save: () => (fileRef.current.closeRisk() === 'unsaved' ? fileRef.current.save() : fileRef.current.overwrite()),
    })
    return () => register?.(null)
  }, [])

  useEffect(() => {
    let disposed = false
    const path = pathRef.current

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

      fileRef.current.loaded(res.content)
      const lang = languageFor(path)
      const extensions: Extension[] = [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        foldGutter(),
        undoHistory(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        search(),
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
          ...foldKeymap,
          indentWithTab,
        ]),
        themeSlot.of(coloursRef.current),
        EditorView.updateListener.of((u) => {
          if (editedByUser(u)) fileRef.current.changed(u.state.doc.toString())
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
      fileRef.current.flush(pathRef.current)
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [])

  /**
   * The disk may have moved under the buffer — an agent's turn ended, the app wrote, the window
   * came back: a clean buffer takes the new text, a dirty one shows the conflict, a deleted file
   * is marked so (see `reread`). Only while visible; coming back to the tab, or the file moving
   * to a new path, re-reads at once.
   */
  useChangesRefresh({
    cwd: path,
    terminals,
    enabled: active && !loading && !image,
    refresh: () => fileRef.current.reread(),
  })
  useEffect(() => {
    if (active) void fileRef.current.reread()
  }, [active, path])

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

  // returning to the tab should put the caret back where it was
  useEffect(() => {
    if (active) viewRef.current?.focus()
  }, [active])

  return (
    <div
      className="editor-overlay"
      style={{ display: active ? 'flex' : 'none' }}
      // Escape closes the tab only from inside it, and only when nothing inside took the key
      // first: CodeMirror's search panel, a multi-selection, a popup
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return
        e.preventDefault()
        onClose()
      }}
    >
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
            : gone
              ? t('editor.status.gone')
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
            <button
              className="primary danger"
              onClick={() => void file.overwrite()}
              title={t('editor.overwrite.title')}
            >
              {t('editor.overwrite')}
            </button>
            {!gone && (
              <button onClick={() => void file.reload()} title={t('editor.reload.title')}>
                {t('editor.reload')}
              </button>
            )}
          </>
        )}
        {!editor.autoSave && !conflict && !image && (
          <button onClick={() => void file.save()} disabled={!dirty} title={t('editor.save.title')}>
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
