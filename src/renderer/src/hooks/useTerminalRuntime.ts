import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentActivity, Project, Session } from '../../../shared/types'
import { useT } from '../i18n'
import { notifyAttention } from '../lib/notify'
import { dropSnapshots, putSnapshot } from '../lib/snapshots'
import { useLoaded, useAppState } from '../state/appStateContext'
import { useAppStateRef } from '../state/selectors'
import { useWaitingPoll } from './useWaitingPoll'

export interface TerminalRuntimeState {
  /** terminal ids with a live pty; everything else is asleep */
  awake: Set<string>
  /** terminals that rang the bell and have not been looked at since */
  attention: Set<string>
  /** terminals with output in the last few seconds */
  busyIds: Set<string>
  /**
   * What each claude tab's own CLI says it is doing, for the tabs anything answers for. This is
   * the state the dot is drawn from where it exists; `busyIds` is what is left for a shell tab and
   * for a claude session that writes no state file. See `lib/status`.
   */
  agentActivity: Map<string, AgentActivity>
  /**
   * Terminals whose CLI reports nothing, so nothing will ever ring for them. There is no second
   * way to find out any more (see `useWaitingPoll`), and a bell that has quietly stopped working
   * is worse than one that says it is broken.
   */
  silent: Set<string>
  /**
   * The last screen of a tab, as xterm's own escapes — what a sleeping tab shows instead of a
   * card. Keyed by terminal id; see `lib/snapshots` for why it is kept here and not on disk.
   */
  snapshots: Map<string, string>
}

export interface TerminalRuntimeActions {
  wake: (terminalId: string) => void
  /** a pane, on its way out, hands over what was on its screen */
  rememberSnapshot: (terminalId: string, text: string) => void
  markActivity: (terminalId: string) => void
  markSeen: (terminalId: string) => void
  /**
   * Per-terminal bookkeeping lives outside the state, so nothing prunes it when tabs go away.
   * Every path that kills ptys goes through here; the title trackers stop on their own, because
   * their effect no longer sees the tab.
   */
  forgetTerminals: (ids: string[]) => void
  /** a CLI may say nothing to the terminal — then it is the conversation record that calls */
  onBell: (project: Project, session: Session, terminalId: string) => void
}

/** how many closed tab ids are remembered — enough to outlive the unmount of the panes we close */
const FORGOTTEN_KEEP = 64

function withoutId(set: Set<string>, id: string): Set<string> {
  if (!set.has(id)) return set
  const next = new Set(set)
  next.delete(id)
  return next
}

/** the same identity rule as the sets above: an unchanged map has to come back as itself */
function forgetActivity(map: Map<string, AgentActivity>, ids: string[]): Map<string, AgentActivity> {
  if (!ids.some((id) => map.has(id))) return map
  const next = new Map(map)
  for (const id of ids) next.delete(id)
  return next
}

export function useTerminalRuntime(): { state: TerminalRuntimeState; actions: TerminalRuntimeActions } {
  const t = useT()
  const stateRef = useAppStateRef()
  const loaded = useLoaded()
  const settings = useAppState().settings
  const sleep = settings.sleep
  const scrollbackLines = settings.terminal.scrollbackLines
  const [awake, setAwake] = useState<Set<string>>(new Set())
  const [attention, setAttention] = useState<Set<string>>(new Set())
  /**
   * The poll reads this instead of taking `attention` as an option: an option would put it in the
   * effect's dependencies, and the 4-second interval would be torn down and re-armed every time
   * a tab started or stopped calling.
   */
  const attentionRef = useRef<Set<string>>(attention)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [agentActivity, setAgentActivity] = useState<Map<string, AgentActivity>>(new Map())
  const [silent, setSilent] = useState<Set<string>>(new Set())
  const [snapshots, setSnapshots] = useState<Map<string, string>>(new Map())
  const activityAt = useRef<Map<string, number>>(new Map())
  /**
   * Tabs that are gone. A pane serialises its last screen from its cleanup, and that cleanup runs
   * after `forgetTerminals` has already been told the tab is closed — so without this the store
   * would keep collecting screens nobody can ever look at again. Ids are never reused and the
   * record only has to outlive the unmount that follows, so a short tail of them is enough.
   */
  const forgotten = useRef<string[]>([])

  // idle-sleep policy lives in main; push it whenever the setting changes
  useEffect(() => {
    if (!loaded) return
    void window.api.pty.sleepPolicy(sleep.enabled, sleep.minutes)
  }, [loaded, sleep.enabled, sleep.minutes])

  /**
   * How much scrollback main keeps for replay. The panes hold the other half of the same setting
   * (their own xterm instances) and take it as a prop; this half is one number for every pty, so
   * it is pushed from here rather than from a pane — a background tab has no pane to push it.
   */
  useEffect(() => {
    if (!loaded) return
    void window.api.pty.scrollbackLimit(scrollbackLines)
  }, [loaded, scrollbackLines])

  useEffect(() => {
    return window.api.pty.onSlept(({ id }) => setAwake((prev) => withoutId(prev, id)))
  }, [])

  // an idle terminal stops counting as running a few seconds after its last output
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now()
      setBusyIds((prev) => {
        const next = new Set([...prev].filter((id) => now - (activityAt.current.get(id) ?? 0) < 6000))
        return next.size === prev.size ? prev : next
      })
    }, 4000)
    return () => window.clearInterval(t)
  }, [])

  const wake = useCallback((terminalId: string) => {
    // The frozen screen goes in the same update that raises the live pane. Later would leave the
    // running terminal covered by its own ghost; earlier would blank the pane while `wakeTerminal`
    // is still asking the agent's store whether the conversation exists.
    setSnapshots((prev) => dropSnapshots(prev, [terminalId]))
    // whatever the previous process said about itself died with it: the tab starts with no state
    // of its own and gets one on the first pass of the poll, if anything answers for it at all
    setAgentActivity((prev) => forgetActivity(prev, [terminalId]))
    setAwake((prev) => (prev.has(terminalId) ? prev : new Set(prev).add(terminalId)))
  }, [])

  const rememberSnapshot = useCallback((terminalId: string, text: string) => {
    if (forgotten.current.includes(terminalId)) return
    setSnapshots((prev) => putSnapshot(prev, terminalId, text))
  }, [])

  const markActivity = useCallback((terminalId: string) => {
    activityAt.current.set(terminalId, Date.now())
    setBusyIds((prev) => (prev.has(terminalId) ? prev : new Set(prev).add(terminalId)))
  }, [])

  const markSeen = useCallback((terminalId: string) => {
    setAttention((prev) => withoutId(prev, terminalId))
  }, [])

  // called on every pass of the poll, for every live tab: an unchanged set has to come back as
  // the same object, or each pass would re-render every tab strip in the window
  const markSilent = useCallback((terminalId: string, silentNow: boolean) => {
    setSilent((prev) => {
      if (prev.has(terminalId) === silentNow) return prev
      if (!silentNow) return withoutId(prev, terminalId)
      return new Set(prev).add(terminalId)
    })
  }, [])

  // as with `markSilent`: called for every live claude tab on every pass, so an answer that has
  // not changed must leave the map alone — a new Map here would re-render every tab strip
  const markAgentActivity = useCallback((terminalId: string, activity: AgentActivity | null) => {
    setAgentActivity((prev) => {
      if (!activity) return forgetActivity(prev, [terminalId])
      if (prev.get(terminalId) === activity) return prev
      return new Map(prev).set(terminalId, activity)
    })
  }, [])

  const forgetTerminals = useCallback((ids: string[]) => {
    if (!ids.length) return
    const gone = new Set(ids)
    const drop = (prev: Set<string>): Set<string> => {
      if (!ids.some((id) => prev.has(id))) return prev
      const next = new Set(prev)
      gone.forEach((id) => next.delete(id))
      return next
    }
    setAwake(drop)
    setAttention(drop)
    setBusyIds(drop)
    setSilent(drop)
    setAgentActivity((prev) => forgetActivity(prev, ids))
    setSnapshots((prev) => dropSnapshots(prev, ids))
    gone.forEach((id) => activityAt.current.delete(id))
    forgotten.current = [...forgotten.current, ...ids].slice(-FORGOTTEN_KEEP)
  }, [])

  const onBell = useCallback(
    (project: Project, session: Session, terminalId: string) => {
      const { activeProjectId, settings } = stateRef.current
      const terminal = session.terminals.find((t) => t.id === terminalId)
      const isActiveTab =
        activeProjectId === project.id &&
        project.activeSessionId === session.id &&
        session.activeTerminalId === terminalId
      setAttention((prev) => new Set(prev).add(terminalId))
      void notifyAttention(settings.notifications, {
        title: `${terminal?.title ?? t('terminal.notify.fallbackTitle')} · ${session.name}`,
        body: t('terminal.notify.waiting', { project: project.name }),
        tabActive: isActiveTab,
      })
    },
    [stateRef, t],
  )

  useEffect(() => {
    attentionRef.current = attention
  }, [attention])

  useWaitingPoll({ awake, attentionRef, onBell, onSilent: markSilent, onActivity: markAgentActivity })

  const state = useMemo<TerminalRuntimeState>(
    () => ({ awake, attention, busyIds, agentActivity, silent, snapshots }),
    [awake, attention, busyIds, agentActivity, silent, snapshots],
  )
  const actions = useMemo<TerminalRuntimeActions>(
    () => ({ wake, rememberSnapshot, markActivity, markSeen, forgetTerminals, onBell }),
    [wake, rememberSnapshot, markActivity, markSeen, forgetTerminals, onBell],
  )
  return { state, actions }
}
