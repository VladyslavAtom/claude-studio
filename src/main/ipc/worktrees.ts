import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/channels'
import type { SessionTranscripts, WorktreeRemoveRequest } from '../../shared/types'
import { listProjectWorktrees, removeProjectWorktree, worktreeStatuses } from '../worktrees'

const CH = CHANNELS.worktrees

/** the worktrees of a project: discovery, attribution to sessions, status, removal (main/worktrees.ts) */
export function register(): void {
  ipcMain.handle(CH.list, (_e, projectPath: string, sessions: SessionTranscripts[]) =>
    listProjectWorktrees(projectPath, sessions),
  )
  ipcMain.handle(CH.status, (_e, items: { repo: string; path: string }[], hints: string[]) =>
    worktreeStatuses(items, hints),
  )
  ipcMain.handle(CH.remove, (_e, req: WorktreeRemoveRequest, hints: string[]) => removeProjectWorktree(req, hints))
}
