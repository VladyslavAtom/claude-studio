/**
 * Full-text search inside the agents' conversations: what the user and the agent said to each
 * other, not the titles the listing already filters by.
 *
 * Both stores are journals of JSON lines, Claude's `<profile>/projects/<dir>/<id>.jsonl` and
 * Codex's rollout files. Only the spoken text counts — user prompts and the agent's answers.
 * Tool calls, tool output and thinking are left out: they are where most of the bytes are, and a
 * hit inside a dumped file says nothing about the conversation.
 *
 * A line is parsed only when its raw text already contains the query. Conversations reach tens
 * of megabytes, nearly all of it tool output, and JSON.parse of every line was the whole cost.
 * Both CLIs write non-ASCII as is, so the raw comparison holds for Cyrillic too; a query is
 * escaped the way JSON escapes it, so a quote or a backslash in it still finds the line.
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { ConversationHits, ConversationMatch, ConversationRef } from '../shared/types'
import { conversationFile } from './agentSessions'

/** the places shown per conversation; the rest are only counted */
const MATCHES_SHOWN = 3
/** characters of context on each side of a match */
const CONTEXT_BEFORE = 50
const CONTEXT_AFTER = 110
/** files read at once: each is a stream from disk, more of them only queue on the same disk */
const SEARCH_CONCURRENCY = 4
/** one bound for the whole search, so the window gets an answer even over a huge store */
const SEARCH_DEADLINE_MS = 15_000

export interface SpokenText {
  role: 'user' | 'assistant'
  text: string
  at: number
}

const textOf = (content: unknown, types: readonly string[]): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const c of content) {
    const block = c as { type?: unknown; text?: unknown }
    if (typeof block.type === 'string' && types.includes(block.type) && typeof block.text === 'string')
      parts.push(block.text)
  }
  return parts.join('\n')
}

/** the words of one journal record, or null when the record is not something somebody said */
export function spokenText(record: Record<string, unknown>, kind: 'claude' | 'codex'): SpokenText | null {
  const at = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN
  if (kind === 'claude') {
    if (record.type !== 'user' && record.type !== 'assistant') return null
    // injected context (command wrappers, reminders) is the CLI talking, not the user
    if (record.isMeta === true) return null
    const message = record.message as { content?: unknown } | undefined
    const text = textOf(message?.content, ['text'])
    return text ? { role: record.type, text, at: Number.isNaN(at) ? 0 : at } : null
  }
  if (record.type !== 'response_item') return null
  const payload = record.payload as { type?: unknown; role?: unknown; content?: unknown } | undefined
  if (payload?.type !== 'message' || (payload.role !== 'user' && payload.role !== 'assistant')) return null
  const text = textOf(payload.content, ['input_text', 'output_text'])
  return text ? { role: payload.role, text, at: Number.isNaN(at) ? 0 : at } : null
}

/** the query as it appears inside a JSON string, lower-cased like the line it is compared with */
export function rawNeedle(query: string): string {
  return JSON.stringify(query.toLowerCase()).slice(1, -1)
}

/** every start of `query` in `text`, case-insensitive */
export function findAll(text: string, query: string): number[] {
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  const out: number[] = []
  if (!needle) return out
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push(i)
  return out
}

/** the match with some text around it, on one line, with an ellipsis where it was cut */
export function snippetAt(text: string, index: number, length: number): string {
  const from = Math.max(0, index - CONTEXT_BEFORE)
  const to = Math.min(text.length, index + length + CONTEXT_AFTER)
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return (from > 0 ? '…' : '') + body + (to < text.length ? '…' : '')
}

/** the matches in one file; `stale` is asked between lines, so a superseded search stops reading */
export async function searchFile(
  path: string,
  kind: 'claude' | 'codex',
  query: string,
  stale: () => boolean,
): Promise<{ matches: ConversationMatch[]; total: number }> {
  const needle = rawNeedle(query)
  const matches: ConversationMatch[] = []
  let total = 0
  const stream = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (stale()) break
      if (!line.toLowerCase().includes(needle)) continue
      let record: Record<string, unknown>
      try {
        record = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue // a line still being written
      }
      const spoken = spokenText(record, kind)
      if (!spoken) continue
      const found = findAll(spoken.text, query)
      total += found.length
      for (const index of found) {
        if (matches.length >= MATCHES_SHOWN) break
        matches.push({ role: spoken.role, snippet: snippetAt(spoken.text, index, query.length), at: spoken.at })
      }
    }
  } catch {
    // the file vanished or became unreadable halfway: what was found so far still stands
  } finally {
    lines.close()
    stream.destroy()
  }
  return { matches, total }
}

/**
 * The modal asks again on every pause in typing, and only the newest question has a reader. A
 * search that has been superseded stops at its next line instead of reading the store to the end
 * for an answer nobody will look at.
 */
let generation = 0

/** conversations from `refs` that contain `query`, in the order they were given */
export async function searchConversations(refs: ConversationRef[], query: string): Promise<ConversationHits[]> {
  const mine = ++generation
  const q = query.trim()
  if (!q) return []
  const deadline = Date.now() + SEARCH_DEADLINE_MS
  const stale = (): boolean => mine !== generation || Date.now() > deadline

  const results: (ConversationHits | null)[] = refs.map(() => null)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      const ref = refs[i]
      if (ref === undefined || stale()) return
      const path = await conversationFile(ref)
      if (!path) continue
      const { matches, total } = await searchFile(path, ref.kind, q, stale)
      if (total > 0) results[i] = { id: ref.id, matches, total }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SEARCH_CONCURRENCY, refs.length) }, worker))
  return results.filter((r): r is ConversationHits => r !== null)
}
