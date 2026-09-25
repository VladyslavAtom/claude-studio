import type { AreaOf } from '../../types'

/** the project tabs and the empty state of the window */
export const projects = {
  /** the count under a closed project in the history menu; `zero` is the wording for "none at all" */
  sessionCount: { zero: 'no sessions', one: '{count} session', other: '{count} sessions' },
  'empty.hint': 'Open a folder with a project, or clone a repository from GitHub.',
  /** one operation, one key: the empty window and the «+» menu offer the same two, worded once */
  'empty.open': 'Open a folder…',
  'empty.clone': 'Clone a repository…',
  'tab.aria': 'Project {name}',
  /** the same name with what is happening inside it, worded by `sessions.pulse.*` */
  'tab.aria.status': 'Project {name} — {status}',
  'tab.title': '{path} · middle mouse button — close',
  /** the dot on the tab reports activity now, so git-ness is stated here instead */
  'tab.title.git': '{path} · git repository · middle mouse button — close',
  'rename.label': 'Project name',
  'menu.rename': 'Rename',
  'menu.rename.hint': 'double click',
  close: 'Close project',
  'close.aria': 'Close project {name}',
  'menu.close.hint': 'middle button',
  'closed.title': '{path} · closed {time} · right button — forget',
  'closed.forget': 'Forget “{name}”',
  'closed.forget.hint': 'the sessions will not come back',
  add: 'Add a project',
  settings: 'Agent settings',
  'pick.title': 'Open a project',
} as const

export type ProjectsArea = AreaOf<typeof projects>
