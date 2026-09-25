import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { TerminalTab } from '../../../shared/types'
import { findAgent } from '../lib/agents'
import { useAppState, useDispatch } from '../state/appStateContext'
import { useAppStateRef, useSettingsRef } from '../state/selectors'

/** a live agent tab whose conversation is followed in the agent's own store */
export interface TrackedTab {
  projectId: string
  sessionId: string
  terminalId: string
  agentSessionId: string
}

/** the four ids of a tracked tab as one string, so an effect can depend on them and nothing else */
const KEY_SEP = '\0'

function trackKeyOf(tab: TrackedTab): string {
  return [tab.projectId, tab.sessionId, tab.terminalId, tab.agentSessionId].join(KEY_SEP)
}

function trackKeyBack(key: string): TrackedTab | null {
  const [projectId, sessionId, terminalId, agentSessionId] = key.split(KEY_SEP)
  // an id can be empty only if something other than trackKeyOf wrote the key; tracking a tab
  // with a blank id would poll the agent's store for a conversation that cannot exist
  if (!projectId || !sessionId || !terminalId || !agentSessionId) return null
  return { projectId, sessionId, terminalId, agentSessionId }
}

/** the conversation lives where the tab itself looks: its own profile beats the agent's profile */
export function storeDir(terminal: Pick<TerminalTab, 'configDir'>, agentDir?: string): string | undefined {
  return terminal.configDir ?? agentDir
}

/**
 * Resume or fresh start is decided by the agent's own store, never by our bookkeeping:
 * a fresh run with an id that already exists dies with "Session ID is already in use",
 * and a resume of a conversation that was never written dies with "No conversation found".
 */
export function useResolveLaunched(): (projectId: string, sessionId: string, terminal: TerminalTab) => Promise<void> {
  const dispatch = useDispatch()
  const settingsRef = useSettingsRef()

  return useCallback(
    async (projectId: string, sessionId: string, terminal: TerminalTab) => {
      const agent = findAgent(settingsRef.current, terminal.agentId)
      if (!agent || agent.sessionSource === 'none' || !terminal.agentSessionId) return
      const kind = agent.sessionSource === 'codex' ? 'codex' : 'claude'
      const dir = storeDir(terminal, agent.env.CLAUDE_CONFIG_DIR)
      const exists = await window.api.agents.sessionExists(kind, terminal.agentSessionId, dir)
      if (Boolean(terminal.launched) === exists) return
      dispatch({ type: 'launchedChanged', projectId, sessionId, terminalId: terminal.id, launched: exists })
    },
    [dispatch, settingsRef],
  )
}

/**
 * One read of the agent's store, propagated only where it changes something.
 *
 * The read happens on a trigger from the tab — the end of one of its turns — and never on a
 * schedule of its own. An agent rewrites the title of a conversation as it goes (a long one
 * carries dozens of them), so there is no single moment at which the name is finally known; the
 * old timer polled a bounded number of times and then gave up, and from then on the tab kept
 * whatever name it happened to be holding.
 *
 * The comparison is against the tab as it is right now rather than against what a previous read
 * returned: after `/clear` the agent may well come back to a name the tab carried before.
 */
export function useAgentTitleSync(): (tab: TrackedTab) => Promise<void> {
  const stateRef = useAppStateRef()
  const dispatch = useDispatch()
  /** tabs whose store read is in flight: turns can end faster than the store answers */
  const reading = useRef<Set<string>>(new Set())

  return useCallback(
    async (tab: TrackedTab): Promise<void> => {
      const { projectId, sessionId, terminalId, agentSessionId } = tab
      if (reading.current.has(terminalId)) return
      const terminal = stateRef.current.projects
        .find((p) => p.id === projectId)
        ?.sessions.find((s) => s.id === sessionId)
        ?.terminals.find((t) => t.id === terminalId)
      const agent = findAgent(stateRef.current.settings, terminal?.agentId)
      if (!terminal || !agent || agent.sessionSource === 'none') return
      const kind = agent.sessionSource === 'codex' ? 'codex' : 'claude'
      const dir = storeDir(terminal, agent.env.CLAUDE_CONFIG_DIR)

      reading.current.add(terminalId)
      try {
        if (!terminal.launched && (await window.api.agents.sessionExists(kind, agentSessionId, dir))) {
          dispatch({ type: 'launchedChanged', projectId, sessionId, terminalId, launched: true })
        } else if (!terminal.launched) {
          // nothing has been written under this id yet, so there is no title to read either
          return
        }

        const fresh = await window.api.agents.sessionTitle(kind, agentSessionId, dir)
        // the agent's name is on the tab already; wait for a title that means something
        if (!fresh || fresh === agent.name || fresh === terminal.title) return
        // a hand-named tab is left alone, but the session name can still be refined
        dispatch({ type: 'titleObserved', projectId, sessionId, terminalId, title: fresh, fromStore: true })
      } finally {
        reading.current.delete(terminalId)
      }
    },
    [dispatch, stateRef],
  )
}

/**
 * The name a woken tab already has. Every later refresh comes from the end of one of its turns
 * (see `useWaitingPoll`), but a tab that is resumed and then simply sits there says nothing at
 * all — so its conversation is read once, when it appears.
 */
export function useAgentTitleTracking(awake: Set<string>): void {
  const state = useAppState()
  const syncTitle = useAgentTitleSync()
  /** tabs read at least once since they woke */
  const seeded = useRef<Set<string>>(new Set())

  /**
   * Live agent tabs that already know their conversation id, as one flat key. A codex tab gets
   * its id later, from the codex capture — that is why tracking hangs off the tab list and not
   * off createSession/addTerminal/wakeTerminal, which all fire before the id exists.
   * The key holds only ids, so a title written for a tab cannot restart its tracking.
   */
  const trackKey = useMemo(() => {
    const keys: string[] = []
    for (const project of state.projects)
      for (const session of project.sessions)
        for (const t of session.terminals)
          if (t.kind === 'agent' && t.agentSessionId && awake.has(t.id))
            keys.push(
              trackKeyOf({
                projectId: project.id,
                sessionId: session.id,
                terminalId: t.id,
                agentSessionId: t.agentSessionId,
              }),
            )
    return keys.join('\n')
  }, [state.projects, awake])

  const live = useMemo(() => {
    const tabs = new Map<string, TrackedTab>()
    for (const key of trackKey ? trackKey.split('\n') : []) {
      const tab = trackKeyBack(key)
      if (tab) tabs.set(tab.terminalId, tab)
    }
    return tabs
  }, [trackKey])

  useEffect(() => {
    for (const [terminalId, tab] of live) {
      if (seeded.current.has(terminalId)) continue
      seeded.current.add(terminalId)
      void syncTitle(tab)
    }
    // a tab that went to sleep is read again when it comes back
    for (const terminalId of [...seeded.current]) if (!live.has(terminalId)) seeded.current.delete(terminalId)
  }, [live, syncTitle])
}
