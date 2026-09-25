import type { AreaOf } from '../../types'

/** dialogs that are not tied to one screen: new session, close session, clone, startup, history */
export const modals = {
  'agents.title': 'Agent conversations in {project}',
  'agents.hint':
    'Everything the agents wrote down for the directories of this project and its worktrees — runs from a plain terminal included. The marked ones are already open or lie in the history of the application.',
  'agents.filter': 'Filter by title or path',
  'agents.onlyNew': 'Only new ones',
  'agents.loading': 'Reading the stores of the agents…',
  'agents.none': 'Nothing found',
  /** where a conversation the app already tracks was met; the session it belongs to is named */
  'agents.mark.open': 'open: {name}',
  'agents.mark.history': 'in the history: {name}',
  'agents.mark.run': 'a run in “{name}”',
  'agents.store': 'Conversation store: {path}',
  'agents.open': 'Open',
  'agents.open.title': 'Open the conversation “{title}” in a tab',
  'agents.shown': '{shown} of {total}',

  'startup.title': 'Sessions restored: {n}',
  'startup.tabs': { one: 'They hold {count} agent tab.', other: 'They hold {count} agent tabs.' },
  'startup.hint':
    'Start them now or leave them asleep — then each one wakes at the first click and carries on its conversation.',
  'startup.remember': 'Remember the choice and stop asking',
  'startup.all': 'Start all of them',
  'startup.none': 'Leave them asleep',

  'closeSession.title': 'Close the session “{name}”',
  'closeSession.hint': 'The terminals of the session will be stopped.',
  /** the checkbox reads on into a <code> with the path, so the wording carries its own space */
  'closeSession.removeWorktree': 'Remove the worktree ',
  'closeSession.deleteBranch': 'Delete the branch ',
  'closeSession.warn': 'Uncommitted changes in the worktree will be lost.',
  'closeSession.warnBranch':
    'Uncommitted changes in the worktree will be lost, and with the branch its commits too, unless they are merged or pushed.',

  'newSession.title': 'New session',
  'newSession.name': 'Name',
  'newSession.firstTab': 'Run in the first tab',
  'newSession.task': 'A task for the agent (optional)',
  'newSession.task.placeholder': 'For example: move the JWT check over to HMAC and cover it with tests',
  'newSession.where': 'Where the agent works',
  'newSession.isolated': 'In an isolated copy (worktree)',
  /** the summary line reads through two <code> elements: every piece keeps the spaces it needs */
  'newSession.summary.branch': 'Branch ',
  'newSession.summary.from': ' from ',
  'newSession.summary.current': ' — the current one in the root',
  'newSession.summary.dir': 'Directory ',
  'newSession.configure': 'Configure…',
  'newSession.collapse': 'Collapse',
  'newSession.busyBranch': 'Branch “{branch}” is held by the worktree {path} — change the name of the branch.',
  'newSession.branch': 'Branch',
  'newSession.dir': 'Directory',
  'newSession.base': 'Start from',
  'newSession.base.current': 'the current one in the root — ',
  'newSession.base.unknown': 'branch not determined',
  'newSession.base.custom': 'another branch, tag or commit',
  'newSession.base.aria': 'Base for the new branch',
  'newSession.base.placeholder': 'branch, origin/branch, tag or commit hash',
  'newSession.base.list': 'Branches and tags',
  'newSession.inPlace': 'Right in the directory of the project',
  'newSession.inPlace.warn': 'The agent will change files in the working directory of the project: {path}',
  'newSession.notGit': 'The project is not a git repository — the session will open right in the project folder.',
  'newSession.create': 'Create',

  'clone.title': 'Clone a repository',
  'clone.busy': 'Cloning the repository…',
  'clone.url.placeholder': 'git@github.com:user/repo.git or https://github.com/user/repo',
  'clone.where': 'Where to',
  'clone.pick': 'Choose a directory',
  'clone.pick.title': 'Directory for the clone',
  'clone.name': 'Folder name',
  'clone.hint': 'Private repositories are cloned under your ssh key / gh credentials.',
  'clone.running': 'Cloning…',
  'clone.submit': 'Clone',
} as const

export type ModalsArea = AreaOf<typeof modals>
