/**
 * What a session's worktree tells the processes started in it: a block of ports of its own and
 * where it lives. Shared because both sides need the same numbers — the renderer puts them into
 * every tab it starts, main into the teardown script.
 *
 * Nothing here can force a port on a dev server: the block is an offer. A repository's own
 * scripts have to read `CLAUDE_STUDIO_PORT` (and the nine after it) for two sessions not to
 * fight over `:3000`.
 */
import type { WorktreeInfo } from './types'

/** the first port any worktree can get, and how many each one owns */
export const PORT_BASE = 50_000
export const PORT_BLOCK = 10
/** how many distinct blocks there are: 50000..59999 */
const PORT_SLOTS = 1000

/** FNV-1a over the UTF-16 code units: stable across runs and processes, no crypto needed */
function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * The first port of a worktree's block. Derived from the path alone, so it is the same every
 * time the session starts, with no record to keep; two worktrees share a block only when their
 * paths collide in 1000 slots, which the block cannot rule out and does not try to.
 */
export function worktreePort(worktreePath: string): number {
  return PORT_BASE + (fnv1a(worktreePath) % PORT_SLOTS) * PORT_BLOCK
}

/** the variables every process of a worktree session gets */
export function worktreeEnv(rootPath: string, worktree: Pick<WorktreeInfo, 'path' | 'branch'>): Record<string, string> {
  return {
    CLAUDE_STUDIO_PORT: String(worktreePort(worktree.path)),
    CLAUDE_STUDIO_PORT_COUNT: String(PORT_BLOCK),
    CLAUDE_STUDIO_WORKTREE: worktree.path,
    CLAUDE_STUDIO_ROOT: rootPath,
    CLAUDE_STUDIO_BRANCH: worktree.branch,
  }
}

/**
 * A tab's own env with the worktree's under it: an agent preset that sets one of these on
 * purpose wins. A session without a worktree gets nothing added, and `undefined` stays
 * `undefined` so the pty is not handed an empty object for nothing.
 */
export function withWorktreeEnv(
  env: Record<string, string> | undefined,
  rootPath: string,
  worktree: WorktreeInfo | undefined,
): Record<string, string> | undefined {
  if (!worktree) return env
  return { ...worktreeEnv(rootPath, worktree), ...(env ?? {}) }
}

/** a word for a POSIX shell; fish and zsh read the same single-quote form */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/**
 * The line typed into the setup tab's shell. `exec` makes the script the tab's process, so the
 * script's exit code is the tab's exit code — the pane prints it, and a non-zero one is what
 * makes a failed setup visible instead of a shell prompt that looks like success. `sh -c`, not
 * the person's shell: the script is the repository's, written for every machine that runs it.
 */
export function setupCommandLine(script: string): string {
  return `exec sh -c ${shellQuote(script)}`
}
