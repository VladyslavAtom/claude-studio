import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Compartment, Transaction, type Extension } from '@codemirror/state'
import type { EditorView, ViewUpdate } from '@codemirror/view'
import { history } from '@codemirror/commands'
import type { EditorConfig, FileContent } from '../../../shared/types'
import { useT } from '../i18n'
import { resultMessage } from '../ui/useGitAction'
import { changesInvalidated } from '../lib/changesRefresh'
import { basename } from '../lib/util'
import { detectEol, toLf, withEol, type Eol } from '../lib/lineEndings'

/** marks a transaction that put the disk's text into the buffer: not an edit, nothing to save */
export const fromDisk = Transaction.remote.of(true)

/** the undo history of a buffer that is saved to disk: `replaceFromDisk` swaps it for a fresh one */
const historySlot = new Compartment()
export const undoHistory = (): Extension => historySlot.of(history())

/**
 * Put the disk's text into the buffer as an undo barrier. Ctrl+Z past a re-read used to bring the
 * discarded buffer back, and autosave then wrote it over the version that had been re-read: the
 * history is dropped with the old text and a new one starts. The view must carry `undoHistory`.
 */
export function replaceFromDisk(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: fromDisk,
    effects: historySlot.reconfigure([]),
  })
  view.dispatch({ effects: historySlot.reconfigure(history()) })
}

/** a read that failed with no reason of the app's: the file is not there (deleted, renamed away) */
const missing = (disk: FileContent): boolean => !disk.ok && !disk.code

/** what closing the buffer now would cost; `none` is a close that loses nothing */
export type CloseRisk = 'none' | 'unsaved' | 'conflict' | 'gone'

/** what a tab's owner asks of an editor before closing it (see TerminalArea) */
export interface CloseGuard {
  risk: () => CloseRisk
  /** write the buffer, over the disk when it is in conflict; false when nothing was written */
  save: () => Promise<boolean>
}

/** the update carries an edit of the person's (or an undo of one), not a re-read from disk */
export function editedByUser(u: ViewUpdate): boolean {
  return u.transactions.some((tr) => tr.docChanged && !tr.annotation(Transaction.remote))
}

interface Options {
  path: string
  editor: EditorConfig
  /** the buffer that is written to `path`: the file editor, or the right side of a diff */
  viewRef: RefObject<EditorView | null>
  onError: (msg: string) => void
  onSaved?: (path: string) => void
}

export interface CheckedFile {
  dirty: boolean
  /** the file changed under us (an agent rewrote it): writing would drop that change */
  conflict: boolean
  /** the conflict is that the file is no longer there: deleted, or renamed away */
  gone: boolean
  savedAt: number | null
  /** a fresh read of the file went into the buffer: from now on it is what "saved" means */
  loaded: (text: string) => void
  /** the file as we last read or wrote it */
  baseline: () => string
  isDirty: () => boolean
  /** the buffer's text changed: track dirtiness, schedule the autosave */
  changed: (text: string) => void
  save: () => Promise<boolean>
  /** the conflict was settled for our buffer: write over what is on disk */
  overwrite: () => Promise<boolean>
  /** the conflict was settled for the disk: re-read the file, our edits go */
  reload: () => Promise<void>
  /** the disk moved under unsaved edits: say so, leave the buffer alone */
  flagConflict: () => void
  /**
   * Something may have changed on disk: a clean buffer takes the disk's text (an undo barrier),
   * a dirty one is put in conflict, a missing file is marked gone. No-op while a write is out.
   */
  reread: () => Promise<void>
  /** what closing now would lose */
  closeRisk: () => CloseRisk
  /** the buffer is going away: write what autosave still owes, checked, and detached */
  flush: (path: string) => void
  /** a different file is opening: forget the previous one's verdicts. Safe while rendering */
  reset: () => void
}

/**
 * A buffer saved with a check against the disk, shared by the file editor and the editable side
 * of the diff view. While a file is open an agent may rewrite it, and a blind write would erase
 * its version: before every write the disk is compared with what we last read, and on a
 * mismatch nothing is written — the conflict is shown instead, and overwriting stays its own
 * button.
 */
export function useCheckedFile({ path, editor, viewRef, onError, onSaved }: Options): CheckedFile {
  const t = useT()
  const savedTextRef = useRef('')
  const dirtyRef = useRef(false)
  const conflictRef = useRef(false)
  /** the line ending the file had when read: put back on every write */
  const eolRef = useRef<Eol>('\n')
  /** bumped as a write starts, so a re-read that overlapped one is dropped */
  const writeSeq = useRef(0)
  const writing = useRef(false)
  const goneRef = useRef(false)
  const [gone, setGoneState] = useState(false)
  const autoSaveTimer = useRef<number | null>(null)
  const [dirty, setDirtyState] = useState(false)
  const [conflict, setConflictState] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  /**
   * Mirrors for the callbacks, which CodeMirror holds from the moment a view is built and calls
   * long after the render that made them. Written after the commit, never during render.
   */
  const live = useRef({ path, editor, onError, onSaved, t })
  useEffect(() => {
    live.current = { path, editor, onError, onSaved, t }
  })

  const setDirty = (v: boolean): void => {
    dirtyRef.current = v
    setDirtyState(v)
  }
  const setConflict = (v: boolean): void => {
    conflictRef.current = v
    setConflictState(v)
  }
  const setGone = (v: boolean): void => {
    goneRef.current = v
    setGoneState(v)
  }

  const write = async (text: string, force: boolean): Promise<boolean> => {
    const { path: file, t: tr, onError: report } = live.current
    writeSeq.current += 1
    writing.current = true
    try {
      if (!force) {
        const disk = await window.api.files.read(file)
        // a file that is gone is not recreated by a keystroke: that takes Overwrite
        if (missing(disk)) {
          setConflict(true)
          setGone(true)
          report(tr('editor.conflict.cancelled', { file: basename(file) }))
          return false
        }
        if (disk.ok && disk.content !== undefined && toLf(disk.content) !== savedTextRef.current) {
          setConflict(true)
          report(tr('editor.conflict.cancelled', { file: basename(file) }))
          return false
        }
      }
      const res = await window.api.files.write(file, withEol(text, eolRef.current))
      if (!res.ok) {
        report(resultMessage(tr, res, tr('editor.save.failed')))
        return false
      }
    } finally {
      writing.current = false
    }
    savedTextRef.current = text
    setConflict(false)
    setGone(false)
    // typing may have gone on while the write was in flight: that part is still unsaved
    const now = viewRef.current?.state.doc.toString()
    setDirty(now !== undefined && now !== text)
    setSavedAt(Date.now())
    // the changes panel and every diff of this tree re-read now, not on their next poll
    changesInvalidated(file)
    live.current.onSaved?.(file)
    return true
  }

  const save = async (): Promise<boolean> => {
    const view = viewRef.current
    if (!view) return false
    return write(view.state.doc.toString(), false)
  }

  const overwrite = async (): Promise<boolean> => {
    const view = viewRef.current
    if (!view) return false
    return write(view.state.doc.toString(), true)
  }

  return {
    dirty,
    conflict,
    gone,
    savedAt,
    loaded: (text) => {
      eolRef.current = detectEol(text)
      savedTextRef.current = toLf(text)
      conflictRef.current = false
      goneRef.current = false
      dirtyRef.current = false
    },
    baseline: () => savedTextRef.current,
    isDirty: () => dirtyRef.current,
    changed: (text) => {
      setDirty(text !== savedTextRef.current)
      const { editor: cfg } = live.current
      // autosave: written after a pause in typing; Ctrl+S stays as the manual way
      if (!cfg.autoSave) return
      // a pending conflict is resolved by hand: retrying on every keystroke would only spam
      if (conflictRef.current) return
      if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = window.setTimeout(() => void save(), cfg.delayMs)
    },
    save,
    overwrite,
    reload: async () => {
      const { path: file, t: tr, onError: report } = live.current
      const view = viewRef.current
      const disk = await window.api.files.read(file)
      if (!view || !disk.ok || disk.content === undefined) {
        report(resultMessage(tr, disk, tr('editor.reload.failed')))
        return
      }
      // before dispatch: the change listener then compares against the new «saved» text at once
      eolRef.current = detectEol(disk.content)
      savedTextRef.current = toLf(disk.content)
      replaceFromDisk(view, savedTextRef.current)
      setConflict(false)
      setGone(false)
      setDirty(false)
    },
    reread: async () => {
      if (writing.current || !viewRef.current) return
      const seq = writeSeq.current
      const disk = await window.api.files.read(live.current.path)
      const view = viewRef.current
      // a write started meanwhile: what was read may be older than what it wrote
      if (writing.current || seq !== writeSeq.current || !view) return
      if (missing(disk)) {
        if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current)
        setConflict(true)
        setGone(true)
        return
      }
      if (!disk.ok || disk.content === undefined) return
      const text = toLf(disk.content)
      if (text === savedTextRef.current) {
        // the file came back as we knew it (a checkout, an undone delete)
        if (goneRef.current) {
          setGone(false)
          setConflict(false)
        }
        return
      }
      if (dirtyRef.current) {
        if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current)
        setConflict(true)
        return
      }
      eolRef.current = detectEol(disk.content)
      savedTextRef.current = text
      replaceFromDisk(view, text)
      setConflict(false)
      setGone(false)
    },
    closeRisk: () => {
      // a clean buffer of a deleted file holds nothing the disk did not have
      if (goneRef.current) return dirtyRef.current ? 'gone' : 'none'
      if (conflictRef.current) return 'conflict'
      return dirtyRef.current && !live.current.editor.autoSave ? 'unsaved' : 'none'
    },
    flagConflict: () => {
      if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current)
      setConflict(true)
    },
    flush: (file) => {
      if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current)
      const { editor: cfg, t: tr, onError: report } = live.current
      const view = viewRef.current
      // unsaved work is flushed when the buffer closes, or autosave would be a lie
      if (cfg.autoSave && !conflictRef.current && view) {
        const text = view.state.doc.toString()
        const expected = savedTextRef.current
        // the buffer is going away, so the check runs detached: on a mismatch we keep the file
        // as the agent left it and only report it
        if (text !== expected) {
          const eol = eolRef.current
          void window.api.files.read(file).then((disk) => {
            if (missing(disk) || (disk.ok && disk.content !== undefined && toLf(disk.content) !== expected)) {
              report(tr('editor.conflict.unsaved', { file: basename(file) }))
              return
            }
            void window.api.files.write(file, withEol(text, eol)).then((res) => {
              if (res.ok) changesInvalidated(file)
            })
          })
        }
      }
      setDirty(false)
    },
    reset: () => {
      setConflictState(false)
      setGone(false)
    },
  }
}
