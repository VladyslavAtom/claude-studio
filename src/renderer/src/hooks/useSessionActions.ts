import { useCallback, useMemo, useRef } from 'react'
import type { ArchivedSession, ExternalSession, Project, Session, TerminalTab } from '../../../shared/types'
import type { NewSessionResult } from '../components/NewSessionModal'
import { useT } from '../i18n'
import { findAgent } from '../lib/agents'
import { uid } from '../lib/util'
import { useDispatch } from '../state/appStateContext'
import { useRuntimeActions } from '../state/runtimeContext'
import { useAppStateRef, useSettingsRef } from '../state/selectors'
import { useUiActions } from '../state/uiContext'
import { newTerminal } from './useTerminalActions'

/**
 * Creating a session is asked for from two places now — the window, and an agent through its
 * tool — and the second one has to be told how it went in words it can pass on. A toast is not
 * an answer to a caller, so the outcome is returned as well as shown.
 */
export type CreateSessionResult = { ok: true; session: Session } | { ok: false; error: string }

export interface SessionActions {
  createSession: (project: Project, res: NewSessionResult) => Promise<CreateSessionResult>
  /** closing a session archives it, so it can be reopened from the project history */
  closeSession: (project: Project, session: Session, removeWorktree: boolean, deleteBranch: boolean) => Promise<void>
  restoreSession: (project: Project, archived: ArchivedSession) => Promise<void>
  forgetSession: (project: Project, archivedId: string) => void
  renameSession: (project: Project, session: Session, name: string) => void
  selectSession: (project: Project, sessionId: string) => void
  reorderSessions: (project: Project, from: number, to: number) => void
  /** open a conversation that lives in the agent's own store */
  openExternalSession: (project: Project, entry: ExternalSession) => Promise<void>
}

/** how long a finished message stays on the status line; the same 3 s as ui/useGitAction */
const INFO_CLEAR_MS = 3000

export function useSessionActions(): SessionActions {
  const stateRef = useAppStateRef()
  const settingsRef = useSettingsRef()
  const dispatch = useDispatch()
  const { wake, forgetTerminals } = useRuntimeActions()
  const { setBusy, setError, closeModal } = useUiActions()
  const t = useT()
  /** pending clear of the status line: a stale one must not wipe a fresher message */
  const infoTimer = useRef(0)

  /** an outcome worth reading once and then forgetting — not an error, so not the error toast */
  const showInfo = useCallback(
    (msg: string) => {
      window.clearTimeout(infoTimer.current)
      setBusy(msg)
      infoTimer.current = window.setTimeout(() => setBusy(null), INFO_CLEAR_MS)
    },
    [setBusy],
  )

  const createSession = useCallback(
    async (project: Project, res: NewSessionResult): Promise<CreateSessionResult> => {
      setError(null)
      let cwd = project.path
      let worktree: Session['worktree']

      if (res.createWorktree) {
        setBusy(t('sessions.busy.worktreeAdd'))
        const r = await window.api.git.worktreeAdd({
          repoPath: project.path,
          worktreePath: res.worktreePath,
          branch: res.branch,
          baseRef: res.baseRef,
        })
        setBusy(null)
        if (!r.ok) {
          const error = r.error ?? 'git worktree add failed'
          setError(error)
          return { ok: false, error }
        }
        cwd = res.worktreePath
        worktree = { path: res.worktreePath, branch: res.branch, baseRef: res.baseRef }
        // the worktree directory has only just been created — it is not among the registered roots yet
        await window.api.files.registerRoot(cwd)
      }

      const terminal = newTerminal(settingsRef.current, res.agentId, [])
      if (res.startPrompt) terminal.startPrompt = res.startPrompt
      const session: Session = {
        id: uid(),
        name: res.name,
        // a name left at its default keeps following the agent's terminal title; only the
        // window knows whether it was typed over, so the window is what says so
        nameAuto: res.nameAuto,
        cwd,
        // a session without a worktree carries no key at all: `worktree: undefined` would be
        // written into state.json as a missing field on the next save anyway
        ...(worktree ? { worktree } : {}),
        terminals: [terminal],
        activeTerminalId: terminal.id,
        createdAt: Date.now(),
        runs: [],
      }
      wake(terminal.id)
      dispatch({ type: 'sessionCreated', projectId: project.id, session })
      return { ok: true, session }
    },
    [dispatch, setBusy, setError, settingsRef, t, wake],
  )

  const closeSession = useCallback(
    async (project: Project, session: Session, removeWorktree: boolean, deleteBranch: boolean) => {
      // the tabs come from the fresh state: while the window was open there may have become more of them
      const live =
        stateRef.current.projects.find((p) => p.id === project.id)?.sessions.find((s) => s.id === session.id) ?? session
      for (const t of live.terminals) await window.api.pty.kill(t.id)
      forgetTerminals(live.terminals.map((t) => t.id))

      if (removeWorktree && session.worktree) {
        setBusy(t('sessions.busy.worktreeRemove'))
        const r = await window.api.git.worktreeRemove(
          project.path,
          session.worktree.path,
          deleteBranch ? session.worktree.branch : undefined,
        )
        setBusy(null)
        if (!r.ok) setError(r.error ?? 'git worktree remove failed')
        // a success with a caveat — the worktree is gone, the branch outlived it. It used to
        // travel in `error` and was shown as a failure that never happened; main now keeps the
        // two apart, so this goes to the status line and takes itself down after a few seconds
        else if (r.warning) showInfo(r.warning)
      }

      dispatch({
        type: 'sessionClosed',
        projectId: project.id,
        sessionId: session.id,
        closedAt: Date.now(),
        worktreeRemoved: removeWorktree,
      })
    },
    [dispatch, forgetTerminals, setBusy, setError, showInfo, stateRef, t],
  )

  const restoreSession = useCallback(
    async (project: Project, archived: ArchivedSession) => {
      const exists = await window.api.fs.exists(archived.cwd)
      if (!exists) {
        setError(t('sessions.error.noSessionDir', { path: archived.cwd }))
        return
      }
      // the session sat in the history: its directory may no longer be among the registered roots
      await window.api.files.registerRoot(archived.cwd)
      // restored terminals start asleep: their agents resume on click
      const { closedAt: _closedAt, worktreeRemoved: _removed, ...session } = archived
      const restored: Session = { ...session, terminals: session.terminals.map((t) => ({ ...t, launched: true })) }
      dispatch({ type: 'sessionRestored', projectId: project.id, session: restored })
    },
    [dispatch, setError, t],
  )

  const forgetSession = useCallback(
    (project: Project, archivedId: string) => dispatch({ type: 'sessionForgotten', projectId: project.id, archivedId }),
    [dispatch],
  )

  const renameSession = useCallback(
    (project: Project, session: Session, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      dispatch({ type: 'sessionRenamed', projectId: project.id, sessionId: session.id, name: trimmed })
    },
    [dispatch],
  )

  const selectSession = useCallback(
    (project: Project, sessionId: string) => dispatch({ type: 'sessionActivated', projectId: project.id, sessionId }),
    [dispatch],
  )

  const reorderSessions = useCallback(
    (project: Project, from: number, to: number) =>
      dispatch({ type: 'sessionsReordered', projectId: project.id, from, to }),
    [dispatch],
  )

  /**
   * Attach the conversation to the session whose cwd matches, or make a new session for that
   * directory. No duplicates — the modal already marks ids the app tracks.
   */
  const openExternalSession = useCallback(
    async (project: Project, entry: ExternalSession) => {
      closeModal()
      const exists = await window.api.fs.exists(entry.cwd)
      if (!exists) {
        setError(t('sessions.error.noConversationDir', { path: entry.cwd }))
        return
      }
      // The conversation's own directory is often a package subdirectory. `git status --porcelain`
      // prints paths from the repo root, while every pathspec after it is read from the cwd, so a
      // session rooted in a subdirectory shows changes it can neither diff, nor commit, nor revert.
      // Outside a repo there is no root to take, and the conversation's own directory is right.
      const cwd = (await window.api.git.repoRoot(entry.cwd)) ?? entry.cwd
      // the conversation came from the agent's store and may sit in a directory the app never knew about
      await window.api.files.registerRoot(cwd)

      // never open one conversation twice: two tabs resuming the same id would fight over it.
      // The search covers every project: the same conversation can be opened from any of them
      for (const p of stateRef.current.projects) {
        for (const s of p.sessions) {
          const tab = s.terminals.find((t) => t.agentSessionId === entry.id)
          if (!tab) continue
          dispatch({ type: 'projectActivated', projectId: p.id })
          dispatch({ type: 'sessionActivated', projectId: p.id, sessionId: s.id })
          dispatch({ type: 'terminalActivated', projectId: p.id, sessionId: s.id, terminalId: tab.id })
          return
        }
      }

      // the conversation may live in a profile that is not in the agent's settings (a wrapper sets
      // CLAUDE_CONFIG_DIR inside itself) — then the tab carries the directory with it
      const agentDef = findAgent(settingsRef.current, entry.agentId)
      const ownDir = agentDef?.env.CLAUDE_CONFIG_DIR
      const configDir = entry.configDir && entry.configDir !== ownDir ? entry.configDir : null
      const terminal: TerminalTab = {
        id: uid(),
        kind: 'agent',
        agentId: entry.agentId,
        title: entry.title,
        agentSessionId: entry.id,
        launched: true,
        startedAt: Date.now(),
        // the agent's own profile needs no key on the tab: that is what findAgent already gives
        ...(configDir ? { configDir } : {}),
      }
      wake(terminal.id)

      const fresh = stateRef.current.projects.find((p) => p.id === project.id)
      const host = fresh?.sessions.find((s) => s.cwd === cwd)
      if (host) {
        dispatch({ type: 'terminalAdded', projectId: project.id, sessionId: host.id, terminal })
        dispatch({ type: 'sessionActivated', projectId: project.id, sessionId: host.id })
        return
      }

      const worktrees = await window.api.git.worktrees(project.path)
      const wt = worktrees.find((w) => w.path === cwd)
      // the base of somebody else's conversation is unknown: take the branch of the repository
      // root — comparing a worktree with its own HEAD is pointless, the difference is always empty
      const rootBranch = wt?.branch ? await window.api.git.currentBranch(project.path) : null
      const session: Session = {
        id: uid(),
        name: entry.title,
        nameAuto: false,
        cwd,
        ...(wt?.branch ? { worktree: { path: wt.path, branch: wt.branch, baseRef: rootBranch ?? 'HEAD' } } : {}),
        terminals: [terminal],
        activeTerminalId: terminal.id,
        createdAt: entry.startedAt || Date.now(),
        runs: [],
      }
      dispatch({ type: 'sessionCreated', projectId: project.id, session })
    },
    [closeModal, dispatch, setError, settingsRef, stateRef, t, wake],
  )

  return useMemo(
    () => ({
      createSession,
      closeSession,
      restoreSession,
      forgetSession,
      renameSession,
      selectSession,
      reorderSessions,
      openExternalSession,
    }),
    [
      createSession,
      closeSession,
      restoreSession,
      forgetSession,
      renameSession,
      selectSession,
      reorderSessions,
      openExternalSession,
    ],
  )
}
