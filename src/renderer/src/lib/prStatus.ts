import type { BranchPrs, PrInfo } from '../../../shared/types'

/**
 * The PR and CI status of the visible project's session branches. It is read on events the app
 * already has — a turn end, a push or any other write (`changesInvalidated`), a PR opened from
 * the app (`prStatusInvalidated`), window focus, a session switch — and on a timer only while
 * some check is still running. Main decides which of those reach GitHub (`main/gh.ts`).
 */

/** while checks run, how often the visible project re-asks; main still holds each branch for 20 s */
export const PR_PENDING_POLL_MS = 30_000

type Listener = (cwd: string) => void
const listeners = new Set<Listener>()

/** the app opened a PR from `cwd`: its answer has moved even though the upstream did not */
export function prStatusInvalidated(cwd: string): void {
  for (const listener of [...listeners]) listener(cwd)
}

export function onPrStatusInvalidated(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** checks still running on a PR that can still change */
export function prPending(pr: PrInfo | null | undefined): boolean {
  return !!pr && (pr.state === 'open' || pr.state === 'draft') && (pr.checks?.pending ?? 0) > 0
}

/** the directories worth re-asking on the slow timer */
export function pendingCwds(prs: BranchPrs): string[] {
  return Object.keys(prs).filter((cwd) => prPending(prs[cwd]))
}

/**
 * Fold an answer for `asked` into what is shown. An asked directory missing from the answer has
 * nothing to show any more (no upstream, gh unavailable) and is dropped. Unchanged → the same
 * object, so nothing re-renders.
 */
export function mergePrs(prev: BranchPrs, asked: readonly string[], answer: BranchPrs): BranchPrs {
  const next: BranchPrs = { ...prev }
  for (const cwd of asked) {
    const pr = answer[cwd]
    if (pr === undefined) delete next[cwd]
    else next[cwd] = pr
  }
  return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
}

/** one word for the checks as a whole: any failure wins, then anything running */
export type ChecksRollup = 'pass' | 'fail' | 'pending' | 'none'

export function checksRollup(pr: PrInfo): ChecksRollup {
  const c = pr.checks
  if (!c) return 'none'
  if (c.fail) return 'fail'
  if (c.pending) return 'pending'
  return c.pass ? 'pass' : 'none'
}

/** the mark of a rollup; the colour comes from the stylesheet, the word from the tooltip */
export const ROLLUP_MARK: Record<ChecksRollup, string> = { pass: '✓', fail: '✗', pending: '●', none: '' }
