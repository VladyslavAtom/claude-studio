/**
 * Which worktrees a session worked in, read from its agents' own transcripts.
 *
 * Agents make worktrees themselves and then work in them with `cd <worktree> && …` per command,
 * so the `cwd` a transcript records stays the main folder: the worktree shows up in the tool
 * calls' inputs instead. Both are read. A linked worktree counts from either; a main working copy
 * only from `cwd` — its path is the prefix of every in-repo worktree and of half the commands a
 * session runs, so as a mention it says nothing.
 *
 * Matching is by the longest path: `/repo/.worktrees/x/src` belongs to `/repo/.worktrees/x`,
 * and `/repo-x` is not `/repo`. Tool results are not read: a `git worktree list` printed into
 * one names every worktree and means none of them.
 *
 * The journals only grow, so each file is read once: a byte cursor per file is kept with the
 * counts so far, and the next call reads only what was appended. A changed set of worktrees
 * (one was made or removed) starts the file over: bytes already read were not matched against it.
 */
import { promises as fs } from 'node:fs'
import type { WorktreeMention } from '../shared/types'
import { ownerOf } from '../shared/worktrees'

/** the worktrees a transcript is matched against */
export interface Candidates {
  /** linked worktrees: matched in tool inputs and in `cwd` */
  linked: readonly string[]
  /** main working copies: matched in `cwd` only */
  main: readonly string[]
  /** both, for the longest-path owner of a `cwd` */
  all: readonly string[]
  /** a tool input mentions a linked worktree; null when there is none */
  re: RegExp | null
  /** every linked path starts with this: a line without it is not parsed at all */
  prefix: string
  /** names the set: counts kept for another set are not reused */
  key: string
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * One regex for all the paths, longest first, so that at any position the longest path wins:
 * `mad-382-prod` before `mad-382`. A path counts only as a whole: the character after it is not
 * one a file name continues with, and the one before it does not make it part of a longer path.
 */
export function pathMatcher(paths: readonly string[]): RegExp | null {
  if (!paths.length) return null
  const alts = [...paths].sort((a, b) => b.length - a.length).map(escapeRe)
  return new RegExp(`(?<![\\w./-])(?:${alts.join('|')})(?![\\w.-])`, 'g')
}

function commonPrefix(paths: readonly string[]): string {
  const [first, ...rest] = paths
  if (first === undefined) return ''
  let p = first
  for (const s of rest) while (!s.startsWith(p)) p = p.slice(0, -1)
  return p.slice(0, p.lastIndexOf('/') + 1)
}

export function candidates(linked: readonly string[], main: readonly string[]): Candidates {
  const l = [...new Set(linked)].sort()
  const m = [...new Set(main)].sort()
  return {
    linked: l,
    main: m,
    all: [...l, ...m],
    re: pathMatcher(l),
    prefix: commonPrefix(l),
    key: `${l.join('\0')}\u0001${m.join('\0')}`,
  }
}

export type Tally = Map<string, { mentions: number; lastAt: number }>

function bump(tally: Tally, path: string, at: number): void {
  const cur = tally.get(path)
  if (cur) {
    cur.mentions++
    if (at > cur.lastAt) cur.lastAt = at
  } else tally.set(path, { mentions: 1, lastAt: at })
}

/** what one record says about where the work happened */
export interface RecordFacts {
  /** the inputs of the tool calls it makes, as text */
  inputs: string[]
  cwds: string[]
  /** ms; 0 when the record has no time */
  at: number
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v))

const timeOf = (v: unknown): number => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : 0
}

export function recordFacts(record: Record<string, unknown>, kind: 'claude' | 'codex'): RecordFacts {
  const at = timeOf(record.timestamp)
  const inputs: string[] = []
  const cwds: string[] = []
  if (kind === 'claude') {
    if (typeof record.cwd === 'string') cwds.push(record.cwd)
    if (record.type === 'assistant') {
      const content = (record.message as { content?: unknown } | undefined)?.content
      if (Array.isArray(content))
        for (const c of content) {
          const b = c as { type?: unknown; input?: unknown }
          if (b.type === 'tool_use') inputs.push(textOf(b.input))
        }
    }
    return { inputs, cwds, at }
  }
  const p = record.payload as Record<string, unknown> | undefined
  if (!p) return { inputs, cwds, at }
  if ((record.type === 'session_meta' || record.type === 'turn_context') && typeof p.cwd === 'string') cwds.push(p.cwd)
  if (record.type === 'response_item') {
    if (p.type === 'function_call') inputs.push(textOf(p.arguments))
    else if (p.type === 'custom_tool_call') inputs.push(textOf(p.input))
    else if (p.type === 'local_shell_call') inputs.push(textOf(p.action))
  }
  return { inputs, cwds, at }
}

export function tallyRecord(facts: RecordFacts, c: Candidates, tally: Tally): void {
  if (c.re) for (const input of facts.inputs) for (const m of input.matchAll(c.re)) bump(tally, m[0], facts.at)
  for (const cwd of facts.cwds) {
    const owner = ownerOf(cwd, c.all)
    if (owner) bump(tally, owner, facts.at)
  }
}

/** the string value of a top-level-looking `"key":"…"` in raw JSON, unescaped; null when absent */
export function rawField(line: string, key: string): string | null {
  const marker = `"${key}":"`
  const start = line.indexOf(marker)
  if (start === -1) return null
  let i = start + marker.length
  for (; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') i++
    else if (ch === '"') break
  }
  try {
    return JSON.parse(line.slice(start + marker.length - 1, i + 1)) as string
  } catch {
    return null
  }
}

/**
 * One journal line. Most lines name no linked worktree at all and are not parsed: their `cwd` is
 * read straight from the text, and it can only be a main working copy or nothing of ours.
 */
export function tallyLine(line: string, kind: 'claude' | 'codex', c: Candidates, tally: Tally): void {
  const hit = c.re !== null && line.includes(c.prefix) && new RegExp(c.re.source).test(line)
  if (hit) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      return
    }
    if (typeof record === 'object' && record !== null)
      tallyRecord(recordFacts(record as Record<string, unknown>, kind), c, tally)
    return
  }
  const cwd = rawField(line, 'cwd')
  if (!cwd) return
  const owner = ownerOf(cwd, c.all)
  if (owner) bump(tally, owner, timeOf(rawField(line, 'timestamp')))
}

/**
 * The counts of several transcripts as one list: linked worktrees first, the most named first
 * (the primary one leads; the latest mention breaks a tie), then the main working copies.
 *
 * Not «the most recent first»: measured on a real session, its agent spent 678 mentions in its
 * task's worktree and then 9 in a side worktree a day later, and «most recent» made the side one
 * primary. One look into another folder must not move the panels there.
 */
export function mentionsOf(tallies: readonly Tally[], c: Candidates): WorktreeMention[] {
  const sum: Tally = new Map()
  for (const t of tallies)
    for (const [path, v] of t) {
      const cur = sum.get(path)
      if (cur) {
        cur.mentions += v.mentions
        cur.lastAt = Math.max(cur.lastAt, v.lastAt)
      } else sum.set(path, { ...v })
    }
  const main = new Set(c.main)
  return [...sum]
    .map(([path, v]) => ({ path, mentions: v.mentions, lastAt: v.lastAt }))
    .sort(
      (a, b) => Number(main.has(a.path)) - Number(main.has(b.path)) || b.mentions - a.mentions || b.lastAt - a.lastAt,
    )
}

// ── Reading the files, once ──────────────────────────────────────────────────────────────────

interface FileScan {
  key: string
  /** the first byte not read yet: always a line start */
  offset: number
  tally: Tally
}

/** a few hundred conversations at most per window; the oldest scan goes first */
const SCANS_MAX = 1000
const scans = new Map<string, FileScan>()
const CHUNK_BYTES = 256 * 1024
const NEWLINE = 0x0a

/**
 * The counts of one transcript, reading only what was appended since the last call. A last line
 * without its newline is still being written: it is left for the next call.
 */
export async function scanTranscript(file: string, kind: 'claude' | 'codex', c: Candidates): Promise<Tally> {
  let size: number
  try {
    size = (await fs.stat(file)).size
  } catch {
    return new Map()
  }
  let scan = scans.get(file)
  if (!scan || scan.key !== c.key || size < scan.offset) scan = { key: c.key, offset: 0, tally: new Map() }
  scans.delete(file)
  if (size > scan.offset) {
    const handle = await fs.open(file, 'r')
    try {
      let pos = scan.offset
      let pending = Buffer.alloc(0)
      for (;;) {
        const chunk = Buffer.alloc(CHUNK_BYTES)
        const { bytesRead } = await handle.read(chunk, 0, CHUNK_BYTES, pos)
        if (bytesRead === 0) break
        pos += bytesRead
        pending = pending.length ? Buffer.concat([pending, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead)
        let from = 0
        for (let nl = pending.indexOf(NEWLINE, from); nl !== -1; nl = pending.indexOf(NEWLINE, from)) {
          const line = pending.subarray(from, nl).toString('utf8')
          if (line.startsWith('{')) tallyLine(line, kind, c, scan.tally)
          scan.offset += nl + 1 - from
          from = nl + 1
        }
        pending = pending.subarray(from)
      }
    } finally {
      await handle.close()
    }
  }
  scans.set(file, scan)
  if (scans.size > SCANS_MAX) {
    const oldest = scans.keys().next().value
    if (oldest !== undefined) scans.delete(oldest)
  }
  return scan.tally
}
