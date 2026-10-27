import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Transaction } from '@codemirror/state'
import type { EditorView, ViewUpdate } from '@codemirror/view'
import type { EditorConfig } from '../../../shared/types'
import { useT } from '../i18n'
import { resultMessage } from '../ui/useGitAction'
import { changesInvalidated } from '../lib/changesRefresh'
import { basename } from '../lib/util'

/** marks a transaction that put the disk's text into the buffer: not an edit, nothing to save */
export const fromDisk = Transaction.remote.of(true)

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
  savedAt: number | null
  /** a fresh read of the file went into the buffer: from now on it is what "saved" means */
  loaded: (text: string) => void
  /** the file as we last read or wrote it */
  baseline: () => string
  isDirty: () => boolean
  /** the buffer's text changed: track dirtiness, schedule the autosave */
  changed: (text: string) => void
  save: () => Promise<void>
  /** the conflict was settled for our buffer: write over what is on disk */
  overwrite: () => Promise<void>
  /** the conflict was settled for the disk: re-read the file, our edits go */
  reload: () => Promise<void>
  /** the disk moved under unsaved edits: say so, leave the buffer alone */
  flagConflict: () => void
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

  const write = async (text: string, force: boolean): Promise<void> => {
    const { path: file, t: tr, onError: report } = live.current
    if (!force) {
      const disk = await window.api.files.read(file)
      if (disk.ok && disk.content !== undefined && disk.content !== savedTextRef.current) {
        setConflict(true)
        report(tr('editor.conflict.cancelled', { file: basename(file) }))
        return
      }
    }
    const res = await window.api.files.write(file, text)
    if (!res.ok) {
      report(resultMessage(tr, res, tr('editor.save.failed')))
      return
    }
    savedTextRef.current = text
    setConflict(false)
    // typing may have gone on while the write was in flight: that part is still unsaved
    const now = viewRef.current?.state.doc.toString()
    setDirty(now !== undefined && now !== text)
    setSavedAt(Date.now())
    // the changes panel and every diff of this tree re-read now, not on their next poll
    changesInvalidated(file)
    live.current.onSaved?.(file)
  }

  const save = async (): Promise<void> => {
    const view = viewRef.current
    if (!view) return
    await write(view.state.doc.toString(), false)
  }

  return {
    dirty,
    conflict,
    savedAt,
    loaded: (text) => {
      savedTextRef.current = text
      conflictRef.current = false
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
    overwrite: async () => {
      const view = viewRef.current
      if (!view) return
      await write(view.state.doc.toString(), true)
    },
    reload: async () => {
      const { path: file, t: tr, onError: report } = live.current
      const view = viewRef.current
      const disk = await window.api.files.read(file)
      if (!view || !disk.ok || disk.content === undefined) {
        report(resultMessage(tr, disk, tr('editor.reload.failed')))
        return
      }
      // before dispatch: the change listener then compares against the new «saved» text at once
      savedTextRef.current = disk.content
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: disk.content },
        annotations: fromDisk,
      })
      setConflict(false)
      setDirty(false)
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
          void window.api.files.read(file).then((disk) => {
            if (disk.ok && disk.content !== undefined && disk.content !== expected) {
              report(tr('editor.conflict.unsaved', { file: basename(file) }))
              return
            }
            void window.api.files.write(file, text).then((res) => {
              if (res.ok) changesInvalidated(file)
            })
          })
        }
      }
      setDirty(false)
    },
    reset: () => {
      setConflictState(false)
    },
  }
}
