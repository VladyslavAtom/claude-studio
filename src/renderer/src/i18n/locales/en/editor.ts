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
  'status.gone': 'the file is no longer on disk',
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
  'close.confirm': 'Close «{file}»?',
  'close.unsaved': 'The edits in this tab are not saved.',
  'close.conflict': 'The file changed on disk since it was opened. Overwrite writes your version over it.',
  'close.gone': 'The file is no longer on disk. Overwrite writes your version back.',
  'close.discard': "Don't save",

  'diff.wrap': 'Line wrapping',
  'diff.wrap.on': '⤶ on',
  'diff.wrap.off': '⤶ off',
  'diff.external': 'Open the file in the external editor',
  'diff.close.aria': 'Close the diff (Esc)',
  'diff.loading': 'Comparing…',
  'diff.binary': 'Binary file: there is no text to compare',
  'diff.tooLarge': 'The file is too large to compare here ({sizeKb} KB)',
  'diff.gate.large': 'A large diff ({lines} changed lines, {sizeKb} KB) is not loaded on its own',
  'diff.gate.generated': 'A lockfile or a generated file: its diff is not loaded on its own',
  'diff.gate.load': 'Load diff',
  'diff.readOnly': 'read only',
  'diff.prev': 'Previous difference (Shift+F7)',
  'diff.next': 'Next difference (F7)',
  'diff.count': { zero: 'no differences', one: '{count} difference', other: '{count} differences' },
  'diff.position': '{current} of {total}',
  'diff.layout.split': 'Side by side',
  'diff.layout.unified': 'Unified',
  'diff.layout.title': 'Switch between the side-by-side and the unified view',
  'diff.collapse': 'Collapse unchanged',
  'diff.collapse.title': 'Fold the unchanged lines between differences',
  'diff.revert': 'Replace this change with the original text (Ctrl+Z undoes it)',
  // CodeMirror's own phrase: `$` is its placeholder for the number, not ours
  'diff.unchanged': '$ unchanged lines',
  // review comments on the diff's new side, sent to the session's agent
  'review.add': 'Comment on this line (select lines first to comment on all of them)',
  'review.commented': 'A review comment covers this line',
  'review.placeholder': 'Comment for the agent… (Ctrl+Enter saves, Esc cancels)',
  'review.save': 'Save',
  'review.cancel': 'Cancel',
  'review.edit': 'Edit',
  'review.remove': 'Delete',
  'review.send': { one: 'Send {count} comment to the agent', other: 'Send {count} comments to the agent' },
  'review.send.title': "Paste this session's review comments into its agent tab as one prompt",
  'review.starting': 'The agent is starting: send again once it shows its prompt',
  'review.noAgent': 'No agent in this session can take the comments: open or restart an agent tab',
} as const

export type EditorArea = AreaOf<typeof editor>
