/**
 * Sessions an agent asked for.
 *
 * A claude tab is started with an MCP server of ours (`main/agentTools`), and its one tool,
 * `open_session`, ends up here: main takes the request off disk and sends it, this is what
 * carries it out, and the answer goes back the same way to the tool call that is still blocked
 * on it.
 *
 * The renderer does the work because a session is a renderer thing — the project, the worktree,
 * the tab and the state that is written to disk all live on this side. Main knows none of it.
 *
 * Three things are decided here rather than by the agent that asked:
 *
 * - **where it goes.** The project of the tab that asked; if the request could not name its tab
 *   — the server is not always given our environment — the project the person is looking at.
 *   An agent cannot open a session in a project that is not open.
 * - **what it is called and what it forks into.** Exactly what the new-session window would have
 *   filled in, through the same helpers (`lib/sessionDefaults`), so that a session an agent
 *   opened is indistinguishable from one the person opened.
 * - **which agent runs in it.** claude: the tool only exists in a claude tab, and a session
 *   opened by an agent that then cannot be talked to is worth nothing.
 *
 * The answer is written in English. It is read by another CLI, not by a person, so it is not a
 * message code and it is not translated — the one place in the renderer where that is true.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { AgentToolRequest, AgentToolResult, Project, Settings } from '../../../shared/types'
import type { NewSessionResult } from '../components/NewSessionModal'
import { useT } from '../i18n'
import { autoBranch, worktreePathFor } from '../lib/sessionDefaults'
import { useAppStateRef } from '../state/selectors'
import type { SessionActions } from './useSessionActions'

/** a leftover directory of a removed worktree: git refuses to put a new one there */
const PATH_TRIES = 20

/**
 * The agent the new session runs. The tab that asked is the first answer — two sessions of the
 * same work should be the same CLI — but only if it is a claude-like one; anything else, and the
 * first enabled agent that keeps a conversation of its own is taken instead.
 */
function agentIdFor(settings: Settings, requesterAgentId: string | undefined): string | null {
  const enabled = settings.agents.filter((a) => a.enabled)
  const requester = enabled.find((a) => a.id === requesterAgentId)
  if (requester?.sessionSource === 'uuid') return requester.id
  return enabled.find((a) => a.sessionSource === 'uuid')?.id ?? null
}

async function takenBranches(projectPath: string): Promise<Set<string>> {
  const [branches, worktrees] = await Promise.all([
    window.api.git.branchInfo(projectPath).catch(() => []),
    window.api.git.worktrees(projectPath).catch(() => []),
  ])
  const taken = new Set(branches.filter((b) => !b.remote).map((b) => b.name))
  for (const w of worktrees) if (w.branch) taken.add(w.branch)
  return taken
}

export function useAgentToolRequests(sessions: SessionActions): void {
  const stateRef = useAppStateRef()
  const t = useT()
  /** requests are carried out one after another: two worktrees must not be planned on one state */
  const queue = useRef<Promise<void>>(Promise.resolve())

  const plan = useCallback(
    async (project: Project, request: AgentToolRequest, agentId: string | null): Promise<NewSessionResult> => {
      const name = request.name ?? t('sessions.defaultName', { n: project.sessions.length + 1 })
      const createWorktree = (request.isolate ?? true) && project.isGit
      if (!createWorktree) {
        return {
          name,
          nameAuto: !request.name,
          createWorktree: false,
          branch: '',
          baseRef: '',
          worktreePath: '',
          agentId,
          startPrompt: request.task,
        }
      }
      const [taken, current] = await Promise.all([
        takenBranches(project.path),
        window.api.git.currentBranch(project.path).catch(() => null),
      ])
      const branch = autoBranch({ name: request.name ?? null, task: request.task }, taken)
      const base = worktreePathFor(project.path, branch)
      let worktreePath = base
      for (let i = 2; i < PATH_TRIES && (await window.api.fs.exists(worktreePath)); i++) worktreePath = `${base}-${i}`
      return {
        name,
        nameAuto: !request.name,
        createWorktree: true,
        branch,
        baseRef: current ?? 'HEAD',
        worktreePath,
        agentId,
        startPrompt: request.task,
      }
    },
    [t],
  )

  const carryOut = useCallback(
    async (request: AgentToolRequest): Promise<AgentToolResult> => {
      const state = stateRef.current
      // the tab that asked names the project; a request that could not name its tab lands in the
      // project on screen, which is the only one the person can be said to have meant
      const owner = request.terminalId
        ? state.projects.find((p) => p.sessions.some((s) => s.terminals.some((x) => x.id === request.terminalId)))
        : undefined
      const project = owner ?? state.projects.find((p) => p.id === state.activeProjectId)
      if (!project) return { ok: false, error: 'Claude Studio has no project open to put a session in.' }

      const requesterAgentId = request.terminalId
        ? project.sessions.flatMap((s) => s.terminals).find((x) => x.id === request.terminalId)?.agentId
        : undefined
      const agentId = agentIdFor(state.settings, requesterAgentId)
      if (!agentId) return { ok: false, error: 'Claude Studio has no Claude agent enabled to run the session.' }

      const created = await sessions.createSession(project, await plan(project, request, agentId))
      if (!created.ok) return { ok: false, error: `Claude Studio could not create the session: ${created.error}` }

      const session = created.session
      const terminal = session.terminals[0]
      // a tab's process starts when its pane is first mounted, and a pane exists only for the
      // project on screen: a session opened into a project nobody is looking at waits there
      const started = stateRef.current.activeProjectId === project.id
      return {
        ok: true,
        session: {
          name: session.name,
          cwd: session.cwd,
          ...(session.worktree ? { branch: session.worktree.branch } : {}),
          ...(terminal?.agentSessionId ? { agentSessionId: terminal.agentSessionId } : {}),
          started,
        },
      }
    },
    [plan, sessions, stateRef],
  )

  useEffect(() => {
    return window.api.agents.onToolRequest((request) => {
      queue.current = queue.current.then(async () => {
        let result: AgentToolResult
        try {
          result = await carryOut(request)
        } catch (e) {
          result = { ok: false, error: `Claude Studio failed to open the session: ${String(e)}` }
        }
        // an answer that never arrives is the agent's call hanging until its own timeout, so the
        // reply is written whatever happened above
        await window.api.agents.replyToolRequest(request.id, result)
      })
    })
  }, [carryOut])
}
