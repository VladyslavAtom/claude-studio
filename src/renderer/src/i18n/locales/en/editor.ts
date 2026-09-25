import type { AreaOf } from '../../types'

/**
 * The file editor and the diff and merge views. `{file}` in the conflict wordings is the base
 * name of the file, because those two go out as toasts, where a full path is unreadable.
 */
export const editor = {
  loading: 'Opening…',
  'open.failed': 'the file could not be opened',
  'save.failed': 'the file could not be saved',
  'reload.failed': 'the file could not be re-read',
  'conflict.unsaved': '{file}: the file changed on disk — the unsaved edits were not written',
  'conflict.cancelled': '{file}: the file changed on disk — the save was cancelled',

  dirty: 'Not saved',
  'status.conflict': 'the file changed on disk',
  'status.saving': 'saving…',
  'status.unsaved': 'not saved — Ctrl+S',
  'status.saved': 'saved',
  'status.autoSave': 'autosave',

  send: '→ to the agent',
  'send.title': 'Put a reference to the file into the active agent tab',
  overwrite: 'Overwrite',
  'overwrite.title': 'Write our version over what is on disk',
  reload: 'Re-read',
  'reload.title': 'Re-read the file from disk: our edits will be lost',
  save: 'Save',
  'save.title': 'Save (Ctrl+S)',
  close: 'Close (Esc)',
  'close.editor.aria': 'Close the editor (Esc)',

  'diff.wrap': 'Line wrapping',
  'diff.wrap.on': '⤶ on',
  'diff.wrap.off': '⤶ off',
  'diff.external': 'Open the file in the external editor',
  'diff.close.aria': 'Close the diff (Esc)',
  'diff.empty': 'Nothing to show',
} as const

export type EditorArea = AreaOf<typeof editor>
