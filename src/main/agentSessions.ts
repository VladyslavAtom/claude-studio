/**
 * The agents' own stores, read for what only they know: the title of a conversation, whether it
 * exists at all, what else was started under a project's path — and, for a claude that is running
 * right now, what it says it is doing (`agentActivity`).
 *
 * **Which conversation a tab is in is not asked here any more.** Both CLIs report that
 * themselves now (see `agentHooks`), and the guess this file used to make for codex — newest
 * `threads` row with a matching `cwd`, polled every 2.5 s — could only ever be a guess: two
 * codex tabs in one directory write rows that are identical apart from their timestamps.
 *
 * Claude keeps a file per conversation under `<CLAUDE_CONFIG_DIR>/projects/`; codex keeps an
 * index, `$CODEX_HOME/state_<n>.sqlite`, table `threads`.
 */
import { promises as fs } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import type { AgentActivity, ExternalSession, ExternalSessionQuery } from '../shared/types'

/**
 * A Claude profile may be set not by the agent's settings but by the agent's own wrapper (a
 * script like `claude-1` that exports CLAUDE_CONFIG_DIR). So a conversation is looked for in
 * the given directory first, and then across every neighbouring profile.
 */
async function claudeHomes(preferred?: string): Promise<string[]> {
  const homes: string[] = []
  if (preferred) homes.push(preferred)
  homes.push(join(homedir(), '.claude'))
  try {
    for (const name of await fs.readdir(homedir())) {
      if (!/^\.claude(-[\w.-]+)?$/.test(name)) continue
      const full = join(homedir(), name)
      try {
        await fs.access(join(full, 'projects'))
        homes.push(full)
      } catch {
        /* a directory with no conversations */
      }
    }
  } catch {
    /* the home directory is unreadable */
  }
  return [...new Set(homes)]
}

function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}

/** newest state_<n>.sqlite — the number is bumped by Codex on schema changes */
async function findStateDb(): Promise<string | null> {
  try {
    const entries = await fs.readdir(codexHome())
    const schemaOf = (name: string): number => Number(/\d+/.exec(name)?.[0] ?? 0)
    const dbs = entries.filter((n) => /^state_\d+\.sqlite$/.test(n)).sort((a, b) => schemaOf(b) - schemaOf(a))
    const [newest] = dbs
    return newest ? join(codexHome(), newest) : null
  } catch {
    return null
  }
}

/**
 * The name of the index file changes only along with Codex's schema, while it is asked for on
 * every poll of a tab — spending a readdir of $CODEX_HOME on that is pointless. What was found
 * is kept; it is re-read on a timer, and at once if opening the file failed (which means Codex
 * has replaced it).
 */
const STATE_DB_TTL_MS = 60_000
let cachedStateDb: { path: string | null; at: number } | null = null

async function stateDbPath(): Promise<string | null> {
  const now = Date.now()
  if (cachedStateDb && now - cachedStateDb.at < STATE_DB_TTL_MS) return cachedStateDb.path
  const found = await findStateDb()
  cachedStateDb = { path: found, at: now }
  return found
}

/**
 * The only way to reach Codex's index: open it for reading, hand it to `fn` and close it
 * whatever the outcome. Without the wrapper the opening and the `finally { db.close() }` were
 * written out four times, and any new query could easily forget to close the database.
 *
 * A failure (no file, a schema we do not know, a locked file) is `null`, not an exception: the
 * caller has nothing to show the user, the conversation simply is not found.
 */
async function withThreads<T>(fn: (db: import('node:sqlite').DatabaseSync) => T): Promise<T | null> {
  const path = await stateDbPath()
  if (!path) return null
  try {
    // node:sqlite ships with Electron's Node; read-only so Codex keeps full control of the file
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      return fn(db)
    } finally {
      db.close()
    }
  } catch {
    cachedStateDb = null // the path may have gone stale along with the schema — search again next time
    return null
  }
}

// ---------------------------------------------------------------------------
// Listing conversations that already exist in the agents' own stores, so the app
// can show them next to its own sessions instead of pretending they don't exist.
// ---------------------------------------------------------------------------

const HEAD_BYTES = 32 * 1024
const TAIL_BYTES = 64 * 1024
const MAX_PER_AGENT = 200

async function readChunk(file: string, from: 'head' | 'tail', size: number): Promise<string> {
  const handle = await fs.open(file, 'r')
  try {
    const stat = await handle.stat()
    const length = Math.min(size, stat.size)
    const position = from === 'head' ? 0 : Math.max(0, stat.size - length)
    const buf = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buf, 0, length, position)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

function parseLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      out.push(JSON.parse(trimmed) as Record<string, unknown>)
    } catch {
      // truncated first/last line of the chunk
    }
  }
  return out
}

function firstUserText(records: Record<string, unknown>[]): string | null {
  for (const r of records) {
    if (r.type !== 'user') continue
    const message = r.message as { content?: unknown } | undefined
    const content = message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const text = content.find((c) => (c as { type?: string }).type === 'text') as { text?: string } | undefined
      if (text?.text) return text.text
    }
  }
  return null
}

function shortTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 70 ? clean.slice(0, 69) + '…' : clean
}

/** how many conversation files are read at once: the disk can take it, and the wait halves */
const READ_CONCURRENCY = 12
/** one deadline for the whole answer: what did not make it is not shown, but the window is not held either */
const LIST_DEADLINE_MS = 4_000
/** entries in the parse cache: 200 conversations per profile, and a person has a handful of profiles */
const PARSE_CACHE_MAX = 800

/** an ordinary LRU over a Map: a Map keeps insertion order, so the oldest key comes first */
class Lru<K, V> {
  private readonly map = new Map<K, V>()

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      this.map.delete(oldest.value)
    }
  }

  delete(key: K): void {
    this.map.delete(key)
  }
}

interface HeadMeta {
  cwd: string | null
  startedAt: number | null
  aiTitle: string | null
  firstUser: string | null
}

/**
 * Parsing of the head and the tail of a conversation file. The file is a journal: as long as
 * mtime has not changed, neither the first nor the last line can have changed, so the result of
 * the parse is cached by the (path, mtime) pair. Without that every poll re-opened and re-parsed
 * up to 200 files per profile.
 */
const headCache = new Lru<string, { mtime: number; meta: HeadMeta }>(PARSE_CACHE_MAX)
const tailCache = new Lru<string, { mtime: number; title: string | null }>(PARSE_CACHE_MAX)

const lastAiTitle = (records: Record<string, unknown>[]): string | null => {
  const found = [...records].reverse().find((r) => r.type === 'ai-title' && typeof r.aiTitle === 'string')
  return found ? (found.aiTitle as string) : null
}

async function claudeHead(path: string, mtime: number): Promise<HeadMeta | null> {
  const cached = headCache.get(path)
  if (cached && cached.mtime === mtime) return cached.meta
  let records: Record<string, unknown>[]
  try {
    records = parseLines(await readChunk(path, 'head', HEAD_BYTES))
  } catch {
    return null // the file is gone or unreadable — the conversation simply is not there
  }
  const started = records.find((r) => typeof r.timestamp === 'string')?.timestamp as string | undefined
  const meta: HeadMeta = {
    cwd: (records.find((r) => typeof r.cwd === 'string')?.cwd as string | undefined) ?? null,
    startedAt: started ? Date.parse(started) : null,
    aiTitle: lastAiTitle(records),
    firstUser: firstUserText(records),
  }
  headCache.set(path, { mtime, meta })
  return meta
}

async function claudeTailTitle(path: string, mtime: number): Promise<string | null> {
  const cached = tailCache.get(path)
  if (cached && cached.mtime === mtime) return cached.title
  let title: string | null = null
  try {
    title = lastAiTitle(parseLines(await readChunk(path, 'tail', TAIL_BYTES)))
  } catch {
    return null
  }
  tailCache.set(path, { mtime, title })
  return title
}

/**
 * A walk with a concurrency limit and one shared deadline. Anything that did not manage to
 * start before the deadline stays out of the answer: showing some of the conversations beats
 * holding the window blocked.
 */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  deadline: number,
  fn: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const out: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length || Date.now() > deadline) return
      const item = items[i]
      if (item === undefined) continue // a hole in the array: nothing to hand to `fn`
      const value = await fn(item)
      if (value) out.push(value)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** `<CLAUDE_CONFIG_DIR>/projects/<slug>/<session-id>.jsonl`; cwd and title live inside the file */
async function listClaudeSessions(
  configDir: string,
  prefix: string,
  agentId: string,
  deadline: number,
): Promise<ExternalSession[]> {
  const projects = join(configDir, 'projects')
  let dirs: string[]
  try {
    dirs = await fs.readdir(projects)
  } catch {
    return []
  }

  const candidates: { path: string; id: string; mtime: number }[] = []
  for (const dir of dirs) {
    let files: string[]
    try {
      files = await fs.readdir(join(projects, dir))
    } catch {
      continue
    }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue
      const full = join(projects, dir, name)
      try {
        const st = await fs.stat(full)
        candidates.push({ path: full, id: name.replace(/\.jsonl$/, ''), mtime: st.mtimeMs })
      } catch {
        /* gone */
      }
    }
  }

  candidates.sort((a, b) => b.mtime - a.mtime)
  return mapLimited(candidates.slice(0, MAX_PER_AGENT), READ_CONCURRENCY, deadline, async (c) => {
    const head = await claudeHead(c.path, c.mtime)
    if (!head) return null
    const cwd = head.cwd
    if (!cwd || !(cwd === prefix || cwd.startsWith(prefix + '/'))) return null

    // the tail is read only for conversations that fit: for the others the head already answered
    const tailTitle = await claudeTailTitle(c.path, c.mtime)
    const title = head.aiTitle ?? tailTitle ?? head.firstUser ?? c.id.slice(0, 8)

    return {
      id: c.id,
      agentId,
      configDir,
      cwd,
      title: shortTitle(title),
      startedAt: head.startedAt ?? c.mtime,
      updatedAt: c.mtime,
    }
  })
}

async function listCodexSessions(prefix: string, agentId: string): Promise<ExternalSession[]> {
  const found = await withThreads((db) => {
    const rows = db
      .prepare(
        'select id, cwd, title, first_user_message, created_at_ms, updated_at_ms from threads ' +
          'where (cwd = ? or cwd like ?) and coalesce(archived, 0) = 0 ' +
          'order by coalesce(updated_at_ms, created_at_ms) desc limit ?',
      )
      .all(prefix, prefix + '/%', MAX_PER_AGENT) as {
      id: string
      cwd: string
      title?: string
      first_user_message?: string
      created_at_ms?: number
      updated_at_ms?: number
    }[]
    return rows.map((r) => ({
      id: r.id,
      agentId,
      cwd: r.cwd,
      title: shortTitle(r.title || r.first_user_message || r.id.slice(0, 8)),
      startedAt: r.created_at_ms ?? 0,
      updatedAt: r.updated_at_ms ?? r.created_at_ms ?? 0,
    }))
  })
  return found ?? []
}

/** conversations of every configured agent that were started anywhere under `projectPath` */
export async function listExternalSessions(
  projectPath: string,
  queries: ExternalSessionQuery[],
): Promise<ExternalSession[]> {
  const seen = new Set<string>()
  const out: ExternalSession[] = []
  const take = (found: ExternalSession[]): void => {
    for (const s of found) {
      // one and the same conversation can be reachable through two profiles
      if (seen.has(s.id)) continue
      seen.add(s.id)
      out.push(s)
    }
  }

  /**
   * Claude has no «show me your conversations» command, and the agent sets its own store
   * directory — the `claude-1` wrapper, for one, exports CLAUDE_CONFIG_DIR inside itself, and
   * there is no way to learn that from outside. So every ~/.claude* profile is read, and a
   * conversation is bound to an agent by directory when the settings name it explicitly; the
   * rest are marked with the profile's name.
   */
  const claudeQueries = queries.filter((q) => q.kind === 'claude')
  const [firstClaude] = claudeQueries
  if (firstClaude) {
    // one deadline for all profiles: the renderer waits on a single invoke, and that wait has to be bounded
    const deadline = Date.now() + LIST_DEADLINE_MS
    const byProfile = new Map<string, string>()
    for (const q of claudeQueries) if (q.configDir) byProfile.set(resolvePath(q.configDir), q.agentId)
    const fallback = firstClaude.agentId
    for (const home of await claudeHomes()) {
      const agentId = byProfile.get(resolvePath(home)) ?? fallback
      take(await listClaudeSessions(home, projectPath, agentId, deadline))
    }
  }

  for (const q of queries) {
    if (q.kind !== 'codex') continue
    take(await listCodexSessions(projectPath, q.agentId))
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** does this conversation actually exist in the agent's store? */
export async function sessionExists(kind: 'claude' | 'codex', id: string, configDir?: string): Promise<boolean> {
  if (!id) return false
  if (kind === 'codex') {
    const found = await withThreads((db) => Boolean(db.prepare('select 1 from threads where id = ? limit 1').get(id)))
    return found ?? false
  }

  return Boolean(await findClaudeConversation(id, configDir))
}

/**
 * `sessionTitle` and `sessionExists` pull on this lookup every few seconds per tab, and a full
 * pass is a readdir of the home directory, a readdir of `projects` in every profile and an
 * fs.access over every project directory. Once found, the path does not change while the
 * conversation lives, so it is cached by id and a hit only checks that the file is still in
 * place; a miss, or a file that has vanished, is the reason to rescan and refresh the cache.
 *
 * The cache is bounded in size: conversation ids come from other people's stores, tabs and
 * profiles are added over the whole life of the process, and an entry here does not go stale on
 * its own — without a limit the map would grow for as long as the application is open.
 */
const CONVERSATION_CACHE_MAX = 500
const conversationPathCache = new Lru<string, string>(CONVERSATION_CACHE_MAX)

/** the path to a conversation file across every known Claude profile */
async function findClaudeConversation(id: string, configDir?: string): Promise<string | null> {
  const cached = conversationPathCache.get(id)
  if (cached) {
    try {
      await fs.access(cached)
      return cached
    } catch {
      conversationPathCache.delete(id)
    }
  }

  for (const home of await claudeHomes(configDir)) {
    const projects = join(home, 'projects')
    let dirs: string[]
    try {
      dirs = await fs.readdir(projects)
    } catch {
      continue
    }
    for (const dir of dirs) {
      const file = join(projects, dir, `${id}.jsonl`)
      try {
        await fs.access(file)
        conversationPathCache.set(id, file)
        return file
      } catch {
        /* not in this project */
      }
    }
  }
  return null
}

/** what the agent itself called the conversation: the title from its store, not from the terminal title */
export async function sessionTitle(kind: 'claude' | 'codex', id: string, configDir?: string): Promise<string | null> {
  if (!id) return null

  if (kind === 'codex') {
    return withThreads((db) => {
      const row = db.prepare('select title, first_user_message from threads where id = ? limit 1').get(id) as
        { title?: string; first_user_message?: string } | undefined
      const text = row?.title || row?.first_user_message
      return text ? shortTitle(text) : null
    })
  }

  const file = await findClaudeConversation(id, configDir)
  if (file) {
    // the title is appended as the conversation goes on, so the last one from the file's tail is taken
    const tail = parseLines(await readChunk(file, 'tail', TAIL_BYTES))
    const head = parseLines(await readChunk(file, 'head', HEAD_BYTES))
    const pick = (records: Record<string, unknown>[], type: string, field: string): string | null => {
      const found = [...records].reverse().find((r) => r.type === type && typeof r[field] === 'string')
      return found ? (found[field] as string) : null
    }
    // first what the agent came up with, then the user's first message, and only after that the
    // hand-set name — that one may turn out to be our own old `-n`
    const title =
      pick(tail, 'ai-title', 'aiTitle') ??
      pick(head, 'ai-title', 'aiTitle') ??
      firstUserText(head) ??
      pick(head, 'custom-title', 'customTitle')
    return title ? shortTitle(title) : null
  }
  return null
}

// ---------------------------------------------------------------------------
// What a claude that is running right now says it is doing.
//
// A live CLI keeps a file per process, `<profile>/sessions/<pid>.json`, and rewrites it whenever
// its state changes; the file goes away with the process. It is undocumented, so everything here
// treats it as somebody else's file: a shape we do not recognise is «no answer», never an error.
//
// **The match is by session id, never by pid.** Our pty runs `$SHELL -i` and the agent is a
// grandchild of it, so the pid is not ours to know — but the file names the conversation, and the
// tab already follows that id through `/clear` (see `agentHooks`).
//
// **Not every live session writes one.** Measured on this machine: three real tabs all had a file
// at the same moment, under the same profile, while a `claude` driven by hand in a throwaway pty
// never produced one. What distinguishes them is not known, so the absence of a file is an
// ordinary case with an ordinary answer — null.
// ---------------------------------------------------------------------------

/**
 * A session id is compared against the tab's own and nothing else, so a file naming something
 * that cannot be one is not a file about a tab of ours.
 *
 * Written out rather than imported from `agentHooks`: that module pulls in electron for
 * `app.getPath`, and this one is plain file reading that a test can import as it is.
 */
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** the CLI's own set of status words, as of 2.1.220; a word outside it has no known meaning */
const ACTIVITIES: readonly AgentActivity[] = ['busy', 'shell', 'waiting', 'idle']

/** one `sessions/` entry, as far as it can be trusted */
export interface SessionState {
  sessionId: string
  /** the process the file is named after — what tells a live session from a crashed one's leftovers */
  pid: number
  /** the word the CLI wrote, when its meaning is known; null when it wrote one we have never seen */
  status: AgentActivity | null
  /** when that process started; how two files for one conversation are told apart. 0 if absent */
  startedAt: number
}

/**
 * One state file, as far as it can be trusted.
 *
 * What is required: an object, a `sessionId` that is a uuid, and a `pid` that is a positive
 * integer. Both are used — one to match the tab, one to ask whether the process is still there —
 * and a file missing either says nothing about any tab.
 *
 * What is deliberately tolerated: an unknown `status`. A later CLI may add a word, and the file
 * still identifies a live session correctly; the honest answer to a word we cannot interpret is
 * «no opinion» (`status: null`), which reads exactly like no file at all. Guessing at it would put
 * a wrong dot on the tab, which is the defect this whole path exists to fix.
 *
 * `cwd`, `name`, `version`, `entrypoint`, `kind`, `peerProtocol` and the rest are not read. The
 * name is the CLI's own wording for the conversation and there is already a place that reads
 * titles; `cwd` cannot bind a file to a tab (two tabs in one directory are identical there), and
 * the id does that job exactly.
 */
export function parseSessionState(raw: string): SessionState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null // half-written, or not JSON at all: the CLI is mid-rewrite
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  if (typeof o.sessionId !== 'string' || !SESSION_UUID.test(o.sessionId)) return null
  if (typeof o.pid !== 'number' || !Number.isInteger(o.pid) || o.pid <= 0) return null
  return {
    sessionId: o.sessionId,
    pid: o.pid,
    status: ACTIVITIES.find((s) => s === o.status) ?? null,
    startedAt: typeof o.startedAt === 'number' && Number.isFinite(o.startedAt) ? o.startedAt : 0,
  }
}

/**
 * Which of the files found is the one for this conversation.
 *
 * Two can name it at once: a CLI that crashed leaves its file behind (only an orderly exit
 * removes it), and the same conversation can then be resumed in a new process. So a file whose
 * process is gone is dropped outright — its `status` froze at whatever the CLI was doing when it
 * died, and a frozen `busy` would pin the tab to «running» for ever. Of what is left the newest
 * process wins: `startedAt` and not `statusUpdatedAt`, which moves only on transitions and would
 * therefore rank a session that has sat idle for an hour below one that changed state a second ago.
 *
 * `alive` is a parameter so that this stays a function of its arguments — the caller passes the
 * real test, a test passes a set of pids.
 */
export function pickSessionState(
  states: readonly SessionState[],
  sessionId: string,
  alive: (pid: number) => boolean,
): SessionState | null {
  let best: SessionState | null = null
  for (const state of states) {
    if (state.sessionId !== sessionId || !alive(state.pid)) continue
    if (!best || state.startedAt > best.startedAt) best = state
  }
  return best
}

/**
 * Does this process still exist? Signal 0 sends nothing and asks only that question; a pid that
 * belongs to somebody else answers EPERM, which is still «it exists».
 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Every live tab asks for this every 4 s, so neither the listing nor the parsing is repeated per
 * tab: a directory's contents are kept for a moment (shorter than one pass over the tabs, so a
 * pass sees one listing and the next pass a fresh one), and a file that has not been rewritten is
 * not read again — same as the conversation lookups above, keyed by (path, mtime, size).
 */
const SESSIONS_TTL_MS = 1_500
/** a handful of files per profile, a handful of profiles — this only has to outlive one pass */
const STATE_CACHE_MAX = 200
const stateCache = new Lru<string, { mtime: number; size: number; state: SessionState | null }>(STATE_CACHE_MAX)
const dirCache = new Map<string, { at: number; states: SessionState[] }>()

/** every state file of one profile. The CLI names them `<pid>.json`, and so does the filter */
async function readSessionsDir(dir: string): Promise<SessionState[]> {
  const now = Date.now()
  const cached = dirCache.get(dir)
  if (cached && now - cached.at < SESSIONS_TTL_MS) return cached.states

  const states: SessionState[] = []
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    // no `sessions/` in this profile: nothing has run under it, or it is not a profile at all
    dirCache.set(dir, { at: now, states })
    return states
  }
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue
    const path = join(dir, name)
    try {
      const st = await fs.stat(path)
      const hit = stateCache.get(path)
      if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) {
        if (hit.state) states.push(hit.state)
        continue
      }
      const state = parseSessionState(await fs.readFile(path, 'utf8'))
      stateCache.set(path, { mtime: st.mtimeMs, size: st.size, state })
      if (state) states.push(state)
    } catch {
      // the session ended between the listing and the read: it has no state any more
    }
  }
  dirCache.set(dir, { at: now, states })
  return states
}

/**
 * What the CLI in this conversation says it is doing, or null when nothing answers for it — no
 * file, a file we do not understand, a status word we have never seen, or a session that simply
 * does not write one. Null is an ordinary answer: the tab then goes on judging by its output,
 * exactly as every tab did before this existed.
 *
 * Every profile is searched, and for the same reason `findClaudeConversation` searches them all:
 * an agent's wrapper script can export `CLAUDE_CONFIG_DIR` itself, and there is no way to learn
 * that from outside. The tab's own directory, when it has one, is looked in first.
 */
export async function agentActivity(sessionId: string, configDir?: string): Promise<AgentActivity | null> {
  if (!sessionId || !SESSION_UUID.test(sessionId)) return null
  for (const home of await claudeHomes(configDir)) {
    const found = pickSessionState(await readSessionsDir(join(home, 'sessions')), sessionId, processAlive)
    if (found) return found.status
  }
  return null
}
