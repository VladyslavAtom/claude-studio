import { useEffect, useMemo, useRef } from 'react'
import type { TerminalTab } from '../../../shared/types'
import { findAgent } from '../lib/agents'
import { fallbackPollMs, onChangesInvalidated, pathsOverlap } from '../lib/changesRefresh'
import { terminalStatus } from '../lib/status'
import { useAppState } from '../state/appStateContext'
import { useRuntimeState } from '../state/runtimeContext'

interface Options {
  /** the directory shown: invalidations that overlap it refresh, the rest are someone else's */
  cwd: string
  /** the session's tabs: what they are decides whether a fallback poll is needed at all */
  terminals: readonly TerminalTab[]
  /** off while the view is not on screen */
  enabled: boolean
  /** the re-read itself; it skips a hidden window on its own */
  refresh: () => Promise<void>
}

/**
 * Re-reads when something may have changed — `changesInvalidated` for an overlapping path (a
 * claude turn end, the app's own writes), the window gaining focus or coming back into view —
 * and polls only as `fallbackPollMs` says: while a tab of this session works or cannot report.
 * The first read is the caller's: it knows when its inputs changed.
 *
 * Triggers often arrive in bursts (focus and visibility together, autosave after autosave), so a
 * trigger during a read does not start a second one beside it: it asks for exactly one more
 * when the current one ends.
 */
export function useChangesRefresh({ cwd, terminals, enabled, refresh }: Options): void {
  const { awake, busyIds, agentActivity, silent } = useRuntimeState()
  const { settings } = useAppState()

  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

  const running = useRef(false)
  const again = useRef(false)
  // a ref, not a callback: the listeners below are armed once per directory, not per render
  const fire = useRef(async (): Promise<void> => {
    if (running.current) {
      again.current = true
      return
    }
    running.current = true
    try {
      await refreshRef.current()
    } finally {
      running.current = false
    }
    if (again.current) {
      again.current = false
      await fire.current()
    }
  })

  /**
   * A number, so the timer below is re-armed only when the answer changes — `busyIds` flips with
   * every burst of output, the interval must not.
   */
  const pollMs = useMemo(
    () =>
      fallbackPollMs(
        terminals.map((tab) => {
          const isAwake = awake.has(tab.id)
          return {
            kind: tab.kind,
            source: findAgent(settings, tab.agentId)?.sessionSource,
            awake: isAwake,
            silent: silent.has(tab.id),
            working:
              terminalStatus({
                awake: isAwake,
                attention: false,
                activity: agentActivity.get(tab.id) ?? null,
                busy: busyIds.has(tab.id),
              }) === 'running',
          }
        }),
      ),
    [terminals, settings, awake, silent, agentActivity, busyIds],
  )

  useEffect(() => {
    if (!enabled) return
    const run = (): void => void fire.current()
    const offInvalidated = onChangesInvalidated((path) => {
      if (pathsOverlap(path, cwd)) run()
    })
    const onVisible = (): void => {
      if (!document.hidden) run()
    }
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      offInvalidated()
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, cwd])

  useEffect(() => {
    if (!enabled || pollMs === null) return
    const timer = window.setInterval(() => void fire.current(), pollMs)
    return () => window.clearInterval(timer)
  }, [enabled, pollMs])
}
