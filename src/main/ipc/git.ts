import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/channels'
import type { CommitDraftConfig, DiffMode, RepoState, WorktreeAddOptions } from '../../shared/types'
import * as git from '../git'
import { cloneRepo, createWorktree } from '../projectRoots'

const CH = CHANNELS.git

/** the git handlers: one call each, the whole of the logic lives in the modules under `main/git`. */
export function register(): void {
  ipcMain.handle(CH.repoRoot, (_e, dir: string) => git.repoRoot(dir))
  ipcMain.handle(CH.defaultBranch, (_e, dir: string) => git.defaultBranch(dir))
  ipcMain.handle(CH.currentBranch, (_e, dir: string) => git.currentBranch(dir))
  ipcMain.handle(CH.status, (_e, cwd: string, mode: DiffMode, baseRef?: string) => git.status(cwd, mode, baseRef))
  ipcMain.handle(
    CH.fileDiff,
    (_e, cwd: string, file: string, mode: DiffMode, baseRef: string | undefined, untracked: boolean) =>
      git.fileDiff(cwd, file, mode, baseRef, untracked),
  )
  ipcMain.handle(CH.commit, (_e, cwd: string, files: string[], message: string) => git.commit(cwd, files, message))
  ipcMain.handle(CH.draftCommitMessage, (_e, cwd: string, files: string[], cfg: CommitDraftConfig, ref?: string) =>
    git.draftCommitMessage(cwd, files, cfg, ref),
  )
  ipcMain.handle(CH.diffSummary, (_e, cwd: string, files: string[], ref?: string) => git.diffSummary(cwd, files, ref))
  ipcMain.handle(CH.revertFiles, (_e, cwd: string, files: string[]) => git.revertFiles(cwd, files))
  ipcMain.handle(CH.push, (_e, cwd: string, branch: string, setUpstream: boolean) => git.push(cwd, branch, setUpstream))
  ipcMain.handle(CH.hasUpstream, (_e, cwd: string) => git.hasUpstream(cwd))
  ipcMain.handle(CH.syncWithBase, (_e, cwd: string, baseRef: string, mode: 'rebase' | 'merge') =>
    git.syncWithBase(cwd, baseRef, mode),
  )
  ipcMain.handle(CH.createPullRequest, (_e, cwd: string, title: string, body: string, baseRef: string) =>
    git.createPullRequest(cwd, title, body, baseRef),
  )
  ipcMain.handle(CH.acceptSide, (_e, cwd: string, file: string, side: 'ours' | 'theirs') =>
    git.acceptSide(cwd, file, side),
  )
  ipcMain.handle(CH.markResolved, (_e, cwd: string, files: string[]) => git.markResolved(cwd, files))
  ipcMain.handle(CH.repoState, (_e, cwd: string) => git.repoState(cwd))
  ipcMain.handle(
    CH.continueOperation,
    (_e, cwd: string, op: RepoState['operation'], action: 'continue' | 'skip' | 'abort') =>
      git.continueOperation(cwd, op, action),
  )
  ipcMain.handle(CH.branchInfo, (_e, cwd: string) => git.listBranchInfo(cwd))
  ipcMain.handle(CH.fileAtRef, (_e, cwd: string, ref: string, path: string) => git.fileAtRef(cwd, ref, path))
  ipcMain.handle(CH.listCommits, (_e, cwd: string, range: string) => git.listCommits(cwd, range))
  ipcMain.handle(CH.commitFiles, (_e, cwd: string, hash: string) => git.commitFiles(cwd, hash))
  ipcMain.handle(CH.pull, (_e, cwd: string, strategy: 'merge' | 'rebase') => git.pull(cwd, strategy))
  ipcMain.handle(CH.merge, (_e, cwd: string, branch: string) => git.mergeBranch(cwd, branch))
  ipcMain.handle(CH.rebaseOnto, (_e, cwd: string, branch: string) => git.rebaseOnto(cwd, branch))
  ipcMain.handle(CH.renameBranch, (_e, cwd: string, from: string, to: string) => git.renameBranch(cwd, from, to))
  ipcMain.handle(CH.deleteBranch, (_e, cwd: string, branch: string, force: boolean) =>
    git.deleteBranch(cwd, branch, force),
  )
  ipcMain.handle(CH.checkout, (_e, cwd: string, branch: string) => git.checkout(cwd, branch))
  ipcMain.handle(CH.createBranch, (_e, cwd: string, branch: string, baseRef?: string) =>
    git.createBranch(cwd, branch, baseRef),
  )
  ipcMain.handle(CH.worktreeAdd, (_e, opts: WorktreeAddOptions) => createWorktree(opts))
  ipcMain.handle(CH.worktreeRemove, (_e, repoPath: string, worktreePath: string, branch?: string) =>
    git.removeWorktree(repoPath, worktreePath, branch),
  )
  ipcMain.handle(CH.worktrees, (_e, repoPath: string) => git.listWorktrees(repoPath))
  ipcMain.handle(CH.clone, (_e, url: string, parentDir: string, name?: string) => cloneRepo(url, parentDir, name))
}
