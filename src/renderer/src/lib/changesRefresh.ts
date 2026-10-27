import type { SessionSource, TerminalKind } from '../../../shared/types'

/**
 * When the changes panel and an open diff tab re-read git. They used to poll — every 4 s and
 * every 5 s, for as long as the window was open — while almost everything that changes a working
 * tree is an event the app already sees: an agent's turn ends, the window comes back, the app
 * writes a file itself. Those three refresh at once; the poll is what is left for the tabs that
 * cannot say when they are done.
 */

type Listener = (path: string) => void
const listeners = new Set<Listener>()

/**
 * Files under `path` may have changed: every panel and diff tab whose directory overlaps it
 * re-reads now. `path` is a file or a directory. Called by the app's own writers (a commit, a
 * revert, a save, a resolved merge) and by the poll that hears a claude turn end.
 */
export function changesInvalidated(path: string): void {
  for (const listener of [...listeners]) listener(path)
}

/** listen for `changesInvalidated`; returns the unsubscribe */
export function onChangesInvalidated(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const trim = (p: string): string => p.replace(/[\\/]+$/, '')

/** `inner` is `outer` or lies under it */
function within(inner: string, outer: string): boolean {
  return inner === outer || inner.startsWith(outer + '/') || inner.startsWith(outer + '\\')
}

/**
 * One path lies inside the other. Both ways on purpose: a file saved under the panel's directory
 * concerns it, and so does a commit in the project root while the panel shows a worktree that
 * lives inside that root — one refresh too many is the cheap mistake here.
 */
export function pathsOverlap(a: string, b: string): boolean {
  const x = trim(a)
  const y = trim(b)
  return within(x, y) || within(y, x)
}

/**
 * While an agent works, its edits land mid-turn: a poll this often shows them arriving without
 * re-running git every few seconds. The turn end refreshes at once anyway, so this only paces the
 * view of work in progress.
 */
export const WORKING_POLL_MS = 10_000

/**
 * A tab that is idle but can never say it was done — a codex tab, a plain shell, a claude whose
 * hooks are off. Someone may still type `git checkout` in it; half a minute is the lag accepted
 * for that, and window focus covers the usual case of coming back from another program.
 */
export const BLIND_POLL_MS = 30_000

/** one tab of the session, as far as refreshing is concerned */
export interface RefreshTab {
  kind: TerminalKind
  /** the agent's way of reporting; absent for anything that is not an agent */
  source?: SessionSource | undefined
  /** there is a live process; a sleeping tab changes nothing */
  awake: boolean
  /** a claude tab whose hooks never answered: its turn end will not be heard */
  silent: boolean
  /** running by the tab's own status (`lib/status`) */
  working: boolean
}

/**
 * How often to fall back on polling, or null for not at all.
 *
 * Editor, diff and merge tabs are the app's own writers and announce their saves; a sleeping tab
 * has no process. A claude tab with working hooks reports its turn end and is polled only while
 * it works. Everything else awake cannot report, and keeps the slow poll.
 */
export function fallbackPollMs(tabs: readonly RefreshTab[]): number | null {
  let ms: number | null = null
  const take = (n: number): void => {
    ms = ms === null ? n : Math.min(ms, n)
  }
  for (const tab of tabs) {
    if (!tab.awake || (tab.kind !== 'agent' && tab.kind !== 'shell')) continue
    if (tab.working) take(WORKING_POLL_MS)
    else if (tab.kind === 'shell' || tab.source !== 'uuid' || tab.silent) take(BLIND_POLL_MS)
  }
  return ms
}

/**
 * Two replies carry the same data. For git status and repository state — small, plain JSON — a
 * string comparison is exact and cheap, and keeping the previous object is what lets React skip
 * the re-render of an unchanged list.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}
