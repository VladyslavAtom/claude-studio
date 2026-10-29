/**
 * Sessions an agent asked for, and what it may do with them afterwards.
 *
 * A claude tab is started with an MCP server of ours (`main/agentTools`), and its tools end up
 * here: main takes the request off disk and sends it, this is what carries it out, and the answer
 * goes back the same way to the tool call that is still blocked on it.
 *
 * A session opened through `open_session` is the asker's **child** (`Session.parentId`). The
 * other four tools act on the asker's descendants only — listing them, typing into them, reading
 * their conversation, closing them — and the check is made here, against the state, never trusted
 * from the request. Reading is the one thing main does for us: the conversation is a file.
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
 * - **what it forks from.** The asker's own branch when it has a worktree: a child's work is
 *   merged back into its parent, so that is the base its diff and «merged» are measured against.
 *
 * The answer is written in English. It is read by another CLI, not by a person, so it is not a
 * message code and it is not translated — the one place in the renderer where that is true.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { AgentToolRequest, AgentToolResult, Project, Session, Settings } from '../../../shared/types'
import type { NewSessionResult } from '../components/NewSessionModal'
import { useT } from '../i18n'
import { commandFor, conversationKind, envFor, findAgent } from '../lib/agents'
import { withWorktreeEnv } from '../../../shared/worktreeSetup'
import { autoBranch, worktreePathFor } from '../lib/sessionDefaults'
import { MAX_CHILDREN, MAX_DEPTH, depthOf, descendants } from '../lib/sessionTree'
import { terminalStatus } from '../lib/status'
import { useHookPaths } from '../state/appStateContext'
import { useAppStateRef } from '../state/selectors'
import { useRuntimeState } from '../state/runtimeContext'
import type { SessionActions } from './useSessionActions'

/** a leftover directory of a removed worktree: git refuses to put a new one there */
const PATH_TRIES = 20

/**
 * bracketed paste, for multi-line text only: it arrives as one input instead of being submitted
 * line by line. A single line is typed raw — a permission menu reads keys, not a paste.
 */
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
/** the TUI takes a paste and an Enter in the same chunk as part of the paste */
const SUBMIT_DELAY_MS = 60

interface Asker {
  project: Project
  session: Session
}

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

/** the branch a session's work is merged back into: its parent's, or the project's checkout */
async function parentBranch(project: Project, session: Session): Promise<string | null> {
  const parent = project.sessions.find((s) => s.id === session.parentId)
  if (parent?.worktree) return parent.worktree.branch
  return window.api.git.currentBranch(project.path).catch(() => null)
}

/** the head of the child's first prompt: who opened it and how to reach them */
function parentNote(asker: Asker, terminalId: string): string {
  const tab = asker.session.terminals.find((x) => x.id === terminalId)
  const id = tab?.agentSessionId ? ` (claude session id ${tab.agentSessionId})` : ''
  return [
    `[Claude Studio] This session was opened by the session "${asker.session.name}"${id}.`,
    'Report back to it through your usual way of messaging sessions. It may type into this session and will close it when its plan needs nothing more from it.',
  ].join(' ')
}

export function useAgentToolRequests(sessions: SessionActions): void {
  const stateRef = useAppStateRef()
  const runtime = useRuntimeState()
  /** read when a request is carried out, not when the callbacks were made */
  const runtimeRef = useRef(runtime)
  useEffect(() => {
    runtimeRef.current = runtime
  }, [runtime])
  const hookPaths = useHookPaths()
  const hookPathsRef = useRef(hookPaths)
  useEffect(() => {
    hookPathsRef.current = hookPaths
  }, [hookPaths])
  const t = useT()
  /** requests are carried out one after another: two worktrees must not be planned on one state */
  const queue = useRef<Promise<void>>(Promise.resolve())

  const plan = useCallback(
    async (
      project: Project,
      request: Extract<AgentToolRequest, { tool: 'open' }>,
      agentId: string | null,
      asker: Asker | null,
    ): Promise<NewSessionResult> => {
      const name = request.name ?? t('sessions.defaultName', { n: project.sessions.length + 1 })
      const startPrompt =
        asker && request.terminalId ? `${parentNote(asker, request.terminalId)}\n\n${request.task}` : request.task
      const parent = asker ? { parentId: asker.session.id } : {}
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
          startPrompt,
          ...parent,
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
        baseRef: asker?.session.worktree?.branch ?? current ?? 'HEAD',
        worktreePath,
        agentId,
        startPrompt,
        ...parent,
      }
    },
    [t],
  )

  /** the session whose tab asked; null when the request could not name its tab */
  const findAsker = useCallback(
    (terminalId: string | null): Asker | null => {
      if (!terminalId) return null
      for (const project of stateRef.current.projects) {
        const session = project.sessions.find((s) => s.terminals.some((x) => x.id === terminalId))
        if (session) return { project, session }
      }
      return null
    },
    [stateRef],
  )

  const open = useCallback(
    async (request: Extract<AgentToolRequest, { tool: 'open' }>): Promise<AgentToolResult> => {
      const state = stateRef.current
      const asker = findAsker(request.terminalId)
      // a request that could not name its tab lands in the project on screen, which is the only
      // one the person can be said to have meant — and has no parent
      const project = asker?.project ?? state.projects.find((p) => p.id === state.activeProjectId)
      if (!project) return { ok: false, error: 'Claude Studio has no project open to put a session in.' }

      if (asker) {
        if (depthOf(project.sessions, asker.session.id) + 1 > MAX_DEPTH)
          return { ok: false, error: `Sessions nest at most ${MAX_DEPTH} deep; this one may not open another.` }
        const live = project.sessions.filter((s) => s.parentId === asker.session.id).length
        if (live >= MAX_CHILDREN)
          return {
            ok: false,
            error: `This session already has ${live} open children, the most it may hold. Close one first.`,
          }
      }

      const requesterAgentId = request.terminalId
        ? project.sessions.flatMap((s) => s.terminals).find((x) => x.id === request.terminalId)?.agentId
        : undefined
      const agentId = agentIdFor(state.settings, requesterAgentId)
      if (!agentId) return { ok: false, error: 'Claude Studio has no Claude agent enabled to run the session.' }

      const created = await sessions.createSession(project, await plan(project, request, agentId, asker))
      if (!created.ok) return { ok: false, error: `Claude Studio could not create the session: ${created.error}` }

      const session = created.session
      const terminal = session.terminals[0]
      // A tab's process normally starts when its pane is first mounted, and a pane exists only for
      // the session on screen — a child opened into a project nobody is looking at would wait for
      // the person to go there. So it is started here, with exactly what the pane would pass; the
      // pane that mounts later re-attaches to it (`pty.start` on a live id), takes the kept output
      // and applies its measured size. No size now: there is no pane to measure.
      let started = false
      if (terminal) {
        const agent = findAgent(state.settings, terminal.agentId)
        const command = commandFor(agent, terminal, hookPathsRef.current ?? undefined)
        const env = withWorktreeEnv(envFor(agent, terminal), project.path, session.worktree)
        const res = await window.api.pty
          .start({
            id: terminal.id,
            cwd: session.cwd,
            kind: terminal.kind,
            ...(command === undefined ? {} : { initialCommand: command }),
            ...(env === undefined ? {} : { env }),
            sleepable: terminal.kind === 'agent',
          })
          .catch(() => null)
        started = Boolean(res?.alive)
      }
      return {
        ok: true,
        session: {
          id: session.id,
          name: session.name,
          cwd: session.cwd,
          ...(session.worktree ? { branch: session.worktree.branch } : {}),
          ...(terminal?.agentSessionId ? { agentSessionId: terminal.agentSessionId } : {}),
          started,
        },
      }
    },
    [findAsker, plan, sessions, stateRef],
  )

  /** the asker and the descendant it named, or the sentence saying why not */
  const resolveChild = useCallback(
    (request: AgentToolRequest & { session: string }): { asker: Asker; child: Session } | string => {
      const asker = findAsker(request.terminalId)
      if (!asker) return 'Claude Studio cannot tell which session is asking, so it cannot act on its children.'
      const child = descendants(asker.project.sessions, asker.session.id).find((s) => s.id === request.session)
      if (!child) return `No open session ${request.session} was opened by this session or by its children.`
      return { asker, child }
    },
    [findAsker],
  )

  /** what the session's agent tab is doing, in the words of the tab strip */
  const statusOf = useCallback((session: Session): string => {
    const tab = session.terminals.find((x) => x.kind === 'agent')
    if (!tab) return 'no agent tab'
    const rt = runtimeRef.current
    return terminalStatus({
      awake: rt.awake.has(tab.id),
      attention: rt.attention.has(tab.id),
      activity: rt.agentActivity.get(tab.id),
      busy: rt.busyIds.has(tab.id),
    })
  }, [])

  const list = useCallback(
    async (request: Extract<AgentToolRequest, { tool: 'list' }>): Promise<AgentToolResult> => {
      const asker = findAsker(request.terminalId)
      if (!asker) return { ok: false, error: 'Claude Studio cannot tell which session is asking.' }
      const { project } = asker
      const kids = descendants(project.sessions, asker.session.id)
      if (!kids.length) return { ok: true, text: 'This session has no open children.' }
      const blocks = await Promise.all(
        kids.map(async (s) => {
          const tab = s.terminals.find((x) => x.kind === 'agent')
          const lines = [
            `- ${s.name}`,
            `  session id: ${s.id}`,
            `  parent: ${s.parentId === asker.session.id ? 'you' : s.parentId}`,
            `  cwd: ${s.cwd}`,
          ]
          if (s.worktree) lines.push(`  branch: ${s.worktree.branch}`)
          if (tab?.agentSessionId) lines.push(`  claude session id: ${tab.agentSessionId}`)
          lines.push(`  state: ${statusOf(s)}`)
          // a session the person added a second agent to: read_session can be pointed at either
          const agentTabs = s.terminals.filter((x) => x.kind === 'agent')
          if (agentTabs.length > 1) for (const x of agentTabs) lines.push(`  agent tab: ${x.id} "${x.title}"`)
          if (project.isGit) {
            const st = await window.api.git.status(s.cwd, 'working').catch(() => null)
            if (st && !st.error) lines.push(`  uncommitted files: ${st.files.length}`)
          }
          return lines.join('\n')
        }),
      )
      return { ok: true, text: blocks.join('\n') }
    },
    [findAsker, statusOf],
  )

  const close = useCallback(
    async (request: Extract<AgentToolRequest, { tool: 'close' }>): Promise<AgentToolResult> => {
      const found = resolveChild(request)
      if (typeof found === 'string') return { ok: false, error: found }
      const { asker, child } = found
      const project = asker.project
      if (project.sessions.some((s) => s.parentId === child.id))
        return { ok: false, error: `"${child.name}" has open children of its own; close those first.` }

      if (!child.worktree) {
        await sessions.closeSession(project, child, false, false)
        return { ok: true, text: `Closed "${child.name}".` }
      }
      const base = await parentBranch(project, child)
      const st = await window.api.git.status(child.cwd, 'working', base ?? undefined).catch(() => null)
      const problems: string[] = []
      if (!st || st.error) problems.push(`its state could not be read${st?.error ? `: ${st.error}` : ''}`)
      else {
        if (st.files.length) problems.push(`${st.files.length} uncommitted files`)
        if (st.ahead) problems.push(`${st.ahead} commits not merged into ${base ?? 'its base'}`)
      }
      if (!problems.length) {
        await sessions.closeSession(project, child, true, true)
        return {
          ok: true,
          text: `Closed "${child.name}"; its worktree and branch ${child.worktree.branch} are removed.`,
        }
      }
      if (!request.force)
        return {
          ok: false,
          error: `Not closed: "${child.name}" has ${problems.join(' and ')}. Merge or commit first, or pass force to close it and keep the worktree and branch on disk.`,
        }
      await sessions.closeSession(project, child, false, false)
      return {
        ok: true,
        text: `Closed "${child.name}"; its worktree ${child.worktree.path} and branch ${child.worktree.branch} are kept (${problems.join(', ')}).`,
      }
    },
    [resolveChild, sessions],
  )

  const sendTo = useCallback(
    async (request: Extract<AgentToolRequest, { tool: 'send' }>): Promise<AgentToolResult> => {
      const found = resolveChild(request)
      if (typeof found === 'string') return { ok: false, error: found }
      const { child } = found
      const tab = child.terminals.find((x) => x.kind === 'agent')
      if (!tab) return { ok: false, error: `"${child.name}" has no agent tab to type into.` }
      if (!runtimeRef.current.awake.has(tab.id))
        return {
          ok: false,
          error: `The agent of "${child.name}" is not running; it starts when its session is opened on screen.`,
        }
      const multiline = /[\r\n]/.test(request.text)
      window.api.pty.input(tab.id, multiline ? PASTE_START + request.text + PASTE_END : request.text)
      await new Promise((r) => setTimeout(r, SUBMIT_DELAY_MS))
      window.api.pty.input(tab.id, '\r')
      return { ok: true, text: `Typed into "${child.name}" and submitted.` }
    },
    [resolveChild],
  )

  const read = useCallback(
    async (request: Extract<AgentToolRequest, { tool: 'read' }>): Promise<AgentToolResult> => {
      const found = resolveChild(request)
      if (typeof found === 'string') return { ok: false, error: found }
      const { child } = found
      const agentTabs = child.terminals.filter((x) => x.kind === 'agent')
      const tab = request.tab ? agentTabs.find((x) => x.id === request.tab) : agentTabs[0]
      if (!tab)
        return {
          ok: false,
          error: request.tab
            ? `"${child.name}" has no agent tab ${request.tab}.`
            : `"${child.name}" has no agent tab to read.`,
        }
      const agent = findAgent(stateRef.current.settings, tab.agentId)
      const kind = agent ? conversationKind(agent) : null
      if (!kind)
        return { ok: false, error: `The agent of "${child.name}" keeps no conversation Claude Studio can read.` }
      if (!tab.agentSessionId)
        return { ok: false, error: `"${child.name}" has no conversation yet: its agent has not started a turn.` }
      const configDir = tab.configDir ?? agent?.env.CLAUDE_CONFIG_DIR
      const log = await window.api.agents.readConversationLog(
        { id: tab.agentSessionId, kind, ...(configDir ? { configDir } : {}) },
        request.cursor ?? null,
      )
      if (!log.ok)
        return {
          ok: false,
          error:
            log.code === 'bad-cursor'
              ? `Not a cursor: "${request.cursor ?? ''}". Pass the one the previous answer ended with, or none to read from the start.`
              : `The conversation of "${child.name}" (${tab.agentSessionId}) was not found on disk; its agent may not have written anything yet.`,
        }
      const lines = [`[Claude Studio] "${child.name}", ${kind} conversation ${tab.agentSessionId}`]
      if (log.restarted)
        lines.push(
          'The cursor belongs to an earlier conversation of this tab (after /clear) or a replaced file; read from the start.',
        )
      lines.push(log.text || '(nothing new)')
      lines.push(
        log.more
          ? `cursor: ${log.cursor} - truncated at 20 KB, more is waiting: call read_session again with this cursor.`
          : `cursor: ${log.cursor}`,
      )
      return { ok: true, text: lines.join('\n') }
    },
    [resolveChild, stateRef],
  )

  const carryOut = useCallback(
    (request: AgentToolRequest): Promise<AgentToolResult> => {
      switch (request.tool) {
        case 'open':
          return open(request)
        case 'list':
          return list(request)
        case 'close':
          return close(request)
        case 'send':
          return sendTo(request)
        case 'read':
          return read(request)
      }
    },
    [close, list, open, read, sendTo],
  )

  useEffect(() => {
    return window.api.agents.onToolRequest((request) => {
      queue.current = queue.current.then(async () => {
        let result: AgentToolResult
        try {
          result = await carryOut(request)
        } catch (e) {
          result = { ok: false, error: `Claude Studio failed: ${String(e)}` }
        }
        // an answer that never arrives is the agent's call hanging until its own timeout, so the
        // reply is written whatever happened above
        await window.api.agents.replyToolRequest(request.id, result)
      })
    })
  }, [carryOut])
}
