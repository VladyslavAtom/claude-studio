import type { AreaOf } from '../../types'

/**
 * Everything git: both branch menus, the pull/push/merge/rebase dialogs, their errors.
 *
 * The names of the operations stay English in every locale — push, pull, fetch, merge, rebase,
 * cherry-pick, commit, stash, upstream, remote, HEAD, worktree, PR. A gloss in the language of
 * the locale may stand next to them, in brackets. And an item that does the same thing in the
 * project menu and in the session branch menu is one key, not two.
 *
 * Hence the shape of the first group: `pull`, `push`, `createPr`, `mergeInto`, `rebaseOnto` and
 * `rename` are written once and read by both menus, in that order. What a pull updates — the
 * project or the branch — is a value (`what.project`, `what.branch`), not a second wording: the
 * operation is the same one and must not acquire two names.
 *
 * The `error.*`, `note.*` and `warning.*` keys are the other half. The main process no longer
 * writes sentences: it answers with a code out of `AppMessageCode` plus the values the wording
 * needs, and these keys are where those codes become words. `appMessage()` in
 * `ui/useGitAction.ts` is the mapping, and the only place that knows which code takes which key.
 */
export const git = {
  // --- the actions, shared by the project menu and the session branch menu ---
  pull: 'Pull — update {what}',
  'what.project': 'the project',
  'what.branch': 'the branch',
  'pull.hint.ask': 'will ask how',
  push: 'Push the current branch',
  'push.hint.detached': 'HEAD detached',
  'push.detachedHead': 'HEAD is detached from every branch — switch to a branch or create one',
  createPr: 'Create a pull request',
  mergeInto: 'Merge “{branch}” into the current one',
  rebaseOnto: 'Rebase the current branch onto “{branch}”',
  'rebase.hint.upToDate': 'up to date',
  rename: 'Rename…',

  // --- the session branch menu: the button, its tooltip, and what only it has ---
  branchLabel: 'Branch {branch}',
  'branchMenu.aria': 'Branch {branch} — actions',
  'title.base': {
    one: 'Forked from {ref} · {count} new commit there that is not here',
    other: 'Forked from {ref} · {count} new commits there that are not here',
  },
  'title.baseCurrent': 'Forked from {ref} · the base has not moved on',
  'title.folder': 'Folder: {path}',
  'scope.showProject': 'Show the shared project folder',
  'scope.showSession': 'Back to the session folder',

  // --- the project menu: the branch list and its search ---
  'menu.title': 'Git: {project}',
  'menu.aria': 'Git: {project}, branch {branch}',
  search: 'Search branches and actions',
  'newBranch.named': 'New branch “{name}”',
  'newBranch.prompt': 'New branch…',
  'newBranch.hint': 'from the current one',
  'newBranch.needName': 'type the name of the new branch into the search field',
  'caption.recent': 'Recent',
  'caption.all': 'All branches',
  noBranches: 'No branches found',
  branchActions: 'Branch actions',
  'branchActions.aria': 'Actions for branch {branch}',
  checkout: 'Switch to “{branch}”',
  'checkout.current': '“{branch}” is the current branch',
  newWorktreeSession: 'New session in a worktree from “{branch}”',
  newBranchFrom: 'New branch from “{branch}”',
  deleteBranch: 'Delete the branch',
  'delete.title': 'Delete branch “{branch}”?',
  'delete.hint': 'There is no ordinary way to undo this.',
  'delete.unmerged':
    'The ordinary delete was refused: “{branch}” holds commits the current branch does not have. ' +
    'A forced delete (git branch -D) loses them for good.',
  'delete.confirm': 'Delete',
  'delete.force': 'Delete by force',

  // --- the choice of pull strategy, shared by both menus (PullChoiceModal) ---
  'pullChoice.title': 'How should other people’s commits come into {what}?',
  'pullChoice.what.project': 'the project “{name}”',
  'pullChoice.what.branch': 'the branch “{branch}”',
  'pullChoice.rebase': 'Rebase — put my commits on top',
  'pullChoice.rebase.hint':
    'The history stays linear and no merge commit appears. My commits get new identifiers — if ' +
    'the branch has already been pushed, the next push will have to be forced.',
  'pullChoice.merge': 'Merge — a merge commit',
  'pullChoice.merge.hint':
    'Nothing is rewritten, the history is kept as it is. A separate merge commit appears in the log.',
  'pullChoice.remember': 'Remember the choice — it can be changed in the settings later',

  // --- the rename dialog, shared by both menus (RenameBranchModal) ---
  'rename.title': 'Rename branch “{branch}”',
  'rename.newName': 'New name',
  'rename.submit': 'Rename',

  // --- what the status line says while an action runs and when it ends ---
  'run.progress': '{label}…',
  'run.done': '{label}: done',
  'run.failed': '{label}: did not work',
  'run.crashed': '{label}: {error}',
  'run.pull': 'Pull',
  'run.pullFrom': 'Pull from “{ref}”',
  'run.createPr': 'Creating a pull request',
  'run.mergeBase': 'Merge of the base',
  'run.rebaseBase': 'Rebase onto the base',
  'run.rename': 'Rename',
  'run.checkout': 'Switching to {branch}',
  'run.branchFrom': 'Branch from {branch}',
  'run.merge': 'Merge {branch}',
  'run.rebase': 'Rebase onto {branch}',
  'run.createBranch': 'Creating {name}',
  'run.deleteBranch': 'Deleting branch “{branch}”',
  'run.branchDeleted': 'Branch “{branch}” deleted',

  // --- the codes the main process answers with: the spawn itself ---
  'error.outputTooLarge':
    'the output of “{command}” went past {limitMb} MB — select fewer files, or open the diff one file at a time',
  'error.timeout': '“{command}” did not answer within {seconds} s and was stopped',
  'error.notFound': '“{command}” not found: check that git is installed and visible in PATH',
  'error.spawnFailed': '“{command}” did not start ({reason})',

  // --- committing, reverting, resolving ---
  'error.noFilesSelected': 'no files are selected',
  'error.commitEmptyMessage': 'the commit message is empty',
  'error.commitAlreadyCommitted':
    'nothing to commit: none of the selected files differ from the last commit — they have already been committed, and the list is about to catch up',
  'error.commitNothingToCommit': 'nothing to commit: the working tree is clean',
  'note.commitSkipped': {
    one: ' · {count} already-committed file skipped',
    other: ' · {count} already-committed files skipped',
  },

  // --- an unfinished operation: a stop on a conflict is a normal outcome, not a failure ---
  'error.noOperationInProgress': 'nothing is in progress',
  'note.conflict.merge': {
    one: 'Merge stopped on a conflict in {count} file — resolve it in the changes panel',
    other: 'Merge stopped on a conflict in {count} files — resolve them in the changes panel',
  },
  'note.conflict.mergeRef': {
    one: 'Merge of “{ref}” stopped on a conflict in {count} file — resolve it in the changes panel',
    other: 'Merge of “{ref}” stopped on a conflict in {count} files — resolve them in the changes panel',
  },
  'note.conflict.rebase': {
    one: 'Rebase stopped on a conflict in {count} file — resolve it in the changes panel',
    other: 'Rebase stopped on a conflict in {count} files — resolve them in the changes panel',
  },
  'note.conflict.rebaseRef': {
    one: 'Rebase onto “{ref}” stopped on a conflict in {count} file — resolve it in the changes panel',
    other: 'Rebase onto “{ref}” stopped on a conflict in {count} files — resolve them in the changes panel',
  },
  'note.conflict.pull': {
    one: 'Pull stopped on a conflict in {count} file — resolve it in the changes panel',
    other: 'Pull stopped on a conflict in {count} files — resolve them in the changes panel',
  },
  'note.conflict.pullRef': {
    one: 'Pull from “{ref}” stopped on a conflict in {count} file — resolve it in the changes panel',
    other: 'Pull from “{ref}” stopped on a conflict in {count} files — resolve them in the changes panel',
  },

  // --- branches and worktrees ---
  'error.branchUsedByWorktree':
    'branch “{branch}” is held by the worktree {path} — remove it first, or switch the branch there',
  'error.worktreeBranchBusy':
    'branch “{branch}” is already held by another worktree — pick another branch name, or close that session',
  'error.worktreeRemoveFailed.both':
    'the worktree could not be removed (its record stayed in the repository, the directory stayed on disk)',
  'error.worktreeRemoveFailed.record': 'the worktree could not be removed (its record stayed in the repository)',
  'error.worktreeRemoveFailed.dir': 'the worktree could not be removed (the directory stayed on disk)',
  'warning.worktreeRemovedBranchKept': 'the worktree is gone, but its branch stayed',

  // --- the server ---
  'error.noUpstream': 'the branch has no upstream — push first, that is what creates it on the server',
  'error.prCreateNoUrl': 'gh pr create failed',

  // --- the clone address ---
  'error.cloneUrlEmpty': 'enter the address of the repository',
  'error.cloneUrlLeadingDash': 'the address of a repository cannot begin with «-»',
  'error.cloneUrlHelper': 'this address is not supported: give https://…, ssh://…, git@host:path or a path on disk',
  'error.cloneUrlScheme': 'the «{scheme}» protocol is not supported: use https, http, ssh or git',
  'error.cloneUrlUnrecognised':
    'the address makes no sense: give https://…, ssh://…, git@host:path or an absolute path on disk',

  // --- reading and writing files ---
  'error.pathOutsideRoots': 'the path lies outside the allowed directories',
  'error.fileTooLarge': 'the file is bigger than {limitMb} MB ({sizeKb} KB)',
  'error.fileBinary': 'a binary file',

  // --- the draft commit message ---
  'error.draftNoChanges': 'nothing to describe: the selected files are the same as in HEAD',
  'error.draftNoChangesRef': 'nothing to describe: the selected files are the same as in HEAD and {ref}',
  'error.draftEmptyAnswer': 'an empty answer',
  'error.serviceNoAnswer': 'the service session gave no answer',

  /** an app-authored sentence with the tool's own text behind it */
  'error.withDetail': '{message}: {detail}',
} as const

export type GitArea = AreaOf<typeof git>
