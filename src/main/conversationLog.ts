/**
 * What a conversation said and did since a given point, as compact text — the answer to the
 * `read_session` tool (see `main/agentTools`), which is how a lead agent follows its children.
 *
 * Both stores are append-only journals of JSON lines (Claude's `<profile>/projects/<dir>/<id>.jsonl`,
 * Codex's rollout file), so a **byte offset** is a complete cursor: the next read starts exactly
 * where the previous one stopped and costs only the bytes written since. The cursor names the
 * conversation as well (`<id>:<offset>`): after a `/clear` the tab is in a new conversation, and
 * an offset into the old file means nothing in the new one — that read starts over and says so.
 *
 * One line per event: a user prompt, the agent's text, a tool call (name and its most telling
 * argument), a tool result (clipped). Thinking, reasoning and the CLI's bookkeeping records are
 * left out — they are most of the bytes and none of the story.
 *
 * Bounded twice: the answer by `LOG_MAX_BYTES`, the work by `SCAN_MAX_BYTES`. Either bound stops
 * at a line boundary and the cursor points at the first line not yet told, so nothing is skipped —
 * the caller reads again.
 */
import { promises as fs } from 'node:fs'
import type { ConversationLogResult, ConversationRef } from '../shared/types'
import { conversationFile } from './agentSessions'

/** the most one answer carries, in bytes of UTF-8 */
export const LOG_MAX_BYTES = 20_000
/** the most one call reads from disk; a run of huge tool outputs is paged, not swallowed */
const SCAN_MAX_BYTES = 32 * 1024 * 1024
const CHUNK_BYTES = 256 * 1024

/** characters kept of one entry */
const TEXT_MAX = 2_000
const ARGS_MAX = 200
const RESULT_MAX = 300

const NEWLINE = 0x0a

export interface LogCursor {
  conversation: string
  offset: number
}

/** `<conversation id>:<byte offset>`; anything else is not a cursor of ours */
export function parseLogCursor(raw: string): LogCursor | null {
  const m = /^([\w-]{1,128}):(\d{1,15})$/.exec(raw.trim())
  if (!m?.[1] || !m[2]) return null
  const offset = Number(m[2])
  return Number.isSafeInteger(offset) ? { conversation: m[1], offset } : null
}

export function formatLogCursor(c: LogCursor): string {
  return `${c.conversation}:${c.offset}`
}

/** one line, at most `max` characters, with a mark where it was cut */
export function clip(text: string, max: number, oneLine = true): string {
  const s = (oneLine ? text.replace(/\s+/g, ' ') : text.replace(/\n{3,}/g, '\n\n')).trim()
  return s.length > max ? `${s.slice(0, max)}… [+${s.length - max} chars]` : s
}

/** the argument that says what a call did; the whole input only when none of these is there */
const TELLING_ARGS = ['command', 'cmd', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'skill']

function shortArgs(input: unknown): string {
  if (typeof input === 'string') {
    // codex hands some tools their input as JSON text, some as code
    try {
      return shortArgs(JSON.parse(input) as unknown)
    } catch {
      return clip(input, ARGS_MAX)
    }
  }
  if (typeof input !== 'object' || input === null) return ''
  const o = input as Record<string, unknown>
  for (const key of TELLING_ARGS) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) return clip(v, ARGS_MAX)
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return clip(v.join(' '), ARGS_MAX)
  }
  return clip(JSON.stringify(input), ARGS_MAX)
}

/** the text of a content array, whatever each CLI calls its text blocks */
function blockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const c of content) {
    const b = c as { type?: unknown; text?: unknown }
    if (typeof b.text === 'string' && (b.type === 'text' || b.type === 'input_text' || b.type === 'output_text'))
      parts.push(b.text)
  }
  return parts.join('\n')
}

function result(content: unknown, isError: boolean): string {
  const body = clip(blockText(content), RESULT_MAX)
  return `[result${isError ? ' error' : ''}] ${body || '(empty)'}`
}

/** the context codex injects as a «user» message; it is the CLI talking, not the user */
const CODEX_INJECTED = /^\s*<(environment_context|user_instructions|permissions|user_action)\b/

/** the lines one journal record contributes; none for everything that is not part of the story */
export function logLines(record: Record<string, unknown>, kind: 'claude' | 'codex'): string[] {
  if (kind === 'claude') {
    if (record.type !== 'user' && record.type !== 'assistant') return []
    // a subagent's turns and the CLI's injected context are not this conversation's words
    if (record.isSidechain === true || record.isMeta === true) return []
    const content = (record.message as { content?: unknown } | undefined)?.content
    if (typeof content === 'string') return content.trim() ? [`[${record.type}] ${clip(content, TEXT_MAX, false)}`] : []
    if (!Array.isArray(content)) return []
    const out: string[] = []
    for (const c of content) {
      const b = c as { type?: unknown; text?: unknown; name?: unknown; input?: unknown; content?: unknown }
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim())
        out.push(`[${record.type}] ${clip(b.text, TEXT_MAX, false)}`)
      else if (b.type === 'tool_use') out.push(`[tool] ${String(b.name)}: ${shortArgs(b.input)}`)
      else if (b.type === 'tool_result') out.push(result(b.content, (c as { is_error?: unknown }).is_error === true))
    }
    return out
  }

  if (record.type !== 'response_item') return []
  const p = record.payload as Record<string, unknown> | undefined
  if (!p) return []
  switch (p.type) {
    case 'message': {
      if (p.role !== 'user' && p.role !== 'assistant') return []
      const text = blockText(p.content)
      if (!text.trim() || (p.role === 'user' && CODEX_INJECTED.test(text))) return []
      return [`[${p.role}] ${clip(text, TEXT_MAX, false)}`]
    }
    case 'function_call':
      return [`[tool] ${String(p.name)}: ${shortArgs(p.arguments)}`]
    case 'custom_tool_call':
      return [`[tool] ${String(p.name)}: ${shortArgs(p.input)}`]
    case 'local_shell_call':
      return [`[tool] shell: ${shortArgs((p.action as { command?: unknown } | undefined)?.command ?? '')}`]
    case 'function_call_output':
    case 'custom_tool_call_output': {
      const out = p.output
      // a function's output is sometimes `{ content, success }` rather than the text itself
      if (typeof out === 'object' && out !== null && !Array.isArray(out)) {
        const o = out as { content?: unknown; success?: unknown }
        return [result(o.content, o.success === false)]
      }
      return [result(out, false)]
    }
    default:
      return []
  }
}

export interface LogRead {
  text: string
  /** the offset of the first line not told: where the next read starts */
  next: number
  /** stopped at a bound with more already on disk */
  more: boolean
}

/**
 * The lines from `offset` on. A last line without its newline is still being written: it is not
 * read, and the cursor stays in front of it.
 */
export async function readLog(
  path: string,
  kind: 'claude' | 'codex',
  offset: number,
  maxBytes = LOG_MAX_BYTES,
): Promise<LogRead> {
  const handle = await fs.open(path, 'r')
  try {
    const out: string[] = []
    let used = 0
    let pos = offset
    let pending = Buffer.alloc(0)
    let lineStart = offset
    let scanned = 0
    for (;;) {
      const chunk = Buffer.alloc(CHUNK_BYTES)
      const { bytesRead } = await handle.read(chunk, 0, CHUNK_BYTES, pos)
      if (bytesRead === 0) return { text: out.join('\n'), next: lineStart, more: false }
      pos += bytesRead
      scanned += bytesRead
      pending = pending.length ? Buffer.concat([pending, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead)
      let from = 0
      for (let nl = pending.indexOf(NEWLINE, from); nl !== -1; nl = pending.indexOf(NEWLINE, from)) {
        const line = pending.subarray(from, nl).toString('utf8').trim()
        let lines: string[] = []
        if (line.startsWith('{')) {
          try {
            lines = logLines(JSON.parse(line) as Record<string, unknown>, kind)
          } catch {
            // a cursor that did not land on a line start, or a record we cannot read: skipped
          }
        }
        const size = lines.reduce((n, l) => n + Buffer.byteLength(l, 'utf8') + 1, 0)
        // the first entry is always told: it is clipped already, and a reader must move forward
        if (out.length && used + size > maxBytes) return { text: out.join('\n'), next: lineStart, more: true }
        out.push(...lines)
        used += size
        lineStart += nl + 1 - from
        from = nl + 1
      }
      pending = pending.subarray(from)
      if (scanned >= SCAN_MAX_BYTES && lineStart > offset) return { text: out.join('\n'), next: lineStart, more: true }
    }
  } finally {
    await handle.close()
  }
}

/**
 * The conversation `ref` from `cursor` on, or from its start when there is no cursor, the cursor
 * names another conversation, or the file is shorter than the offset (it was replaced).
 */
export async function readConversationLog(ref: ConversationRef, cursor: string | null): Promise<ConversationLogResult> {
  let from: LogCursor | null = null
  if (cursor !== null && cursor.trim()) {
    from = parseLogCursor(cursor)
    if (!from) return { ok: false, code: 'bad-cursor' }
  }
  const path = await conversationFile(ref)
  if (!path) return { ok: false, code: 'conversation-not-found' }
  let size: number
  try {
    size = (await fs.stat(path)).size
  } catch {
    return { ok: false, code: 'conversation-not-found' }
  }
  const restarted = from !== null && (from.conversation !== ref.id || from.offset > size)
  const offset = from && !restarted ? from.offset : 0
  try {
    const read = await readLog(path, ref.kind, offset)
    return {
      ok: true,
      text: read.text,
      cursor: formatLogCursor({ conversation: ref.id, offset: read.next }),
      more: read.more,
      restarted,
    }
  } catch {
    return { ok: false, code: 'conversation-not-found' }
  }
}
