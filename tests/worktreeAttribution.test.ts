import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  candidates,
  mentionsOf,
  pathMatcher,
  rawField,
  scanTranscript,
  tallyLine,
  type Tally,
} from '../src/main/worktreeAttribution'

const MAIN = '/p/dagster'
const A = '/p/dagster/.worktrees/mad-372'
const B = '/p/dagster-wt-mad372-roi'
const P = '/p/dagster/.worktrees/mad-382'
const PP = '/p/dagster/.worktrees/mad-382-prod'
const c = candidates([A, B, P, PP], [MAIN])

const claudeTool = (command: string, at: string, cwd = MAIN): string =>
  JSON.stringify({
    type: 'assistant',
    cwd,
    timestamp: at,
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] },
  })

const run = (lines: string[], kind: 'claude' | 'codex' = 'claude'): Tally => {
  const t: Tally = new Map()
  for (const l of lines) tallyLine(l, kind, c, t)
  return t
}

describe('pathMatcher', () => {
  it('takes the longest path at a position and whole names only', () => {
    const re = pathMatcher([P, PP, MAIN])
    if (!re) throw new Error('no matcher')
    const hits = (s: string): string[] => [...s.matchAll(re)].map((m) => m[0])
    expect(hits(`cd ${PP} && ls ${P}/src`)).toEqual([PP, P])
    expect(hits(`ls ${MAIN}-wt-mad372-roi`)).toEqual([])
    expect(hits(`ls /x${MAIN}`)).toEqual([])
  })
})

describe('rawField', () => {
  it('reads a string value and unescapes it', () => {
    expect(rawField('{"cwd":"/a \\"b\\"","x":1}', 'cwd')).toBe('/a "b"')
    expect(rawField('{"x":1}', 'cwd')).toBeNull()
  })
})

describe('tallyLine', () => {
  it('counts linked worktrees in tool inputs, the main copy only through cwd', () => {
    const t = run([
      claudeTool(`cd ${A} && git status`, '2026-10-01T10:00:00Z'),
      claudeTool(`cd ${A} && pytest ${A}/tests`, '2026-10-01T11:00:00Z'),
      claudeTool(`cd ${MAIN} && ls ${B}`, '2026-10-01T09:00:00Z'),
    ])
    expect(t.get(A)).toEqual({ mentions: 3, lastAt: Date.parse('2026-10-01T11:00:00Z') })
    expect(t.get(B)).toEqual({ mentions: 1, lastAt: Date.parse('2026-10-01T09:00:00Z') })
    // three records whose cwd is the main folder; the `cd <main>` in an input does not add one
    expect(t.get(MAIN)?.mentions).toBe(3)
  })

  it('a cwd inside a linked worktree counts for that worktree', () => {
    const t = run([JSON.stringify({ type: 'user', cwd: `${A}/src`, timestamp: '2026-10-01T10:00:00Z' })])
    expect(t.get(A)?.mentions).toBe(1)
    expect(t.has(MAIN)).toBe(false)
  })

  it('a tool result naming every worktree counts for none of them', () => {
    const t = run([
      JSON.stringify({
        type: 'user',
        cwd: MAIN,
        message: { content: [{ type: 'tool_result', content: `${A}\n${B}\n${P}` }] },
      }),
    ])
    expect([...t.keys()]).toEqual([MAIN])
  })

  it('reads codex calls and its turn cwd', () => {
    const t = run(
      [
        JSON.stringify({ timestamp: '2026-10-02T00:00:00Z', type: 'turn_context', payload: { cwd: B } }),
        JSON.stringify({
          timestamp: '2026-10-02T00:01:00Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'shell',
            arguments: JSON.stringify({ command: ['ls'], workdir: PP }),
          },
        }),
      ],
      'codex',
    )
    expect(t.get(B)?.mentions).toBe(1)
    expect(t.get(PP)?.mentions).toBe(1)
    expect(t.has(P)).toBe(false)
  })
})

describe('mentionsOf', () => {
  it('linked first by mentions, a later side look does not take the lead, main copies last', () => {
    const t1: Tally = new Map([
      [A, { mentions: 254, lastAt: 200 }],
      [MAIN, { mentions: 900, lastAt: 999 }],
    ])
    const t2: Tally = new Map([
      [B, { mentions: 11, lastAt: 300 }],
      [A, { mentions: 1, lastAt: 100 }],
    ])
    expect(mentionsOf([t1, t2], c)).toEqual([
      { path: A, mentions: 255, lastAt: 200 },
      { path: B, mentions: 11, lastAt: 300 },
      { path: MAIN, mentions: 900, lastAt: 999 },
    ])
  })

  it('a tie in mentions goes to the latest', () => {
    const t: Tally = new Map([
      [A, { mentions: 3, lastAt: 100 }],
      [B, { mentions: 3, lastAt: 300 }],
    ])
    expect(mentionsOf([t], c).map((m) => m.path)).toEqual([B, A])
  })
})

describe('scanTranscript', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-attr-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads only what was appended, and leaves a half-written line for later', async () => {
    const file = join(dir, 'a.jsonl')
    writeFileSync(file, claudeTool(`cd ${A}`, '2026-10-01T10:00:00Z') + '\n')
    expect((await scanTranscript(file, 'claude', c)).get(A)?.mentions).toBe(1)
    const second = claudeTool(`cd ${A}`, '2026-10-01T12:00:00Z')
    appendFileSync(file, second.slice(0, 20))
    expect((await scanTranscript(file, 'claude', c)).get(A)?.mentions).toBe(1)
    appendFileSync(file, second.slice(20) + '\n')
    expect((await scanTranscript(file, 'claude', c)).get(A)).toEqual({
      mentions: 2,
      lastAt: Date.parse('2026-10-01T12:00:00Z'),
    })
  })

  it('a new set of worktrees reads the file again from the start', async () => {
    const file = join(dir, 'b.jsonl')
    const D = '/p/dagster/.worktrees/new'
    writeFileSync(file, claudeTool(`cd ${D}`, '2026-10-01T10:00:00Z') + '\n')
    expect((await scanTranscript(file, 'claude', c)).has(D)).toBe(false)
    const wider = candidates([A, B, P, PP, D], [MAIN])
    expect((await scanTranscript(file, 'claude', wider)).get(D)?.mentions).toBe(1)
  })
})
