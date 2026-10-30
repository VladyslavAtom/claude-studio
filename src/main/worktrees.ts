/**
 * The worktrees of a project, the ones agents made themselves included: which exist, which of
 * them each session worked in, what removing one would lose, and the removal itself.
 *
 * Read on events the renderer already has (a project opened, focus, a turn end, a write); there is
 * no timer here. The removal checks again everything the renderer showed: a worktree someone works
 * in is never removed, and one that is not safe goes only with `force`, which the renderer sends
 * after the person confirmed a dialog naming what would be lost.
 */
import { promises as fs } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import type {
  OpResult,
  ProjectWorktrees,
  RepoWorktree,
  RepoWorktrees,
  SessionTranscripts,
  WorktreeRemoveRequest,
  WorktreeStatus,
} from '../shared/types'
import { ownerOf, safeToRemove } from '../shared/worktrees'
import { conversationFile, liveClaudeCwds } from './agentSessions'
import * as files from './files'
import { branchPrs } from './gh'
import { refuse } from './git/exec'
import { listRepoWorktrees, remoteDefaultRef, removeLinkedWorktree, repoRoot, worktreeGitFacts } from './git'
import { liveCwds } from './pty'
import { candidates, mentionsOf, scanTranscript, type Tally } from './worktreeAttribution'

/**
 * The repositories of a project: the project folder when it is one, else its direct child
 * folders that are. A child that is itself a linked worktree of another child lands in the same
 * repository, which is keyed by its main working copy.
 */
export async function projectRepos(projectPath: string): Promise<RepoWorktrees[]> {
  const top = await repoRoot(projectPath)
  let dirs: string[]
  if (top) dirs = [top]
  else {
    const entries = await fs.readdir(projectPath, { withFileTypes: true }).catch(() => [])
    dirs = []
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const dir = join(projectPath, e.name)
      try {
        await fs.access(join(dir, '.git'))
        dirs.push(dir)
      } catch {
        /* not a repository */
      }
    }
  }
  const byMain = new Map<string, RepoWorktrees>()
  for (const dir of dirs) {
    const list = await listRepoWorktrees(dir)
    const main = list.find((w) => w.isMain)
    const repo = main?.path ?? list[0]?.path
    if (!repo || byMain.has(repo)) continue
    byMain.set(repo, { repo, worktrees: list })
  }
  return [...byMain.values()]
}

/** a worktree whose directory is gone is listed, but nothing reads it and it owns no path */
const usable = (w: RepoWorktree): boolean => !w.prunable

/**
 * The project's worktrees and, per session, the ones its conversations worked in. Every worktree
 * found becomes readable for `files:*`: the panels of a session follow its worktree there.
 */
export async function listProjectWorktrees(
  projectPath: string,
  sessions: readonly SessionTranscripts[],
): Promise<ProjectWorktrees> {
  const repos = await projectRepos(projectPath)
  const all = repos.flatMap((r) => r.worktrees).filter(usable)
  for (const w of all) files.registerRoot(w.path)
  const c = candidates(
    all.filter((w) => !w.isMain).map((w) => w.path),
    all.filter((w) => w.isMain).map((w) => w.path),
  )
  const out: ProjectWorktrees = { repos, sessions: {} }
  for (const s of sessions) {
    const tallies: Tally[] = []
    for (const ref of s.refs) {
      const file = await conversationFile(ref).catch(() => null)
      if (file) tallies.push(await scanTranscript(file, ref.kind, c))
    }
    const mentions = mentionsOf(tallies, c)
    if (mentions.length) out.sessions[s.sessionId] = mentions
  }
  return out
}

/**
 * Where work is going on right now: every live terminal of this app, every running claude on the
 * machine, and what the renderer adds — the folders of its sessions and the primary worktree of
 * every session whose agent runs, which only it knows.
 */
async function livePaths(hints: readonly string[]): Promise<string[]> {
  const [ptys, claudes] = await Promise.all([liveCwds(), liveClaudeCwds().catch(() => [] as string[])])
  return [...ptys, ...claudes, ...hints].map((p) => resolvePath(p))
}

/** `path` is the worktree one of `live` stands in, by the longest-path rule over its repository */
function isLive(path: string, repoPaths: readonly string[], live: readonly string[]): boolean {
  return live.some((p) => ownerOf(p, repoPaths) === path)
}

/** a few at a time: a project of a hundred worktrees must not spawn four hundred processes at once */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const STATUS_PARALLEL = 4

/** what removing each of `paths` would lose; a path that is not a worktree of `repo` is left out */
export async function worktreeStatuses(
  items: readonly { repo: string; path: string }[],
  hints: readonly string[],
): Promise<WorktreeStatus[]> {
  const live = await livePaths(hints)
  const byRepo = new Map<string, string[]>()
  for (const it of items) byRepo.set(it.repo, [...(byRepo.get(it.repo) ?? []), it.path])
  const jobs: { wt: RepoWorktree; repoPaths: string[]; defaultRef: string | null }[] = []
  for (const [repo, paths] of byRepo) {
    const list = (await listRepoWorktrees(repo)).filter(usable)
    const defaultRef = await remoteDefaultRef(repo)
    const repoPaths = list.map((w) => w.path)
    for (const wt of list) if (paths.includes(wt.path)) jobs.push({ wt, repoPaths, defaultRef })
  }
  const [facts, prs] = await Promise.all([
    mapLimit(jobs, STATUS_PARALLEL, (j) => worktreeGitFacts(j.wt.path, j.defaultRef)),
    branchPrs(jobs.map((j) => j.wt.path)).catch(() => ({}) as Record<string, never>),
  ])
  return jobs.map((j, i) => {
    const f = facts[i] ?? { changed: null, unpushed: null, merged: false }
    const pr = prs[j.wt.path] ?? null
    const merged = f.merged || pr?.state === 'merged'
    const liveNow = isLive(j.wt.path, j.repoPaths, live)
    const status = { ...f, merged, pr, live: liveNow }
    return { path: j.wt.path, ...status, safe: safeToRemove({ ...status, isMain: j.wt.isMain, locked: j.wt.locked }) }
  })
}

/**
 * One worktree and its local branch. Everything is checked again here rather than trusted from
 * the renderer's last look: the path is a linked worktree of that repository, nobody works in it,
 * and — without `force` — it is still safe. The branch is the one git lists for it now.
 */
export async function removeProjectWorktree(
  req: WorktreeRemoveRequest,
  hints: readonly string[],
): Promise<OpResult & { warning?: string }> {
  const list = (await listRepoWorktrees(req.repo)).filter(usable)
  const target = resolvePath(req.path)
  const wt = list.find((w) => resolvePath(w.path) === target)
  if (!wt || wt.isMain) return refuse({ code: 'worktree-not-removable', params: { path: req.path } })
  const [status] = await worktreeStatuses([{ repo: req.repo, path: wt.path }], hints)
  if (!status) return refuse({ code: 'worktree-not-removable', params: { path: req.path } })
  if (status.live) return refuse({ code: 'worktree-live', params: { path: wt.path } })
  if (!req.force && !status.safe) return refuse({ code: 'worktree-not-safe', params: { path: wt.path } })
  return removeLinkedWorktree(req.repo, wt.path, wt.branch, req.force)
}
