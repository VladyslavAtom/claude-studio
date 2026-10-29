/**
 * GitHub CLI. Not part of the git layer: `gh` is a separate tool with its own auth and its own
 * failure modes, and only the spawn wrapper is shared with git — without the cleaned
 * environment a GIT_DIR left by an agent terminal would point «gh pr create» at another repo.
 */
import type { BranchPrs, CheckOutcome, OpResult, PrChecks, PrInfo, PrState } from '../shared/types'
import { cleanGitEnv } from './env'
import type { GitRunResult } from './git/exec'
import { fail, git, refuse, run } from './git/exec'

export async function createPullRequest(
  cwd: string,
  title: string,
  body: string,
  baseRef: string,
): Promise<OpResult & { url?: string }> {
  const args = ['pr', 'create', '--fill', '--base', baseRef]
  if (title) args.push('--title', title)
  if (body) args.push('--body', body)
  // gh goes through the same runner as git: without the cleaned environment a GIT_DIR left by
  // an agent terminal would point «gh pr create» at another repository
  const r = await run('gh', cwd, args, 300_000, cleanGitEnv())
  const url = r.stdout
    .trim()
    .split('\n')
    .find((l) => l.startsWith('http'))
  if (url) return { ok: true, url }
  // gh's own complaint when it made one; otherwise all we know is that no URL came back
  const failed = fail(r)
  return failed.error || failed.code ? failed : refuse({ code: 'pr-create-no-url' })
}

// ── PR and CI status of session branches ─────────────────────────────────────────────────────
//
// Read-only and optional. The renderer asks on events it already has; this side keeps what
// GitHub said per branch and asks again only when the answer can have changed, so a burst of
// refreshes costs local git calls, not API requests. Any failure answers «nothing to show».

/** a pending answer is not asked again sooner than this, however many events arrive */
export const PENDING_MIN_MS = 20_000
/** «no PR yet»: one may be opened by an agent's own `gh pr create`, without a push */
export const NO_PR_TTL_MS = 2 * 60_000
/** settled checks on the same upstream sha: only the PR state (merged, closed) can still move */
export const SETTLED_TTL_MS = 10 * 60_000

/** why `gh` gave nothing; each one pauses asking for a while instead of failing every refresh */
export type GhBlock = 'missing' | 'no-remote' | 'auth' | 'rate-limit' | 'failed'

const BLOCK_MS: Record<GhBlock, number> = {
  missing: 30 * 60_000,
  'no-remote': 30 * 60_000,
  auth: 10 * 60_000,
  'rate-limit': 5 * 60_000,
  failed: 2 * 60_000,
}
/** repeated rate limiting doubles the pause, up to this */
const RATE_LIMIT_MAX_MS = 60 * 60_000

export interface CachedPr {
  /** the upstream commit the answer was taken for */
  sha: string
  at: number
  pr: PrInfo | null
}

/** checks still running on a PR that can still change */
export function isPending(pr: PrInfo): boolean {
  return (pr.state === 'open' || pr.state === 'draft') && (pr.checks?.pending ?? 0) > 0
}

/**
 * Whether a branch has to be asked about again. A moved upstream always asks; otherwise how
 * long an answer holds depends on what it said.
 */
export function needsAsk(cached: CachedPr | undefined, sha: string, now: number, force = false): boolean {
  if (force || !cached || cached.sha !== sha) return true
  const age = now - cached.at
  if (!cached.pr) return age >= NO_PR_TTL_MS
  if (isPending(cached.pr)) return age >= PENDING_MIN_MS
  return age >= SETTLED_TTL_MS
}

/** a gh failure, sorted by what to do about it */
export function classifyGhFailure(r: Pick<GitRunResult, 'stderr' | 'code' | 'message'>): GhBlock {
  if (r.message?.code === 'git-not-found') return 'missing'
  const text = r.stderr
  if (/rate limit|abuse detection/i.test(text)) return 'rate-limit'
  // gh's «no GitHub remote» text also tells the user to run `gh auth login`: it is checked first
  if (/none of the git remotes|no git remotes|not a git repository|could not determine|no default remote/i.test(text))
    return 'no-remote'
  if (r.code === 4 || /gh auth login|bad credentials|HTTP 401|authentication/i.test(text)) return 'auth'
  return 'failed'
}

/** the remote branch the checked-out branch tracks */
export interface UpstreamTarget {
  /** the branch name on the remote: what a PR's head is called */
  head: string
  /** the commit the remote-tracking ref points at */
  sha: string
}

export const UPSTREAM_FORMAT = '%(HEAD)%00%(refname)%00%(objectname)%00%(upstream)%00%(upstream:remoteref)'

/**
 * The checked-out branch's upstream, or null: detached, never pushed, tracking a local branch,
 * or its remote branch is gone. Each line is `*|space NUL refname NUL sha NUL upstream NUL remoteref`.
 */
export function parseUpstream(stdout: string): UpstreamTarget | null {
  const shas = new Map<string, string>()
  let current: { upstream: string; remoteRef: string } | null = null
  for (const line of stdout.split('\n')) {
    const [mark, ref, sha, upstream, remoteRef] = line.split('\0')
    if (!ref || !sha) continue
    shas.set(ref, sha)
    if (mark === '*') current = { upstream: upstream ?? '', remoteRef: remoteRef ?? '' }
  }
  if (!current || !current.upstream.startsWith('refs/remotes/')) return null
  if (!current.remoteRef.startsWith('refs/heads/')) return null
  const sha = shas.get(current.upstream)
  if (!sha) return null
  return { head: current.remoteRef.slice('refs/heads/'.length), sha }
}

const CHECK_LIMIT = 100

/** one query for every branch of a repository: an alias per branch, the names passed as variables */
export function prQuery(count: number): string {
  const vars = Array.from({ length: count }, (_, i) => `$h${i}:String!`).join(',')
  const fields = Array.from(
    { length: count },
    (_, i) => `b${i}:pullRequests(headRefName:$h${i},first:1,orderBy:{field:CREATED_AT,direction:DESC}){nodes{...pr}}`,
  ).join(' ')
  return (
    `query($owner:String!,$name:String!,${vars}){repository(owner:$owner,name:$name){${fields}}}` +
    ' fragment pr on PullRequest{number state isDraft url commits(last:1){nodes{commit{statusCheckRollup{' +
    `contexts(first:${CHECK_LIMIT}){totalCount nodes{__typename ... on CheckRun{name status conclusion detailsUrl}` +
    ' ... on StatusContext{context state targetUrl}}}}}}}}'
  )
}

/** a check as GraphQL returns it: a CheckRun (Actions) or a StatusContext (commit status API) */
export interface RawContext {
  __typename?: string
  name?: string
  status?: string
  conclusion?: string | null
  detailsUrl?: string | null
  context?: string
  state?: string
  targetUrl?: string | null
}

interface RawPr {
  number?: number
  state?: string
  isDraft?: boolean
  url?: string
  commits?: {
    nodes?: {
      commit?: { statusCheckRollup?: { contexts?: { totalCount?: number; nodes?: RawContext[] } } | null }
    }[]
  }
}

const FAILED_CONCLUSIONS = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'STALE',
  'ERROR',
])

/** the bucket `gh pr checks` puts a check run or a commit status in */
export function checkOutcome(c: RawContext): CheckOutcome {
  if (c.__typename === 'StatusContext') {
    if (c.state === 'SUCCESS') return 'pass'
    if (c.state === 'FAILURE' || c.state === 'ERROR') return 'fail'
    return 'pending'
  }
  if (c.status !== 'COMPLETED') return 'pending'
  if (c.conclusion === 'SUCCESS') return 'pass'
  if (c.conclusion === 'SKIPPED' || c.conclusion === 'NEUTRAL') return 'skipped'
  return c.conclusion && FAILED_CONCLUSIONS.has(c.conclusion) ? 'fail' : 'pending'
}

function prState(raw: RawPr): PrState {
  if (raw.state === 'MERGED') return 'merged'
  if (raw.state === 'CLOSED') return 'closed'
  return raw.isDraft ? 'draft' : 'open'
}

export function toPrInfo(raw: RawPr | undefined): PrInfo | null {
  if (!raw || typeof raw.number !== 'number' || !raw.url) return null
  const contexts = raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts
  const nodes = contexts?.nodes ?? []
  let checks: PrChecks | null = null
  if (nodes.length) {
    const counted: PrChecks = {
      pass: 0,
      fail: 0,
      pending: 0,
      skipped: 0,
      items: [],
      truncated: (contexts?.totalCount ?? 0) > nodes.length,
    }
    for (const c of nodes) {
      const outcome = checkOutcome(c)
      counted[outcome]++
      const status = c.__typename === 'StatusContext'
      const url = (status ? c.targetUrl : c.detailsUrl) || undefined
      counted.items.push({ name: (status ? c.context : c.name) ?? '?', outcome, ...(url ? { url } : {}) })
    }
    checks = counted
  }
  return { number: raw.number, state: prState(raw), url: raw.url, checks }
}

/** `{data:{repository:{b0:{nodes:[…]},…}}}` → the PR per alias index; null when the shape is not that */
export function parsePrResponse(stdout: string, count: number): (PrInfo | null)[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  const repo = (parsed as { data?: { repository?: Record<string, { nodes?: RawPr[] } | null> | null } } | null)?.data
    ?.repository
  if (!repo) return null
  return Array.from({ length: count }, (_, i) => toPrInfo(repo[`b${i}`]?.nodes?.[0]))
}

const cache = new Map<string, CachedPr>()
/** pauses: per repository for what is the repository's own, under `''` for gh as a whole */
const blockedUntil = new Map<string, number>()
let rateLimitMs = BLOCK_MS['rate-limit']

/** a missing binary, a sign-in and the rate limit (it is per account) pause gh as a whole */
function blockKey(kind: GhBlock, repo: string): string {
  return kind === 'no-remote' || kind === 'failed' ? repo : ''
}

function pause(kind: GhBlock, repo: string, now: number): void {
  let ms = BLOCK_MS[kind]
  if (kind === 'rate-limit') {
    ms = rateLimitMs
    rateLimitMs = Math.min(rateLimitMs * 2, RATE_LIMIT_MAX_MS)
  }
  blockedUntil.set(blockKey(kind, repo), now + ms)
}

function paused(repo: string, now: number): boolean {
  return (blockedUntil.get('') ?? 0) > now || (blockedUntil.get(repo) ?? 0) > now
}

interface Target extends UpstreamTarget {
  cwd: string
  /** the common git directory: worktrees of one repository share it, and share one query */
  repo: string
}

async function targetOf(cwd: string): Promise<Target | null> {
  const [dir, refs] = await Promise.all([
    git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 15_000),
    git(cwd, ['for-each-ref', `--format=${UPSTREAM_FORMAT}`, 'refs/heads', 'refs/remotes'], 15_000),
  ])
  if (dir.code !== 0 || refs.code !== 0) return null
  const up = parseUpstream(refs.stdout)
  return up ? { ...up, cwd, repo: dir.stdout.trim() } : null
}

/** ask GitHub about `heads` of one repository and cache the answers; false when nothing came back */
async function askRepo(repo: string, list: Target[], heads: string[], now: number): Promise<boolean> {
  const first = list[0]
  if (!first) return false
  const args = ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-f', `query=${prQuery(heads.length)}`]
  heads.forEach((h, i) => args.push('-f', `h${i}=${h}`))
  const r = await run('gh', first.cwd, args, 30_000, { ...cleanGitEnv(), GH_PROMPT_DISABLED: '1' })
  const prs = r.code === 0 ? parsePrResponse(r.stdout, heads.length) : null
  if (!prs) {
    pause(r.code === 0 ? 'failed' : classifyGhFailure(r), repo, now)
    return false
  }
  rateLimitMs = BLOCK_MS['rate-limit']
  heads.forEach((head, i) => {
    const sha = list.find((t) => t.head === head)?.sha ?? ''
    cache.set(`${repo}\0${head}`, { sha, at: now, pr: prs[i] ?? null })
  })
  return true
}

/**
 * The PR of each directory's branch. One `gh api graphql` per repository at most, covering only
 * the branches whose answer may have changed (`needsAsk`); the rest come from the cache.
 * `force` re-asks every branch given — the app has just opened a PR and knows the answer moved.
 */
export async function branchPrs(cwds: string[], force = false): Promise<BranchPrs> {
  const now = Date.now()
  const targets = (await Promise.all(cwds.map(targetOf))).filter((t): t is Target => t !== null)
  const byRepo = new Map<string, Target[]>()
  for (const t of targets) byRepo.set(t.repo, [...(byRepo.get(t.repo) ?? []), t])

  const out: BranchPrs = {}
  await Promise.all(
    [...byRepo].map(async ([repo, list]) => {
      if (paused(repo, now)) return
      const stale = list.filter((t) => needsAsk(cache.get(`${repo}\0${t.head}`), t.sha, now, force))
      const heads = [...new Set(stale.map((t) => t.head))]
      if (heads.length && !(await askRepo(repo, list, heads, now))) return
      for (const t of list) {
        const hit = cache.get(`${repo}\0${t.head}`)
        if (hit && hit.sha === t.sha) out[t.cwd] = hit.pr
      }
    }),
  )
  return out
}
