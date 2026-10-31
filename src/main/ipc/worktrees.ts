import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/channels'
import type { SessionTranscripts, WorktreeRemoveRequest } from '../../shared/types'
import { listProjectWorktrees, removeProjectWorktree, worktreeStatuses } from '../worktrees'

const CH = CHANNELS.worktrees

/** a read that took long is logged: it runs on every turn end, so it is the first suspect of a slow window */
async function timed<T>(what: string, work: Promise<T>): Promise<T> {
  const started = Date.now()
  try {
    return await work
  } finally {
    const ms = Date.now() - started
    if (ms >= 1000) console.error(`[worktrees] ${what} took ${ms} ms at ${new Date().toString()}`)
  }
}

/** the worktrees of a project: discovery, attribution to sessions, status, removal (main/worktrees.ts) */
export function register(): void {
  ipcMain.handle(CH.list, (_e, projectPath: string, sessions: SessionTranscripts[]) =>
    timed(`list ${projectPath}`, listProjectWorktrees(projectPath, sessions)),
  )
  ipcMain.handle(CH.status, (_e, items: { repo: string; path: string }[], hints: string[]) =>
    timed(`status of ${items.length}`, worktreeStatuses(items, hints)),
  )
  ipcMain.handle(CH.remove, (_e, req: WorktreeRemoveRequest, hints: string[]) => removeProjectWorktree(req, hints))
}
