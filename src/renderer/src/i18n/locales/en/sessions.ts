import type { AreaOf } from '../../types'

/** the session list and the session a new window creates */
export const sessions = {
  /** the name the new-session window offers; a session that keeps it follows the agent's tab title */
  defaultName: 'Session {n}',
  'empty.title': 'No sessions yet.',
  /** the new-session action wherever it is offered: the empty pane and the «+» above the list */
  'empty.new': 'New session',
  'busy.worktreeAdd': 'Creating a worktree…',
  'busy.worktreeRemove': 'Removing the worktree…',
  'error.noSessionDir': 'the session directory no longer exists: {path}',
  'error.noConversationDir': 'the conversation directory no longer exists: {path}',
  title: 'Sessions',
  'files.toggle': 'Session files (Ctrl+B)',
  'list.aria': 'Sessions of the project',
  'list.empty': 'Empty',
  'item.aria': 'Session {name}',
  'item.title': '{path} · middle mouse button — close',
  'rename.label': 'Session name',
  /** shown while the name is still the generated one, which the agent's tab title may take over */
  'name.auto': '{name} · the name follows the agent’s title',
  /** the operation itself: the context menu and the confirming button of the closing dialog */
  close: 'Close the session',
  'close.title': 'Close the session (it goes to the history)',
  /** a project folder or a session directory deleted from disk; one wording for the tab and the row */
  missing: 'folder missing',
  'missing.title': 'The folder {path} is not on disk',
  recreateWorktree: 'Recreate worktree',
  'close.aria': 'Close the session “{name}”',
  'menu.rename': 'Rename',
  'menu.rename.hint': 'double click',
  'menu.close.hint': 'middle button',
  /** how many terminal tabs a session holds; a badge, so the wording is as short as it can be */
  tabCount: { one: '{count} tab', other: '{count} tabs' },
  'pulse.calling': { one: '{count} is waiting for you', other: '{count} are waiting for you' },
  'pulse.working': { one: '{count} is working', other: '{count} are working' },
  'pulse.idle': { one: '{count} is running, silent', other: '{count} are running, silent' },
  'pulse.asleep': { one: '{count} is asleep', other: '{count} are asleep' },
  'history.title': 'Session history',
  'history.agents': 'agents',
  'history.agents.title': 'Every agent conversation in this project',
  'history.item.title': '{path}\nclosed {time}',
  'history.restore': 'Open again',
  'history.restore.aria': 'Open the session “{name}” again',
  'history.forget': 'Remove from the history',
  'history.forget.aria': 'Remove “{name}” from the history',
  'history.worktreeRemoved': 'worktree removed',
  /** a session opened by another session's agent; the tooltip of its row names the parent */
  'child.of': 'opened by the session “{name}”',
  'children.count': { one: '{count} child', other: '{count} children' },
  'children.collapse': 'Hide the sessions it opened',
  'children.expand': 'Show the sessions it opened',
  /** a permission prompt of a tab in this session, answered from the list; see `PermissionCard` */
  'permission.aria': 'Permission asked in {tab}',
  'permission.title': '{tab} asks to use {tool}. Answer here or in the terminal: the first answer counts.',
  'permission.allow': 'Allow',
  'permission.deny': 'Deny',
} as const

export type SessionsArea = AreaOf<typeof sessions>
