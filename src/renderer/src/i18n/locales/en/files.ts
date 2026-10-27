import type { AreaOf } from '../../types'

/**
 * The file tree: the panel itself, its context menu, its errors.
 *
 * The `error.*` five are the reasons main gives for a directory with no rows, and they are five
 * rather than one because «empty» must not be what a locked, deleted or unreadable folder says.
 */
export const files = {
  'error.denied': 'No access to this folder',
  'error.missing': 'The folder is gone',
  'error.notADir': 'This is a file, not a folder',
  'error.outsideRoots': 'The folder is outside the open projects — the application does not read it',
  'error.failed': 'The folder could not be read',

  filter: 'Filter',
  'filter.aria': 'Filter by file name',
  refresh: 'Refresh',
  'refresh.aria': 'Re-read the file tree',
  hide: 'Hide the files panel',
  'tree.aria': 'Session files',
  loading: 'Reading the directory…',
  noMatches: 'Nothing found',
  empty: 'Empty',

  // the context menu, modelled on PyCharm's project view; `▸` is drawn by the menu, not written
  'menu.new': 'New',
  'menu.new.file': 'File',
  'menu.new.dir': 'Directory',
  'menu.cut': 'Cut',
  'menu.copy': 'Copy',
  'menu.paste': 'Paste',
  'menu.duplicate': 'Duplicate',
  'menu.copyPath': 'Copy Path',
  'menu.copyPath.absolute': 'Absolute path',
  'menu.copyPath.relative': 'Path relative to the project',
  'menu.copyPath.name': 'File name',
  'menu.rename': 'Rename…',
  'menu.delete': 'Delete…',
  'menu.openIn': 'Open in',
  'menu.openIn.fileManager': 'File manager',
  'menu.openIn.terminal': 'Terminal',
  'menu.openIn.default': 'Default app',
  'menu.git': 'Git',
  'menu.git.diff': 'Show diff',
  'menu.git.compare': 'Compare with branch…',
  'menu.git.history': 'Show history',
  'menu.git.ignore': 'Add to .gitignore',
  /** the keys the tree answers to, shown beside their items: key caps, the same in every locale */
  'key.rename': 'F2',
  'key.delete': 'Del',

  'new.file.label': 'Name of the new file',
  'new.dir.label': 'Name of the new directory',
  'rename.label': 'New name',
  'copyPath.done': 'Copied to the clipboard',

  'delete.confirm': { one: 'Move {count} item to the trash?', other: 'Move {count} items to the trash?' },
  'delete.warn': 'They can be restored from the system trash.',
  'delete.more': '…{count} more',

  // what the status line says while an operation runs
  'run.create': 'Creating',
  'run.rename': 'Renaming',
  'run.paste': 'Pasting',
  'run.duplicate': 'Duplicating',
  'run.delete': 'Moving to the trash',
  'run.open': 'Opening',
  'run.ignore': 'Adding to .gitignore',

  'history.title': 'History of «{name}»',
  'history.hint': 'A click compares that revision with the file as it is now.',
  'history.empty': 'No commits touch this path',
  'compare.title': 'Compare «{name}» with branch',
  'compare.filter': 'Filter branches',
  'compare.empty': 'No branches',

  'error.nameInvalid': '«{name}» is not a valid name: not empty, not «.» or «..», and no «/»',
  'error.nameExists': '«{name}» already exists there; nothing was overwritten',
  'error.moveIntoItself': '«{name}» cannot be put inside itself',
  'error.isRoot': 'The root folder of the tree is not changed from the tree',
  'error.notInRepo': 'This path is not inside a git repository',
  'note.ignoreListed': '{entry} is already in .gitignore',
} as const

export type FilesArea = AreaOf<typeof files>
