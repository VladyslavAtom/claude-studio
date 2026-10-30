import type { AreaOf } from '../../types'

/** the worktrees of a project, the ones agents made themselves included: session rows, the panel switcher, the view */
export const worktrees = {
  /** a session row with no worktree of its own: the folder it works in, and that folder's branch */
  'row.mainFolder': 'main folder ({branch})',
  'row.mainFolderNoBranch': 'main folder',
  'row.more': { one: '+{count} more', other: '+{count} more' },
  /** the tooltip of a worktree line on a session row */
  'row.title': '{path}\nNamed in this session’s conversations',

  /** the changes panel head: which worktree the panels show */
  'switch.aria': 'Worktree shown in the changes panel and the file tree',
  'switch.main': 'main folder',

  /** the button in the sessions header and the view it opens */
  open: 'Worktrees of the project',
  title: 'Worktrees: {project}',
  hint: 'Every worktree of the project’s repositories, including the ones agents made themselves.',
  loading: 'Reading worktrees…',
  empty: 'No worktrees besides the main folders.',
  refresh: 'Refresh',

  'item.main': 'main folder',
  'item.detached': 'detached HEAD',
  'item.locked': 'locked',
  'item.statusLoading': 'checking…',
  'item.statusUnknown': 'status unknown',
  'item.clean': 'clean',
  'item.changed': { one: '{count} changed file', other: '{count} changed files' },
  'item.unpushed': { one: '{count} unpushed commit', other: '{count} unpushed commits' },
  'item.merged': 'merged',
  'item.notMerged': 'not merged',
  'item.live': 'in use',
  'item.live.title': 'An agent or a terminal works here, or a session lives here: it is not removed.',
  'item.owners': 'sessions: {names}',

  'action.openSession': 'Open a session here',
  'action.shell': 'Terminal here',
  'action.shell.noSession': 'Select a session first: the terminal opens as one of its tabs.',
  'action.remove': 'Remove…',

  /** the bulk removal: only worktrees with nothing to lose, shown before anything is removed */
  'bulk.button': 'Remove merged ({count})',
  'bulk.title': 'Remove merged worktrees',
  'bulk.hint':
    'Each of these is clean, merged and has nothing unpushed. The folder goes with its local branch (git worktree remove, git branch -d); a branch git refuses to delete stays.',
  'bulk.confirm': 'Remove {count}',
  'bulk.done': { one: 'Removed {count} worktree', other: 'Removed {count} worktrees' },
  busy: 'Removing worktree…',

  /** removing one worktree that is not safe: what would be lost, before the person confirms */
  'remove.title': 'Remove worktree {name}',
  'remove.safe': 'Nothing would be lost: no changes, everything pushed, merged.',
  'remove.loses': 'This will be lost:',
  'remove.notMerged': 'the branch {branch} is not merged',
  'remove.what': 'The folder and its local branch are deleted: ',
  'remove.confirm': 'Remove',

  'error.live': 'Not removed: an agent or a terminal works in it, or a session lives there.',
  'error.notSafe':
    'Not removed: it has changes, unpushed commits or is not merged. Remove it on its own, after the warning.',
  'error.notRemovable': 'Not a removable worktree of this repository.',
} as const

export type WorktreesArea = AreaOf<typeof worktrees>
