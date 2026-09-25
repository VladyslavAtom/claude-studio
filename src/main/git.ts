/**
 * The public surface of the git layer. The modules live in `src/main/git/`, while this file
 * stays the single import point: `import * as git from './git'` — the same as before the split.
 *
 * What is where:
 *   exec      — the one spawn, the buffers, `literal()` for pathspecs (invariants in its header)
 *   refs      — HEAD, the base, the upstream, the contents of a file at a revision
 *   status    — parsing of status and `--name-status`, the diff of a file, the summary
 *   commit    — committing the selected paths, reverting, reading history
 *   branches  — the branch list, creating, switching, merge/rebase onto a branch
 *   remote    — push, pull, updating from the base
 *   state     — unfinished operations, conflicts, the shared runner for merge-like commands
 *   worktree  — the working copies of sessions
 *   clone     — the address check and the clone itself
 *
 * Not git, and therefore moved out of the layer entirely: `createPullRequest` (the `gh` CLI)
 * lives in `./gh`, `draftCommitMessage` (an arbitrary agent CLI) in `./commitMessage`. They are
 * re-exported here so that callers need not care.
 */
export { git, type GitRunResult } from './git/exec'
export { currentBranch, defaultBranch, fileAtRef, hasUpstream, repoRoot, resolveBaseRef } from './git/refs'
/** mapStatusCode/parseNameStatus/renameSources parse git's output; exported for the tests */
export { diffSummary, fileDiff, mapStatusCode, parseNameStatus, renameSources, status } from './git/status'
export { commit, commitFiles, listCommits, revertFiles } from './git/commit'
export {
  checkout,
  createBranch,
  deleteBranch,
  listBranchInfo,
  mergeBranch,
  rebaseOnto,
  renameBranch,
} from './git/branches'
export { pull, push, syncWithBase } from './git/remote'
export { acceptSide, continueOperation, markResolved, repoState } from './git/state'
export { addWorktree, listWorktrees, removeWorktree } from './git/worktree'
export { clone } from './git/clone'
export { createPullRequest } from './gh'
export { draftCommitMessage } from './commitMessage'
export type { WorktreeAddOptions } from '../shared/types'
