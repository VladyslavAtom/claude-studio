import type { AreaOf } from '../../types'

/**
 * Strings that belong to no single screen: the shell, the toasts, buttons repeated everywhere.
 *
 * The point of this area is that one word is worded once. A dialog that needs a cancel button
 * takes `common.cancel`; it does not add `modals.cancel` that happens to agree today. Anything
 * that only ever appears on one screen belongs to that screen's area, not here.
 */
export const common = {
  loading: 'Loading…',
  error: 'Error',

  // the buttons that end a dialog, in the order they usually stand
  cancel: 'Cancel',
  close: 'Close',
  save: 'Save',
  apply: 'Apply',
  ok: 'OK',
  done: 'Done',

  // the verbs a list offers over its items
  add: 'Add',
  create: 'Create',
  open: 'Open',
  rename: 'Rename',
  remove: 'Remove',
  delete: 'Delete',
  copy: 'Copy',
  search: 'Search',
  refresh: 'Refresh',
  retry: 'Retry',
  back: 'Back',

  /** the aria names of the shared primitives: `ui/Modal`, `ui/Menu`, `Splitter`, `ContextMenu` */
  'modal.close': 'Close the dialog',
  'menu.more': 'More',
  /** every context menu is opened the same way, from the tabs, the session list and the terminal */
  'menu.actions': 'Actions',
  /** one splitter component sits between the sessions, the files and the changes alike */
  'splitter.aria': 'Panel divider: the left and right arrows change the width',

  'toast.dismiss': ' (click to dismiss)',
  'state.notSaved': 'The state was not saved: {reason}',
} as const

export type CommonArea = AreaOf<typeof common>
