import type { AreaOf } from '../../types'

/**
 * The settings page. Keys are grouped by the tab they belong to; a key that carries a value
 * spells it as `{name}` and the caller passes it in.
 */
export const settings = {
  back: 'Back (Esc)',
  'back.aria': 'Back to the sessions (Esc)',
  title: 'Settings',
  unsaved: 'there are unsaved changes',
  reset: 'Reset to defaults',
  save: 'Save',
  saved: 'Saved',
  close: 'Close',

  'tab.agents': 'Agents',
  'tab.agents.hint': 'what runs in the tabs',
  'tab.sleep': 'Sleep and startup',
  'tab.sleep.hint': 'idling and application start',
  'tab.notifications': 'Notifications',
  'tab.notifications.hint': 'sound and system ones',
  'tab.commits': 'Commits',
  'tab.commits.hint': 'message generation',
  'tab.git': 'Git',
  'tab.git.hint': 'updating the project',
  'tab.terminal': 'Terminal',
  'tab.terminal.hint': 'how much history is kept',
  'tab.editor': 'Editor',
  'tab.editor.hint': 'saving files',
  'tab.appearance': 'Appearance',
  'tab.appearance.hint': 'language and colours',

  'health.blocked':
    'Changes are not being saved. The state file on disk was written by a newer version of the ' +
    'application — it was not read and will not be overwritten, so that projects and sessions are ' +
    'not lost. Everything you change here will be gone at the next start.',
  'health.details': 'Details: {reason}',
  'health.update': 'Update the application to the latest version.',
  'health.backup':
    'The main state file could not be read — projects and sessions were restored from a backup, ' +
    'so the most recent changes may not have made it.',
  'health.empty':
    'Neither the state file nor the backup could be read — the application started from a clean ' +
    'slate, and the list of projects and sessions is empty for that reason, not because you never ' +
    'made any.',
  'health.corruptKept': 'The corrupted file was kept: {reason}',
  'health.corruptAside': 'A copy of the corrupted file lies next to it, with .corrupt- in the name.',
  'health.encryptionWeak':
    'This machine has no system key store, and the agents’ environment variables are encrypted by ' +
    'a fallback with a built-in key — that is camouflage, not protection. The tokens entered below ' +
    '(ANTHROPIC_API_KEY and the like) can be read by anyone who gets to the state file.',
  'health.encryptionNone':
    'The agents’ environment variables are stored on disk in plain text: the system key store is ' +
    'unavailable. The tokens entered below (ANTHROPIC_API_KEY and the like) can be read by anyone ' +
    'who gets to the state file.',

  'agents.enabled': 'Show the button above the terminal',
  'agents.add': 'Add an agent',
  'agents.presets': 'Ready-made agents',
  'agents.remove': 'Remove',
  'agents.remove.aria': 'Remove the selected agent',
  'agents.orderHint': 'The order is dragged with the mouse and sets the order of the buttons above the terminal.',
  'agents.pickOne': 'Select an agent on the left',
  'agents.name': 'Name (on the tab)',
  'agents.extraArgs': 'Extra arguments',
  'agents.command': 'Command',
  'agents.identity': 'Conversation identity',
  'identity.uuid': 'own UUID via',
  'identity.codex': 'read the id from the codex index',
  'identity.none': 'no identity',
  'agents.args': 'Arguments on start',
  'agents.resumeArgs': 'Resume arguments',
  'agents.historyArgs': 'History arguments (session picker)',

  'preset.label': 'Preset',
  'preset.binary': 'Binary',
  // a pair of segments around an inline <code>: each segment carries the spaces it needs, so a
  // locale is free to put the punctuation where its own grammar wants it
  'preset.binaryHint.before': 'A name from PATH or a full path: this is also where wrappers such as ',
  'preset.binaryHint.after': ' go, when another profile is needed.',
  'preset.missing': 'There is no file at this path.',
  'preset.resume': 'Resume',
  'preset.custom': 'Custom agent',
  'preset.claude.hint':
    'A conversation of its own for every tab: we hand out the id, resuming goes through --resume. ' +
    'The profile is set by CLAUDE_CONFIG_DIR.',
  'preset.codex.hint':
    'Codex hands out the id itself and reports it when its first turn ends — so a tab restarted ' +
    'before it has answered starts a new conversation.',
  'preset.custom.hint': 'Fully manual: the command, the arguments and the way to address a conversation.',

  'env.label': 'Environment variables (KEY=value, one per line)',
  'color.label': 'Label colour',
  'color.pick': 'Pick another colour',
  'color.another': '↻ another',
  'command.final': 'Final command:',
  'command.profile.before': 'The profile is set right here, through ',
  'command.profile.after': ' — the environment the application itself was started from does not reach the tabs.',

  'sleep.enabled': 'Put idle agent tabs to sleep',
  'sleep.minutes': 'After how many minutes of silence',
  'sleep.startup': 'At application start',
  'startup.ask': 'ask',
  'startup.all': 'start every agent',
  'startup.none': 'leave them asleep',
  'sleep.hint':
    'A sleeping tab is a stopped process. On a click the agent comes back up and carries its ' +
    'conversation on, if it is kept in its own store; if it is not, it starts from scratch with the same id.',

  'git.pullButton': 'The Pull button (“update the project”)',
  'git.pull.ask': 'ask every time',
  'git.pull.rebase': 'Rebase — move my commits on top',
  'git.pull.merge': 'Merge — create a merge commit',
  'git.hint':
    'Rebase keeps the history linear but rewrites my commits: a branch that has been pushed already ' +
    'will have to be force-pushed. Merge rewrites nothing and adds a merge commit. Both lift ' +
    'uncommitted edits out of the way with --autostash and put them back afterwards.',

  'notify.enabled': 'System notifications',
  'notify.sound': 'Sound',
  'notify.test': '▶ test',
  'notify.test.title': 'Test the sound',
  'notify.unfocused': 'Only while the window is out of focus',
  'notify.hint':
    'Agents ring the terminal bell when they are done or waiting for an answer. The tab turns yellow ' +
    'in any case, and so does the counter on the project tab — only what happens outside the window ' +
    'is configured here.',

  'terminal.unlimited': 'Keep the whole history',
  'terminal.lines': 'Lines kept per tab',
  'terminal.hint':
    'A change reaches the open tabs at once, no restart needed. Lowering the limit drops the lines ' +
    'above it there and then; raising it applies from that moment on — what has already scrolled ' +
    'past the old limit is gone.',
  'terminal.memory':
    'The history is kept in memory, in two copies: the tab you are looking at, and the copy that ' +
    'repaints it when you come back from another session. Nothing goes to disk, and nothing is ' +
    'freed until the tab is closed or the application quits — so with the whole history kept, a ' +
    'tab that prints for hours holds all of it, whether or not anyone is watching that tab. ' +
    '“Clear the history” in a tab’s menu empties both copies.',

  'editor.autoSave': 'Save changes automatically',
  'editor.delay': 'Pause after the last keystroke, ms',
  'editor.hint':
    'With autosave the file is written after a pause in typing and when the editor tab is closed — ' +
    'the edits are immediately visible to the agent and in the changes panel. Ctrl+S always works, ' +
    'whatever this setting says.',

  'commit.generator': 'What generates the message',
  'commit.viaService': 'Haiku service session (warmed up)',
  'commit.viaTab': 'An open agent tab (/btw)',
  'commit.other': 'another command…',
  'commit.timeout': 'Timeout, ms',
  'commit.warmOnStart': 'Warm the session up at application start',
  'commit.serviceHint.before': 'The application keeps one warmed-up ',
  'commit.serviceHint.after':
    ' process for all the projects and sends a summary of the changes into it. There is no cold start ' +
    '— it is paid once, at the first request. After 15 minutes of idling the process closes so as not ' +
    'to hold memory, and comes back up at the next request. The profile and the command are taken ' +
    'from the first Claude agent in the list.',
  'commit.tabHint.before': 'The question goes to the active agent tab as the ',
  'commit.tabHint.after':
    ' command — it does not interrupt its work. The agent sees neither the diff nor the files in this ' +
    'mode, so the application puts the summary of the changes right into the text of the question ' +
    '(with a length limit) and fishes the answer out of the terminal stream by service markers. There ' +
    'is no cold start, which makes this the fastest option, but the tab has to be running and free — ' +
    'if the agent is busy with a turn of its own, generation is refused.',
  'commit.command': 'Command',
  'commit.serviceArgs': 'Service session arguments',
  'commit.nonInteractiveArgs': 'Non-interactive mode arguments',
  'commit.prompt': 'Prompt',
  'commit.resetPrompt': 'Restore the default prompt',
  'commit.note.tab': 'the prompt goes into /btw together with the list of files',
  'commit.note': 'the diff goes to stdin, the prompt is the last argument',
  'commit.customHint.a':
    'The command and the environment variables are taken from the chosen agent, so the profile (say ',
  'commit.customHint.b': ') does not have to be repeated. The placeholder ',
  'commit.customHint.c': ' in the arguments means the file the tool writes its answer into — that is how ',
  'commit.customHint.d':
    ' works, whose stdout is taken by a service log. Measured on one and the same diff: codex ≈ 3 s, ' +
    'Claude Haiku ≈ 8–9 s.',

  'language.label': 'Interface language',
  'language.hint':
    'This page switches at once, the rest of the window when the settings are saved. The names of ' +
    'git operations (push, pull, merge, rebase and the rest) stay English in every language: they ' +
    'are the names of commands, not descriptions of actions.',

  'exit.title': 'Close the settings without saving?',
  'exit.body': 'The changes on this page have not been applied.',
  'exit.back': 'Go back',
  'exit.discard': 'Close without saving',
  'exit.saveClose': 'Save and close',
  'theme.label': 'Colour theme',
  'theme.system': 'Follow the system',
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'theme.hint':
    'Following the system means the window changes with it, including a schedule that flips it during the day. The theme is applied when the settings are saved.',
} as const

export type SettingsArea = AreaOf<typeof settings>
