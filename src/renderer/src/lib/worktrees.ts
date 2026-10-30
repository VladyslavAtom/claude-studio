import type {
  ConversationRef,
  Project,
  ProjectWorktrees,
  RepoWorktree,
  Session,
  SessionTranscripts,
  Settings,
} from '../../../shared/types'
import { ownerOf, relativeTo } from '../../../shared/worktrees'
import { conversationKind, findAgent } from './agents'

/**
 * Which worktrees a session works in, as the session list and the panels show them. Main finds
 * the worktrees and reads the transcripts (`main/worktrees`); this side decides what a session
 * owns and which one its panels follow.
 */

/** a worktree as a session row and the panel switcher name it */
export interface ShownWorktree {
  path: string
  /** the repository's main working copy */
  repo: string
  /** null: detached HEAD */
  branch: string | null
  /** the folder named next to its repository: `.worktrees/x`, `../repo-x` */
  rel: string
}

/** every conversation a session had: its agent tabs and the runs they replaced */
export function sessionTranscripts(sessions: readonly Session[], settings: Settings): SessionTranscripts[] {
  return sessions.map((s) => {
    const refs: ConversationRef[] = []
    const add = (agentId: string | undefined, id: string | undefined, tabDir?: string): void => {
      if (!id || refs.some((r) => r.id === id)) return
      const agent = findAgent(settings, agentId)
      const kind = agent ? conversationKind(agent) : null
      if (!kind) return
      const configDir = tabDir ?? agent?.env.CLAUDE_CONFIG_DIR
      refs.push({ id, kind, ...(configDir ? { configDir } : {}) })
    }
    for (const tab of s.terminals) if (tab.kind === 'agent') add(tab.agentId, tab.agentSessionId, tab.configDir)
    for (const run of s.runs ?? []) add(run.agentId, run.agentSessionId)
    return { sessionId: s.id, refs }
  })
}

/** every worktree that has a folder, by path, with the repository it belongs to */
export function worktreeIndex(data: ProjectWorktrees | null): Map<string, { wt: RepoWorktree; repo: string }> {
  const out = new Map<string, { wt: RepoWorktree; repo: string }>()
  for (const r of data?.repos ?? [])
    for (const wt of r.worktrees) if (!wt.prunable) out.set(wt.path, { wt, repo: r.repo })
  return out
}

/**
 * The linked worktrees of a session, the primary one first: the session's own folder when that is
 * a worktree (Studio made it, or the session was opened there), then what its conversations named,
 * the most named first. A main working copy is never on this list: it is the «main folder».
 */
export function sessionWorktrees(session: Session, data: ProjectWorktrees | null): ShownWorktree[] {
  const index = worktreeIndex(data)
  const out: ShownWorktree[] = []
  const add = (path: string): void => {
    const hit = index.get(path)
    if (!hit || hit.wt.isMain || out.some((w) => w.path === path)) return
    out.push({ path, repo: hit.repo, branch: hit.wt.branch, rel: relativeTo(path, hit.repo) })
  }
  add(session.cwd)
  for (const m of data?.sessions[session.id] ?? []) add(m.path)
  return out
}

/** the folder a session was started in, and the branch checked out there when it is a worktree */
export function mainFolder(session: Session, data: ProjectWorktrees | null): { path: string; branch: string | null } {
  const index = worktreeIndex(data)
  const owner = ownerOf(session.cwd, [...index.keys()])
  return { path: session.cwd, branch: owner ? (index.get(owner)?.wt.branch ?? null) : null }
}

/**
 * The folder the panels show: the one picked in the switcher while it is still one of the
 * session's, else the primary worktree, else the session's own folder.
 */
export function viewPath(session: Session, list: readonly ShownWorktree[]): string {
  const pick = session.worktreeView
  if (pick && (pick === session.cwd || list.some((w) => w.path === pick))) return pick
  return list[0]?.path ?? session.cwd
}

/**
 * The session whose folder the panels show. A worktree other than its own is shown as a plain
 * folder: the session's base and branch (`worktree`) describe its own folder, not this one.
 */
export function viewSession(session: Session, path: string): Session {
  if (path === session.cwd) return session
  const { worktree: _own, ...rest } = session
  return { ...rest, cwd: path }
}

/**
 * Folders the removal guard must treat as in use, from what only the renderer knows: every
 * session's own folder (a session's worktree goes with «close session», not from here), and the
 * worktree the agent of a running session has touched.
 */
export function liveHints(
  projects: readonly Project[],
  awake: ReadonlySet<string>,
  data: ProjectWorktrees | null,
): string[] {
  const out = new Set<string>()
  for (const p of projects)
    for (const s of p.sessions) {
      out.add(s.cwd)
      // every folder a running agent has touched, not only its primary: it may go back to any
      if (s.terminals.some((t) => t.kind === 'agent' && awake.has(t.id)))
        for (const w of sessionWorktrees(s, data)) out.add(w.path)
    }
  return [...out]
}
