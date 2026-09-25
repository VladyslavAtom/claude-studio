import type { AreaOf } from '../../types'

/**
 * The terminal area: tab strip, agent buttons, sleep and wake, the run history.
 *
 * `exit.*` are the two lines the pane writes into the terminal itself when the process is gone
 * — text, not output, so it is worded here; the escapes that grey it out stay in the component.
 */
export const terminal = {
  'status.running': 'running',
  'status.waiting': 'waiting for you',
  'status.idle': 'idle',
  'status.asleep': 'asleep — a click wakes it and carries on from the same place',
  'status.dead': 'the process has finished',

  'tabs.aria': 'Session tabs',
  'tab.agent': 'Agent',
  'tab.aria': '{title} — {status}',
  'tab.hint': '{status} · middle mouse button — close',
  'tab.hintAgent': '{status} · {command} · middle mouse button — close',
  'tab.name.aria': 'Tab name',
  'tab.close': 'Close the terminal',
  'tab.close.aria': 'Close the “{title}” tab',

  'add.title': 'New tab: {what} (Ctrl+T)',
  'add.other': 'Another agent',
  'add.other.aria': 'Choose the agent for the new tab',
  'add.menu.aria': 'What to open the new tab with',

  'menu.rename': 'Rename',
  'menu.rename.hint': 'double click',
  'menu.close': 'Close the tab',
  'menu.close.hint': 'middle button',
  'menu.sleep': 'Send to sleep',
  'menu.sleep.hint': 'the process stops',
  'menu.clear': 'Clear the history',
  'menu.clear.hint': 'the screen stays, the process runs on',

  'history.title': 'History of agent sessions',
  'history.aria': 'History of agent sessions: {count}',
  'history.caption': 'Past runs in this session',
  'history.runId': 'id: {id}',
  'history.noId': 'the id is unknown — the agent’s picker will open',

  restart: 'Restart the process',
  'restart.aria': 'Restart the tab’s process',
  restarting: 'Restarting…',

  'sleep.card': '“{title}” is asleep.',
  'sleep.cardAgent': '“{title}” is asleep — the process is stopped, the conversation history is kept.',
  'sleep.wake': 'Wake up',

  // The bar above a frozen screen. It has one job: to say that what is underneath is a
  // photograph and not a running tab, because everything else about it looks alive.
  'sleep.frozen': 'Asleep: the last screen of “{title}”. The process is stopped.',
  'sleep.frozenAgent':
    'Asleep: the last screen of “{title}”. The process is stopped, the conversation history is kept.',

  // The one place the interface admits it has gone deaf. Actionable on purpose: there is nothing
  // left to fall back on, so the person has to be told what to look at.
  silent:
    'The agent is not reporting: nothing will tell you when it finishes, and no notification will come. Its hooks are not running — check the agent’s arguments (--bare) and the CLI’s own settings.',

  empty: 'No terminals — add an agent or a shell with the buttons above.',

  'exit.code': '— the process has finished (code {code}) —',
  'exit.notStarted': '— the process is not running —',

  'search.placeholder': 'Search in the terminal',
  'search.prev': 'Back (Shift+Enter)',
  'search.next': 'Forward (Enter)',
  'search.copyAll': 'Copy the whole output of the tab (Ctrl+Shift+A)',
  'search.copyAllLabel': '⧉ all',
  'search.close': 'Close the search (Esc)',

  // A path in the output that leads to a file that is really there. The hint says what a click
  // does and which file it means: the output may have written a relative path, and the one
  // resolved against the tab’s directory is what will open.
  'link.open': 'Open {path} in the editor',
  'link.openAt': 'Open {path} in the editor, line {line}',
  'link.gone': 'The file is no longer there',
  'link.notAFile': 'This is not a file — only files open in the editor',
  'link.failed': 'The file could not be opened',

  'menu.copy': 'Copy',
  'menu.copyAll': 'Copy the whole output',
  'menu.paste': 'Paste',
  'menu.find': 'Search',
  'run.agentGone': 'the agent of that run is no longer configured',
  'tab.asleep': 'the tab is asleep — wake it and try again',
  'notify.fallbackTitle': 'Terminal',
  'notify.waiting': '{project}: the agent is waiting for you',
} as const

export type TerminalArea = AreaOf<typeof terminal>
