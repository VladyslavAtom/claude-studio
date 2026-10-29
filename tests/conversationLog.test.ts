import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  clip,
  formatLogCursor,
  logLines,
  parseLogCursor,
  readConversationLog,
  readLog,
} from '../src/main/conversationLog'

const ID = '2f1a8b6c-5d4e-4f3a-9b2c-1d0e9f8a7b6c'

const user = (content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'user',
  message: { role: 'user', content },
  ...extra,
})
const assistant = (content: unknown[]): Record<string, unknown> => ({
  type: 'assistant',
  message: { role: 'assistant', content },
})
const line = (r: Record<string, unknown>): string => `${JSON.stringify(r)}\n`

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cs-log-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the cursor', () => {
  it('round-trips, and refuses what is not one', () => {
    expect(parseLogCursor(formatLogCursor({ conversation: ID, offset: 1234 }))).toEqual({
      conversation: ID,
      offset: 1234,
    })
    expect(parseLogCursor('1234')).toBeNull()
    expect(parseLogCursor(`${ID}:-1`)).toBeNull()
    expect(parseLogCursor(`../x:1`)).toBeNull()
  })
})

describe('logLines', () => {
  it('tells prompts, text, calls and results, and leaves thinking and bookkeeping out', () => {
    expect(logLines(user('fix the parser'), 'claude')).toEqual(['[user] fix the parser'])
    expect(
      logLines(
        assistant([
          { type: 'thinking', thinking: 'secret' },
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'npm   test', description: 'run tests' } },
        ]),
        'claude',
      ),
    ).toEqual(['[assistant] On it.', '[tool] Bash: npm test'])
    expect(
      logLines(user([{ type: 'tool_result', content: [{ type: 'text', text: 'boom' }], is_error: true }]), 'claude'),
    ).toEqual(['[result error] boom'])
    expect(logLines({ type: 'ai-title', aiTitle: 'x' }, 'claude')).toEqual([])
    expect(logLines(user('<reminder>', { isMeta: true }), 'claude')).toEqual([])
    expect(logLines(user('subagent prompt', { isSidechain: true }), 'claude')).toEqual([])
  })

  it('clips a tool result to a few hundred characters', () => {
    const [only] = logLines(user([{ type: 'tool_result', content: 'x'.repeat(5000) }]), 'claude')
    expect(only?.length).toBeLessThan(400)
    expect(only).toContain('[+4700 chars]')
  })

  it('reads a codex rollout, without the context codex injects as a user message', () => {
    const item = (payload: Record<string, unknown>): Record<string, unknown> => ({ type: 'response_item', payload })
    expect(
      logLines(item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }), 'codex'),
    ).toEqual(['[user] hello'])
    expect(
      logLines(
        item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…' }] }),
        'codex',
      ),
    ).toEqual([])
    expect(logLines(item({ type: 'message', role: 'developer', content: 'rules' }), 'codex')).toEqual([])
    expect(logLines(item({ type: 'reasoning', summary: [] }), 'codex')).toEqual([])
    expect(
      logLines(item({ type: 'function_call', name: 'exec_command', arguments: '{"cmd":"ls -la"}' }), 'codex'),
    ).toEqual(['[tool] exec_command: ls -la'])
    expect(logLines(item({ type: 'function_call_output', output: 'total 0' }), 'codex')).toEqual(['[result] total 0'])
  })

  it('clip keeps short text whole', () => {
    expect(clip('a\n b', 10)).toBe('a b')
  })
})

describe('readLog', () => {
  it('reads from an offset to the end, and the next read starts where it stopped', async () => {
    const file = join(dir, 'c.jsonl')
    const first = line(user('one')) + line({ type: 'mode', mode: 'normal' })
    await fs.writeFile(file, first)
    const a = await readLog(file, 'claude', 0)
    expect(a).toEqual({ text: '[user] one', next: Buffer.byteLength(first), more: false })

    await fs.appendFile(file, line(assistant([{ type: 'text', text: 'двa' }])))
    const b = await readLog(file, 'claude', a.next)
    expect(b.text).toBe('[assistant] двa')
    expect(b.next).toBe((await fs.stat(file)).size)
  })

  it('leaves a line still being written for the next read', async () => {
    const file = join(dir, 'c.jsonl')
    const done = line(user('one'))
    await fs.writeFile(file, done + '{"type":"user","mess')
    const r = await readLog(file, 'claude', 0)
    expect(r.text).toBe('[user] one')
    expect(r.next).toBe(Buffer.byteLength(done))
  })

  it('stops at the size bound on a line boundary and says more is waiting', async () => {
    const file = join(dir, 'c.jsonl')
    const lines = Array.from({ length: 50 }, (_, i) => line(user(`message ${i} ${'y'.repeat(100)}`)))
    await fs.writeFile(file, lines.join(''))
    const r = await readLog(file, 'claude', 0, 1000)
    expect(Buffer.byteLength(r.text)).toBeLessThanOrEqual(1000)
    expect(r.more).toBe(true)
    const told = r.text.split('\n').length
    expect(r.next).toBe(lines.slice(0, told).reduce((n, l) => n + Buffer.byteLength(l), 0))
    const rest = await readLog(file, 'claude', r.next, 1000)
    expect(rest.text.startsWith(`[user] message ${told} `)).toBe(true)
  })
})

describe('readConversationLog', () => {
  async function conversation(): Promise<string> {
    const projects = join(dir, 'projects', '-repo')
    await fs.mkdir(projects, { recursive: true })
    const file = join(projects, `${ID}.jsonl`)
    await fs.writeFile(file, line(user('hello')))
    return file
  }

  it('reads from the start without a cursor and hands back the next one', async () => {
    const file = await conversation()
    const r = await readConversationLog({ id: ID, kind: 'claude', configDir: dir }, null)
    expect(r).toEqual({
      ok: true,
      text: '[user] hello',
      cursor: `${ID}:${(await fs.stat(file)).size}`,
      more: false,
      restarted: false,
    })
  })

  it('starts over when the cursor names another conversation, and says so', async () => {
    await conversation()
    const other = '00000000-0000-4000-8000-000000000000'
    const r = await readConversationLog({ id: ID, kind: 'claude', configDir: dir }, `${other}:5`)
    expect(r).toMatchObject({ ok: true, text: '[user] hello', restarted: true })
  })

  it('refuses a cursor that is not one', async () => {
    await conversation()
    expect(await readConversationLog({ id: ID, kind: 'claude', configDir: dir }, 'garbage')).toEqual({
      ok: false,
      code: 'bad-cursor',
    })
  })
})
