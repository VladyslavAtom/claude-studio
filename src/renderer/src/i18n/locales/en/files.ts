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
} as const

export type FilesArea = AreaOf<typeof files>
