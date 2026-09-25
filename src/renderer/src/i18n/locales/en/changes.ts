import type { AreaOf } from '../../types'

/** the changes panel: the file list, staging, commit and its message */
export const changes = {
  // the panel itself: collapsing, refreshing, which directory is shown
  show: 'Show the changes',
  'refresh.aria': 'Refresh the list of changes',
  collapse: 'Collapse the panel',
  'collapse.aria': 'Collapse the changes panel',
  'scope.badge': 'The shared project folder is shown',
  'scope.back': 'Back to the session folder',
  /** goes inside the <code> of `empty.in`, so it is a noun phrase and not a sentence */
  'scope.project': 'the shared project folder',
  'scope.session': 'the session folder',

  // what has not been exchanged with the server yet
  'sync.unpushed': {
    one: '{count} commit not pushed to {upstream} — open the push window',
    other: '{count} commits not pushed to {upstream} — open the push window',
  },
  'sync.unpulled': {
    one: '{count} commit in {upstream} has not been pulled yet',
    other: '{count} commits in {upstream} have not been pulled yet',
  },
  'sync.upToDate': 'Matches upstream {upstream}',
  'sync.never':
    'The branch is not on the server yet: an upstream appears after the first push. Click — the push window.',
  'sync.neverShort': 'not pushed yet',

  // the file list
  'list.aria': 'Changed files',
  checkAll: 'Select all files',
  toCommit: 'To commit',
  reading: 'Reading the changes…',
  /** the sentence ends in a <code> that holds `scope.project` or `scope.session` */
  'empty.in': 'No changes in ',
  include: 'Include in the commit',
  'include.aria': 'Include «{path}» in the commit',
  resolve: 'Mark as resolved (git add)',
  'resolve.aria': 'Mark «{path}» as resolved',
  staged: 'In the index',

  /** how a file's status is read aloud: the letter in the row says nothing to a screen reader */
  'status.added': 'added',
  'status.modified': 'modified',
  'status.deleted': 'deleted',
  'status.renamed': 'renamed',
  'status.untracked': 'new, not in git',
  'status.conflict': 'conflict',

  // an unfinished rebase/merge/cherry-pick, settled from the panel
  /** the operations name themselves — this is the wording for the one git did not name */
  'op.other': 'Operation',
  'op.stopped': '{op} stopped',
  'op.conflict': ': conflict',
  'op.step': ' (step {step})',
  'op.openMerge': 'Open the merge editor',
  'op.takeOurs': 'Take our side whole',
  'op.takeTheirs': 'Take their side whole',
  'op.continue': 'Continue',
  'op.continue.title': 'Continue the interrupted operation',
  'op.continue.blocked': 'Resolve the conflicts in every file first',
  'op.skip': 'Skip the commit',
  'op.skip.title': 'Skip this commit and carry on',
  'op.abort': 'Abort',
  'op.abort.title': 'Put everything back the way it was before the operation started',
  /** what the status line says while the call is out; it also names the call in flight */
  'run.continue': 'Continuing',
  'run.skip': 'Skipping the commit',
  'run.abort': 'Aborting',
  'run.done': 'done',

  // the commit box
  'message.placeholder': 'Commit message',
  'message.pick': 'Tick the files for the commit',
  'message.none': 'No changes',
  commit: 'Commit',
  'commit.n': 'Commit ({n})',
  'commit.busy': 'Committing…',
  'commit.title': 'Commit the selected files (Ctrl+Enter)',
  'commit.done': 'Committed',

  // generating the commit message
  draft: 'Message',
  'draft.title': 'Generate a message with the agent chosen in the settings',
  'draft.settings': 'Set up the model and the prompt for generating the message',
  'draft.settings.aria': 'Set up commit message generation',
  'draft.askService': 'Asking the service session…',
  'draft.askTab': 'Asking the open tab…',
  'draft.generating': 'Generating a message ({agent})…',
  'draft.noTab': 'no agent tab is running — wake one up or choose a different generator in the settings',
  'draft.tabBusy':
    'the agent tab is busy right now — wait for its answer or choose a different generator in the settings',
  'draft.tabSilent': 'the agent tab did not answer in the time allowed',
  'draft.serviceSilent': 'the service session did not answer',
  'draft.failed': 'could not generate a message',
  /**
   * Not a label but the tail of the question put to the agent: it is prose in the user's
   * language and it decides the language the commit message comes back in. `{marker}` is the
   * fence the answer is fished out by, and is not language.
   */
  'draft.format': 'Answer in ONE line, in the form {marker}message{marker}, with no explanation. The changes: ',

  // reverting the selected files
  revert: 'Revert',
  'revert.title': 'Revert the selected files (git restore / clean)',
  'revert.run': 'Reverting the files',
  'revert.done': 'Files reverted: {count}',
  'revert.confirm': { one: 'Revert {count} file?', other: 'Revert {count} files?' },
  'revert.warn': 'The changes will be lost for good: tracked files go back to HEAD, untracked ones are deleted.',
  'revert.more': '…{count} more',

  // the push window
  'push.title': 'Push branch «{branch}»',
  'push.newBranch': 'a new branch on origin',
  'push.reading': 'Reading the commits…',
  'push.nothing': 'Nothing to send',
  'push.readingFiles': 'Reading the files…',
  'push.noFiles': 'A commit that changes no files',
  'push.toSend': 'commits to send: {count}',
  'push.willCreate': ' · the branch will be created on origin',
  'push.done': 'Sent',

  // the merge editor. «ours», «theirs» and «base» are git's own names for the sides of a
  // conflict and stay English in every locale — only what is said around them is translated
  'merge.side.ours': 'Ours',
  'merge.side.base': 'Base',
  'merge.side.theirs': 'Theirs',
  'merge.take': 'Take',
  'merge.keepBoth': 'Keep both',
  'merge.emptySide': '(empty)',
  'merge.reading': 'Reading the file…',
  'merge.conflicts': { zero: 'no conflicts left', one: '{count} conflict', other: '{count} conflicts' },
  'merge.openFailed': 'could not open the file',
  'merge.writeFailed': 'could not write the file',
  'merge.addFailed': 'git add did not go through',
  'merge.sideFailed': 'could not take the side',

  /** the same action in the conflict row of the panel and in the head of the merge editor */
  takeOurs: 'Take ours',
  takeTheirs: 'Take theirs',
} as const

export type ChangesArea = AreaOf<typeof changes>
