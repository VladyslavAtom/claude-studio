import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findAll, rawNeedle, searchFile, snippetAt, spokenText } from '../src/main/conversationSearch'

/**
 * Only what somebody said counts: a user prompt or the agent's answer. Tool output, thinking and
 * injected context are where most of the bytes are, and a hit inside them is noise.
 */
describe('spokenText', () => {
  it('takes a Claude prompt given as a string and an answer given as blocks', () => {
    expect(spokenText({ type: 'user', message: { content: 'fix the tree' } }, 'claude')).toMatchObject({
      role: 'user',
      text: 'fix the tree',
    })
    const answer = {
      type: 'assistant',
      timestamp: '2026-10-28T10:00:00.000Z',
      message: {
        content: [
          { type: 'thinking', thinking: 'secret' },
          { type: 'text', text: 'done' },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    }
    expect(spokenText(answer, 'claude')).toEqual({
      role: 'assistant',
      text: 'done',
      at: Date.parse('2026-10-28T10:00:00.000Z'),
    })
  })

  it('leaves out tool results and injected context', () => {
    const toolResult = { type: 'user', message: { content: [{ type: 'tool_result', content: 'file dump' }] } }
    expect(spokenText(toolResult, 'claude')).toBeNull()
    expect(spokenText({ type: 'user', isMeta: true, message: { content: 'reminder' } }, 'claude')).toBeNull()
    expect(spokenText({ type: 'summary', summary: 'x' }, 'claude')).toBeNull()
  })

  it('reads Codex messages from response items', () => {
    const record = {
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'views created' }] },
    }
    expect(spokenText(record, 'codex')).toMatchObject({ role: 'assistant', text: 'views created' })
    const call = { type: 'response_item', payload: { type: 'function_call', name: 'shell' } }
    expect(spokenText(call, 'codex')).toBeNull()
  })
})

describe('matching', () => {
  it('escapes the query the way JSON escapes it, and keeps Cyrillic as is', () => {
    expect(rawNeedle('say "Hi"')).toBe('say \\"hi\\"')
    expect(rawNeedle('Сайт')).toBe('сайт')
  })

  it('finds every match regardless of case', () => {
    expect(findAll('Tree, tree, TREE', 'tree')).toEqual([0, 6, 12])
    expect(findAll('abc', '')).toEqual([])
  })

  it('cuts a long text around the match and marks the cut', () => {
    const text = 'a'.repeat(200) + ' needle ' + 'b'.repeat(200)
    const snippet = snippetAt(text, 201, 6)
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('needle')
    expect(snippetAt('short needle', 6, 6)).toBe('short needle')
  })
})

describe('searchFile', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cs-search-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('counts every match, shows the first three, and skips tool output and broken lines', async () => {
    const lines = [
      { type: 'user', message: { content: 'Нужен сайт о проекте' } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'сайт сайт сайт' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Сайт: GitHub Pages. Ещё сайт и сайт.' }] } },
    ].map((r) => JSON.stringify(r))
    lines.splice(1, 0, '{"type":"user","message":{"content":"сайт') // a line still being written
    const file = join(dir, 'c.jsonl')
    await fs.writeFile(file, lines.join('\n') + '\n')

    const { matches, total } = await searchFile(file, 'claude', 'САЙТ', () => false)
    expect(total).toBe(4)
    expect(matches.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(matches[1]?.snippet).toBe('Сайт: GitHub Pages. Ещё сайт и сайт.')
  })

  it('stops reading once the search is superseded', async () => {
    const file = join(dir, 'c.jsonl')
    await fs.writeFile(file, JSON.stringify({ type: 'user', message: { content: 'needle' } }) + '\n')
    expect((await searchFile(file, 'claude', 'needle', () => true)).total).toBe(0)
  })

  it('answers nothing for a file that is gone', async () => {
    expect((await searchFile(join(dir, 'missing.jsonl'), 'claude', 'x', () => false)).total).toBe(0)
  })
})
