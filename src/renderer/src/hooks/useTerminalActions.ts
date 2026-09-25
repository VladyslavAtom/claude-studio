import { useCallback, useMemo } from 'react'
import type { AgentRun, Project, Session, Settings, TerminalTab } from '../../../shared/types'
import { useT } from '../i18n'
import { commandForRun, findAgent, nameFromTitle, titleFor } from '../lib/agents'
import { basename, uid } from '../lib/util'
import { useDispatch } from '../state/appStateContext'
import { useRuntimeActions, useRuntimeState } from '../state/runtimeContext'
import { useSettingsRef } from '../state/selectors'
import { useUiActions } from '../state/uiContext'
import { resultMessage } from '../ui/useGitAction'
import { useResolveLaunched } from './useAgentTracking'

/** a new agent or shell tab; the name is numbered against the open tabs of the same kind */
export function newTerminal(settings: Settings, agentId: string | null, existing: TerminalTab[]): TerminalTab {
  const agent = agentId ? (settings.agents.find((a) => a.id === agentId) ?? null) : null
  return {
    id: uid(),
    kind: agent ? 'agent' : 'shell',
    // a key left out and a key set to undefined are not the same thing here: the tab is what
    // gets serialised into state.json, and `"agentId": undefined` is not valid JSON anyway
    ...(agent ? { agentId: agent.id } : {}),
    title: titleFor(agent, existing),
    // claude-style agents take their conversation id from us, so tabs never collide
    ...(agent?.sessionSource === 'uuid' ? { agentSessionId: uid() } : {}),
    startedAt: Date.now(),
  }
}

/**
 * A file from the tree — or from a path printed in a terminal — opens as a tab alongside the
 * agents. `line` is what a terminal link carried (`src/main/git.ts:42`); the key is left out
 * rather than set to undefined, because the tab is what gets serialised into state.json.
 */
export function fileTab(path: string, line?: number): TerminalTab {
  return {
    id: uid(),
    kind: 'editor',
    title: basename(path),
    filePath: path,
    ...(line === undefined ? {} : { fileLine: line }),
    startedAt: Date.now(),
  }
}

/** a conflicted file opens as a merge tab */
export function mergeTab(cwd: string, relPath: string): TerminalTab {
  const full = relPath.startsWith('/') ? relPath : `${cwd}/${relPath}`
  return { id: uid(), kind: 'merge', title: basename(full), filePath: full, mergeCwd: cwd, startedAt: Date.now() }
}

export function diffTab(diff: NonNullable<TerminalTab['diff']>): TerminalTab {
  return { id: uid(), kind: 'diff', title: basename(diff.path), diff, startedAt: Date.now() }
}

export interface TerminalActions {
  addTerminal: (project: Project, session: Session, agentId: string | null) => void
  closeTerminal: (project: Project, session: Session, terminalId: string) => Promise<void>
  /** wake a sleeping tab once we know whether its conversation exists */
  wakeTerminal: (project: Project, session: Session, terminalId: string) => Promise<void>
  /** put a tab to sleep by hand, from its menu */
  sleepTerminal: (terminalId: string) => void
  restoreRun: (project: Project, session: Session, run: AgentRun) => void
  selectTerminal: (project: Project, session: Session, terminalId: string) => void
  renameTerminal: (project: Project, session: Session, terminalId: string, title: string) => void
  reorderTerminals: (project: Project, session: Session, from: number, to: number) => void
  setLaunched: (project: Project, session: Session, terminalId: string, launched: boolean) => void
  /** one door for file, merge and diff tabs: opening the same target again just focuses it */
  openTab: (project: Project, session: Session, tab: TerminalTab) => void
  /** a path clicked in terminal output: it is granted to the sandbox first, then opened */
  openPathFromTerminal: (project: Project, session: Session, path: string, line?: number) => Promise<void>
  /** each agent tab names itself from its own OSC title; the first one also names the session */
  observeTitle: (project: Project, session: Session, terminalId: string, title: string) => void
  observeCommand: (project: Project, session: Session, terminalId: string, command: string) => void
  /** send text into the session's active terminal (editor -> agent bridge) */
  sendToActiveTerminal: (session: Session, text: string) => void
}

export function useTerminalActions(): TerminalActions {
  const t = useT()
  const dispatch = useDispatch()
  const settingsRef = useSettingsRef()
  const { awake } = useRuntimeState()
  const { wake, forgetTerminals } = useRuntimeActions()
  const { setError } = useUiActions()
  const resolveLaunched = useResolveLaunched()

  const addTerminal = useCallback(
    (project: Project, session: Session, agentId: string | null) => {
      const terminal = newTerminal(settingsRef.current, agentId, session.terminals)
      wake(terminal.id)
      dispatch({ type: 'terminalAdded', projectId: project.id, sessionId: session.id, terminal })
    },
    [dispatch, settingsRef, wake],
  )

  /** a closed terminal keeps its place in the session history */
  const recordRun = useCallback(
    (project: Project, session: Session, terminal: TerminalTab) => {
      if (terminal.kind !== 'agent' || !terminal.agentId) return
      const run: AgentRun = {
        id: uid(),
        agentId: terminal.agentId,
        // a run without a conversation id reopens through the agent's own picker; the key is
        // left out rather than set to undefined, so the record stays round-trippable through JSON
        ...(terminal.agentSessionId ? { agentSessionId: terminal.agentSessionId } : {}),
        title: terminal.title,
        startedAt: terminal.startedAt ?? Date.now(),
        endedAt: Date.now(),
      }
      dispatch({ type: 'runRecorded', projectId: project.id, sessionId: session.id, run })
    },
    [dispatch],
  )

  const closeTerminal = useCallback(
    async (project: Project, session: Session, terminalId: string) => {
      const terminal = session.terminals.find((t) => t.id === terminalId)
      await window.api.pty.kill(terminalId)
      forgetTerminals([terminalId])
      if (terminal) recordRun(project, session, terminal)
      dispatch({ type: 'terminalClosed', projectId: project.id, sessionId: session.id, terminalId })
    },
    [dispatch, forgetTerminals, recordRun],
  )

  const wakeTerminal = useCallback(
    (project: Project, session: Session, terminalId: string): Promise<void> => {
      const terminal = session.terminals.find((t) => t.id === terminalId)

      // the caller awaits this: a restarting tab must not remount until `launched` is known,
      // or `commandFor` picks resume-vs-fresh arguments from a stale flag
      if (!terminal) {
        wake(terminalId)
        return Promise.resolve()
      }
      return resolveLaunched(project.id, session.id, terminal).finally(() => wake(terminalId))
    },
    [resolveLaunched, wake],
  )

  /**
   * Sleep on request. Nothing is changed here on purpose: main kills the process and answers
   * with `slept`, and the runtime hook drops the tab from `awake` when that arrives — exactly
   * what happens when the idle sweep takes a tab. Dropping it from `awake` here as well would
   * be a second, shorter path to the same state, and the two would drift.
   */
  const sleepTerminal = useCallback((terminalId: string) => {
    void window.api.pty.sleep(terminalId)
  }, [])

  const restoreRun = useCallback(
    (project: Project, session: Session, run: AgentRun) => {
      const agent = findAgent(settingsRef.current, run.agentId)
      if (!agent) {
        setError(t('terminal.run.agentGone'))
        return
      }
      const terminal: TerminalTab = {
        id: uid(),
        kind: 'agent',
        agentId: agent.id,
        title: run.title,
        ...(run.agentSessionId ? { agentSessionId: run.agentSessionId } : {}),
        launched: true,
        startedAt: Date.now(),
      }
      wake(terminal.id)
      dispatch({ type: 'terminalAdded', projectId: project.id, sessionId: session.id, terminal })
      // commandForRun is what the pane will build from the tab; keep them consistent
      void commandForRun(agent, run)
    },
    [dispatch, setError, settingsRef, t, wake],
  )

  const selectTerminal = useCallback(
    (project: Project, session: Session, terminalId: string) =>
      dispatch({ type: 'terminalActivated', projectId: project.id, sessionId: session.id, terminalId }),
    [dispatch],
  )

  const renameTerminal = useCallback(
    (project: Project, session: Session, terminalId: string, title: string) =>
      dispatch({ type: 'terminalRenamed', projectId: project.id, sessionId: session.id, terminalId, title }),
    [dispatch],
  )

  const reorderTerminals = useCallback(
    (project: Project, session: Session, from: number, to: number) =>
      dispatch({ type: 'terminalsReordered', projectId: project.id, sessionId: session.id, from, to }),
    [dispatch],
  )

  const setLaunched = useCallback(
    (project: Project, session: Session, terminalId: string, launched: boolean) =>
      dispatch({ type: 'launchedChanged', projectId: project.id, sessionId: session.id, terminalId, launched }),
    [dispatch],
  )

  const openTab = useCallback(
    (project: Project, session: Session, tab: TerminalTab) =>
      dispatch({ type: 'tabOpened', projectId: project.id, sessionId: session.id, tab }),
    [dispatch],
  )

  /**
   * A path clicked in terminal output.
   *
   * The click comes first and the tab second, on purpose: an agent's file usually lies outside
   * every project root — a scratchpad under `/tmp/claude-1000/…` is the common case — and the
   * editor would open onto `path-outside-roots`. `openFromTerminal` registers that one file, so
   * the read that follows is allowed; when it refuses (the file went away between the check that
   * drew the link and the click, or it is a directory), no tab is opened and the reason is shown.
   */
  const openPathFromTerminal = useCallback(
    async (project: Project, session: Session, path: string, line?: number) => {
      const res = await window.api.files.openFromTerminal(path)
      if (!res.ok) {
        setError(resultMessage(t, res, t('terminal.link.failed')))
        return
      }
      openTab(project, session, fileTab(path, line))
    },
    [openTab, setError, t],
  )

  const observeTitle = useCallback(
    (project: Project, session: Session, terminalId: string, title: string) => {
      const name = nameFromTitle(title, session.cwd)
      if (!name) return
      dispatch({
        type: 'titleObserved',
        projectId: project.id,
        sessionId: session.id,
        terminalId,
        title: name,
        fromStore: false,
      })
    },
    [dispatch],
  )

  const observeCommand = useCallback(
    (project: Project, session: Session, terminalId: string, command: string) =>
      dispatch({ type: 'commandObserved', projectId: project.id, sessionId: session.id, terminalId, command }),
    [dispatch],
  )

  const sendToActiveTerminal = useCallback(
    (session: Session, text: string) => {
      const id = session.activeTerminalId ?? session.terminals[0]?.id
      if (!id) return
      if (!awake.has(id)) {
        setError(t('terminal.tab.asleep'))
        return
      }
      window.api.pty.input(id, text)
    },
    [awake, setError, t],
  )

  return useMemo(
    () => ({
      addTerminal,
      closeTerminal,
      wakeTerminal,
      sleepTerminal,
      restoreRun,
      selectTerminal,
      renameTerminal,
      reorderTerminals,
      setLaunched,
      openTab,
      openPathFromTerminal,
      observeTitle,
      observeCommand,
      sendToActiveTerminal,
    }),
    [
      addTerminal,
      closeTerminal,
      wakeTerminal,
      sleepTerminal,
      restoreRun,
      selectTerminal,
      renameTerminal,
      reorderTerminals,
      setLaunched,
      openTab,
      openPathFromTerminal,
      observeTitle,
      observeCommand,
      sendToActiveTerminal,
    ],
  )
}
