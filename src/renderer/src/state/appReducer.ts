import type {
  AgentRun,
  AppState,
  ArchivedSession,
  LayoutConfig,
  Project,
  Session,
  Settings,
  TerminalTab,
} from '../../../shared/types'
import { CLOSED_PROJECTS_KEPT } from '../../../shared/types'
import { shellTitle } from '../lib/agents'
import { moveItem } from '../lib/util'

/**
 * Every persisted change goes through here. Actions carry ids, never the objects the caller
 * happened to render with: a modal or a long-running poll holds a snapshot from the moment it
 * started, and applying it verbatim would resurrect whatever changed in between.
 */
export type Action =
  /** state as it was read from disk */
  | { type: 'loaded'; state: AppState }
  | { type: 'projectAdded'; project: Project }
  | { type: 'projectActivated'; projectId: string }
  | { type: 'projectClosed'; projectId: string; closedAt: number }
  /** remove a closed project from the reopen list without ever restoring it */
  | { type: 'closedProjectForgotten'; projectId: string }
  /** sessions whose directory vanished while the project was closed; they move to its history */
  | { type: 'projectSessionsPruned'; projectId: string; sessionIds: string[]; prunedAt: number }
  | { type: 'projectRenamed'; projectId: string; name: string }
  | { type: 'projectsReordered'; from: number; to: number }
  | { type: 'sessionCreated'; projectId: string; session: Session }
  | { type: 'sessionActivated'; projectId: string; sessionId: string }
  | { type: 'sessionClosed'; projectId: string; sessionId: string; closedAt: number; worktreeRemoved: boolean }
  /** a session taken back out of the project history; its id is the archived one */
  | { type: 'sessionRestored'; projectId: string; session: Session }
  | { type: 'sessionForgotten'; projectId: string; archivedId: string }
  | { type: 'sessionRenamed'; projectId: string; sessionId: string; name: string }
  | { type: 'sessionsReordered'; projectId: string; from: number; to: number }
  | { type: 'terminalAdded'; projectId: string; sessionId: string; terminal: TerminalTab }
  | { type: 'terminalClosed'; projectId: string; sessionId: string; terminalId: string }
  | { type: 'terminalActivated'; projectId: string; sessionId: string; terminalId: string }
  | { type: 'terminalsReordered'; projectId: string; sessionId: string; from: number; to: number }
  | { type: 'terminalRenamed'; projectId: string; sessionId: string; terminalId: string; title: string }
  /** file / merge / diff tab: focus the one that already shows this target, otherwise append */
  | { type: 'tabOpened'; projectId: string; sessionId: string; tab: TerminalTab }
  /** title seen either in the agent's store (`fromStore`) or in the terminal's OSC title */
  | {
      type: 'titleObserved'
      projectId: string
      sessionId: string
      terminalId: string
      title: string
      fromStore: boolean
    }
  | { type: 'commandObserved'; projectId: string; sessionId: string; terminalId: string; command: string }
  | { type: 'launchedChanged'; projectId: string; sessionId: string; terminalId: string; launched: boolean }
  | { type: 'agentSessionCaptured'; projectId: string; sessionId: string; terminalId: string; agentSessionId: string }
  | { type: 'runRecorded'; projectId: string; sessionId: string; run: AgentRun }
  | { type: 'settingsSaved'; settings: Settings }
  | { type: 'settingsPatched'; patch: Partial<Settings> }
  | { type: 'layoutChanged'; patch: Partial<LayoutConfig> }
  | { type: 'panelToggled'; key: 'filesOpen' | 'changesCollapsed' }

function withProject(state: AppState, projectId: string, fn: (p: Project) => Project): AppState {
  const projects = state.projects.map((p) => (p.id === projectId ? fn(p) : p))
  return { ...state, projects }
}

function withSession(state: AppState, projectId: string, sessionId: string, fn: (s: Session) => Session): AppState {
  return withProject(state, projectId, (p) => ({
    ...p,
    sessions: p.sessions.map((s) => (s.id === sessionId ? fn(s) : s)),
  }))
}

function withTerminal(
  state: AppState,
  a: { projectId: string; sessionId: string; terminalId: string },
  fn: (t: TerminalTab) => TerminalTab,
): AppState {
  return withSession(state, a.projectId, a.sessionId, (s) => ({
    ...s,
    terminals: s.terminals.map((t) => (t.id === a.terminalId ? fn(t) : t)),
  }))
}

function findSession(state: AppState, projectId: string, sessionId: string): Session | undefined {
  return state.projects.find((p) => p.id === projectId)?.sessions.find((s) => s.id === sessionId)
}

function withSettings(state: AppState, patch: Partial<Settings>): AppState {
  return { ...state, settings: { ...state.settings, ...patch } }
}

/** a file / merge / diff tab already showing this target */
function sameTarget(a: TerminalTab, b: TerminalTab): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'diff') return a.diff?.path === b.diff?.path && a.diff?.cwd === b.diff?.cwd
  return a.filePath === b.filePath
}

/** append a tab and focus it */
function appendTab(s: Session, tab: TerminalTab): Session {
  return { ...s, terminals: [...s.terminals, tab], activeTerminalId: tab.id }
}

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'loaded':
      return action.state

    /**
     * Opening a folder that was closed earlier brings the closed project back whole rather than
     * creating an empty one beside it: the sessions, their tabs and the project's own history are
     * what the person is opening the folder for. The freshly built project is used only when the
     * path has never been seen.
     */
    case 'projectAdded': {
      const existing = state.projects.find((p) => p.path === action.project.path)
      if (existing) return { ...state, activeProjectId: existing.id }

      const closed = state.closedProjects.find((p) => p.path === action.project.path)
      if (closed) {
        const { closedAt: _closedAt, ...project } = closed
        return {
          ...state,
          projects: [...state.projects, project],
          closedProjects: state.closedProjects.filter((p) => p.path !== closed.path),
          activeProjectId: project.id,
        }
      }
      return { ...state, projects: [...state.projects, action.project], activeProjectId: action.project.id }
    }

    case 'projectActivated':
      return state.activeProjectId === action.projectId ? state : { ...state, activeProjectId: action.projectId }

    /**
     * Closing keeps the project, it does not discard it: it moves to `closedProjects`, newest
     * first, so reopening the folder restores the sessions as they were. Only one entry per path
     * is kept — the same folder closed twice is the same project, and the later state is the true one.
     */
    case 'projectClosed': {
      const project = state.projects.find((p) => p.id === action.projectId)
      const projects = state.projects.filter((p) => p.id !== action.projectId)
      const activeProjectId =
        state.activeProjectId === action.projectId ? (projects[0]?.id ?? null) : state.activeProjectId
      const closedProjects = project
        ? [
            { ...project, closedAt: action.closedAt },
            ...state.closedProjects.filter((p) => p.path !== project.path),
          ].slice(0, CLOSED_PROJECTS_KEPT)
        : state.closedProjects
      return { ...state, projects, closedProjects, activeProjectId }
    }

    /** dropped from the reopen list on purpose: its sessions are not coming back */
    case 'closedProjectForgotten':
      return { ...state, closedProjects: state.closedProjects.filter((p) => p.id !== action.projectId) }

    /**
     * Sessions whose directory disappeared while the project was closed cannot be opened, so on
     * restore they move into the project's history instead of pretending to still be there.
     */
    case 'projectSessionsPruned': {
      if (action.sessionIds.length === 0) return state
      const gone = new Set(action.sessionIds)
      return withProject(state, action.projectId, (p) => {
        const dropped = p.sessions.filter((s) => gone.has(s.id))
        if (dropped.length === 0) return p
        const sessions = p.sessions.filter((s) => !gone.has(s.id))
        return {
          ...p,
          sessions,
          activeSessionId: gone.has(p.activeSessionId ?? '') ? (sessions[0]?.id ?? null) : p.activeSessionId,
          history: [
            ...dropped.map((s) => ({ ...s, closedAt: action.prunedAt, worktreeRemoved: true })),
            ...(p.history ?? []),
          ],
        }
      })
    }

    case 'projectRenamed':
      return withProject(state, action.projectId, (p) => ({ ...p, name: action.name }))

    case 'projectsReordered':
      return { ...state, projects: moveItem(state.projects, action.from, action.to) }

    case 'sessionCreated':
      return withProject(state, action.projectId, (p) => ({
        ...p,
        sessions: [...p.sessions, action.session],
        activeSessionId: action.session.id,
      }))

    case 'sessionActivated':
      return withProject(state, action.projectId, (p) => ({ ...p, activeSessionId: action.sessionId }))

    case 'sessionClosed': {
      // archive what is in the state right now: the tabs may have changed while the dialog was up
      const session = findSession(state, action.projectId, action.sessionId)
      if (!session) return state
      const archived: ArchivedSession = {
        ...session,
        closedAt: action.closedAt,
        worktreeRemoved: action.worktreeRemoved,
      }
      return withProject(state, action.projectId, (p) => {
        const sessions = p.sessions.filter((s) => s.id !== action.sessionId)
        return {
          ...p,
          sessions,
          history: [archived, ...(p.history ?? [])].slice(0, 50),
          activeSessionId: p.activeSessionId === action.sessionId ? (sessions[0]?.id ?? null) : p.activeSessionId,
        }
      })
    }

    case 'sessionRestored':
      return withProject(state, action.projectId, (p) => ({
        ...p,
        sessions: [...p.sessions, action.session],
        history: (p.history ?? []).filter((h) => h.id !== action.session.id),
        activeSessionId: action.session.id,
      }))

    case 'sessionForgotten':
      return withProject(state, action.projectId, (p) => ({
        ...p,
        history: (p.history ?? []).filter((h) => h.id !== action.archivedId),
      }))

    case 'sessionRenamed':
      return withSession(state, action.projectId, action.sessionId, (s) => ({
        ...s,
        name: action.name,
        nameAuto: false,
      }))

    case 'sessionsReordered':
      return withProject(state, action.projectId, (p) => ({
        ...p,
        sessions: moveItem(p.sessions, action.from, action.to),
      }))

    case 'terminalAdded':
      return withSession(state, action.projectId, action.sessionId, (s) => appendTab(s, action.terminal))

    case 'terminalClosed':
      return withSession(state, action.projectId, action.sessionId, (s) => {
        const terminals = s.terminals.filter((t) => t.id !== action.terminalId)
        return {
          ...s,
          terminals,
          activeTerminalId:
            s.activeTerminalId === action.terminalId
              ? (terminals[terminals.length - 1]?.id ?? null)
              : s.activeTerminalId,
        }
      })

    case 'terminalActivated':
      return withSession(state, action.projectId, action.sessionId, (s) =>
        s.activeTerminalId === action.terminalId ? s : { ...s, activeTerminalId: action.terminalId },
      )

    case 'terminalsReordered':
      return withSession(state, action.projectId, action.sessionId, (s) => ({
        ...s,
        terminals: moveItem(s.terminals, action.from, action.to),
      }))

    case 'terminalRenamed':
      // the name was given by a person: title tracking never touches it again
      return withTerminal(state, action, (t) => ({ ...t, title: action.title, titleManual: true }))

    case 'tabOpened':
      return withSession(state, action.projectId, action.sessionId, (s) => {
        const existing = s.terminals.find((t) => sameTarget(t, action.tab))
        if (!existing) return appendTab(s, action.tab)
        // The target is already open, so it is focused rather than opened twice — but two things
        // about it may have changed with the request: a diff of the same file may be compared
        // against something else now, and a terminal link may name a line the editor is not on.
        const { diff, fileLine } = action.tab
        const patch = { ...(diff ? { diff } : {}), ...(fileLine === undefined ? {} : { fileLine }) }
        return {
          ...s,
          terminals:
            diff || fileLine !== undefined
              ? s.terminals.map((t) => (t.id === existing.id ? { ...t, ...patch } : t))
              : s.terminals,
          activeTerminalId: existing.id,
        }
      })

    case 'titleObserved': {
      const session = findSession(state, action.projectId, action.sessionId)
      const terminal = session?.terminals.find((t) => t.id === action.terminalId)
      if (!session || !terminal) return state
      // a hand-given name beats any title; a name from the agent's store beats the window title
      if (terminal.titleManual) return state
      if (!action.fromStore && terminal.titleFromStore) return state
      const firstAgent = session.terminals.find((t) => t.kind === 'agent')
      const renameSession =
        session.nameAuto !== false && firstAgent?.id === action.terminalId && session.name !== action.title
      return withSession(state, action.projectId, action.sessionId, (s) => ({
        ...s,
        terminals: s.terminals.map((t) =>
          t.id === action.terminalId
            ? { ...t, title: action.title, ...(action.fromStore ? { titleFromStore: true } : {}) }
            : t,
        ),
        ...(renameSession ? { name: action.title, nameAuto: true } : {}),
      }))
    }

    case 'commandObserved':
      return withSession(state, action.projectId, action.sessionId, (s) => ({
        ...s,
        terminals: s.terminals.map((t) =>
          t.id === action.terminalId && t.kind === 'shell' ? { ...t, title: shellTitle(s.cwd, action.command) } : t,
        ),
      }))

    case 'launchedChanged':
      return withTerminal(state, action, (t) =>
        t.launched === action.launched ? t : { ...t, launched: action.launched },
      )

    case 'agentSessionCaptured':
      return withTerminal(state, action, (t) => ({ ...t, agentSessionId: action.agentSessionId }))

    case 'runRecorded':
      return withSession(state, action.projectId, action.sessionId, (s) => ({
        ...s,
        runs: [action.run, ...(s.runs ?? [])].slice(0, 100),
      }))

    case 'settingsSaved':
      return { ...state, settings: action.settings }

    case 'settingsPatched':
      return withSettings(state, action.patch)

    case 'layoutChanged':
      return withSettings(state, { layout: { ...state.settings.layout, ...action.patch } })

    case 'panelToggled':
      return withSettings(state, {
        layout: { ...state.settings.layout, [action.key]: !state.settings.layout[action.key] },
      })

    default:
      return state
  }
}
