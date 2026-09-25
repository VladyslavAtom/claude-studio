import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CHANNELS } from '../src/shared/channels'
import type { AgentToolRequest } from '../src/shared/types'

/**
 * Two halves, and the module needs Electron for `app.getPath('userData')` alone.
 *
 * The parser is the half that matters most: a request is a file written by somebody else's
 * process — our MCP server, running under the agent's CLI — so what is refused is the point. The
 * ids are file names as well as ids, and a separator or a `..` getting through would put the
 * answer somewhere other than the directory it belongs in.
 *
 * The other half is the server itself. It is generated source that nothing else in the project
 * compiles or lints, so it is run for real: started as a process, spoken to over the stdio
 * transport it will meet in the CLI, and answered with a reply file exactly as main answers one.
 * A typo in that file would otherwise only ever surface as a tool the agent cannot call.
 */
const hoisted = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({ app: { getPath: () => hoisted.userData } }))

type Tools = typeof import('../src/main/agentTools')

let dir = ''
let tools: Tools
/** what main sent to the window: a request is taken off disk as it is emitted, never left there */
let emitted: { channel: string; payload: AgentToolRequest }[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cs-tools-'))
  hoisted.userData = dir
  vi.resetModules()
  tools = await import('../src/main/agentTools')
  emitted = []
  tools.setSender({
    isDestroyed: () => false,
    send: (channel: string, payload: AgentToolRequest) => emitted.push({ channel, payload }),
  } as unknown as WebContents)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const ID = '2f1a8b6c-5d4e-4f3a-9b2c-1d0e9f8a7b6c'
const TAB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function req(extra: Record<string, unknown>): string {
  return JSON.stringify({ id: ID, terminalId: TAB, task: 'ship the parser', ...extra })
}

describe('parseToolRequest', () => {
  it('takes a request with the fields the tool sends', () => {
    expect(tools.parseToolRequest(req({ name: 'Parser', isolate: false }))).toEqual({
      id: ID,
      terminalId: TAB,
      task: 'ship the parser',
      name: 'Parser',
      isolate: false,
    })
  })

  it('leaves out what was not asked for, rather than guessing it', () => {
    const parsed = tools.parseToolRequest(req({}))
    expect(parsed).not.toBeNull()
    expect(parsed && 'name' in parsed).toBe(false)
    expect(parsed && 'isolate' in parsed).toBe(false)
  })

  it('accepts a request that could not name its tab', () => {
    expect(tools.parseToolRequest(req({ terminalId: null }))?.terminalId).toBeNull()
  })

  it('refuses an id that is not one: it is also the name the answer is written under', () => {
    expect(tools.parseToolRequest(JSON.stringify({ id: '../../x', terminalId: null, task: 'a' }))).toBeNull()
    expect(tools.parseToolRequest(req({ terminalId: 'not-a-uuid' }))).toBeNull()
  })

  it('refuses a request with nothing to do: an empty task is not a task', () => {
    expect(tools.parseToolRequest(req({ task: '   ' }))).toBeNull()
    expect(tools.parseToolRequest(req({ task: 42 }))).toBeNull()
    expect(tools.parseToolRequest(req({ task: 'x'.repeat(20_001) }))).toBeNull()
  })

  it('reads a half-written or nonsensical file as nothing', () => {
    expect(tools.parseToolRequest('')).toBeNull()
    expect(tools.parseToolRequest('{"id":')).toBeNull()
    expect(tools.parseToolRequest('[]')).toBeNull()
    expect(tools.parseToolRequest('"a string"')).toBeNull()
  })

  it('trims the task and the name, and caps the name', () => {
    const parsed = tools.parseToolRequest(req({ task: '  ship it  ', name: ` ${'n'.repeat(300)} ` }))
    expect(parsed?.task).toBe('ship it')
    expect(parsed?.name).toHaveLength(200)
  })

  it('drops an isolate that is not a boolean instead of reading it as one', () => {
    expect(tools.parseToolRequest(req({ isolate: 'yes' }))).not.toHaveProperty('isolate')
  })
})

describe('the config a claude tab is started with', () => {
  it('names our own binary as node, and tells the server where the requests live', async () => {
    const path = await tools.toolConfigPath()
    expect(path).toBe(join(dir, 'agent-tools', 'mcp.json'))
    const config = JSON.parse(await fs.readFile(path as string, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
    }
    const server = config.mcpServers['claude-studio']
    expect(server?.command).toBe(process.execPath)
    expect(server?.args).toEqual([join(dir, 'agent-tools', 'open-session.js')])
    expect(server?.env).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      CLAUDE_STUDIO_TOOL_DIR: join(dir, 'agent-tools', 'requests'),
    })
  })
})

/** one line of newline-delimited JSON, which is what the stdio transport is */
interface Rpc {
  id?: number
  result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }
  error?: { message: string }
}

/**
 * The server, spoken to the way the CLI speaks to it. `node` here is the process running the
 * tests — the same role our own binary plays under `ELECTRON_RUN_AS_NODE`.
 */
function talk(serverPath: string, requestsDir: string, terminal: string | null) {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_STUDIO_TOOL_DIR: requestsDir }
  if (terminal) env.CLAUDE_STUDIO_SESSION = terminal
  else delete env.CLAUDE_STUDIO_SESSION
  const proc = spawn(process.execPath, [serverPath], { env, stdio: ['pipe', 'pipe', 'ignore'] })
  const seen: Rpc[] = []
  let buffer = ''
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk
    for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) seen.push(JSON.parse(line) as Rpc)
    }
  })
  return {
    send(msg: unknown): void {
      proc.stdin.write(`${JSON.stringify(msg)}\n`)
    },
    async reply(id: number): Promise<Rpc> {
      const until = Date.now() + 10_000
      while (Date.now() < until) {
        const found = seen.find((m) => m.id === id)
        if (found) return found
        await new Promise((r) => setTimeout(r, 20))
      }
      throw new Error(`no answer to ${id}`)
    },
    stop(): void {
      proc.kill()
    },
  }
}

/**
 * The request as the window receives it. The file itself is not waited for: main watches that
 * directory and **takes** what appears there, so a test that waited for the file would be racing
 * the very thing it is testing.
 */
async function firstRequest(): Promise<AgentToolRequest> {
  const until = Date.now() + 10_000
  while (Date.now() < until) {
    const first = emitted[0]
    if (first) {
      expect(first.channel).toBe(CHANNELS.agent.toolRequest)
      return first.payload
    }
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('nothing reached the window')
}

describe('the MCP server', () => {
  it('answers the handshake and offers one tool', async () => {
    await tools.toolConfigPath()
    const requests = join(dir, 'agent-tools', 'requests')
    const cli = talk(join(dir, 'agent-tools', 'open-session.js'), requests, TAB)
    try {
      cli.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
      cli.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      cli.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      expect((await cli.reply(1)).result).toBeTruthy()
      expect((await cli.reply(2)).result?.tools?.map((t) => t.name)).toEqual(['open_session'])
    } finally {
      cli.stop()
    }
  })

  it('writes the request, waits for the window, and tells the agent what was opened', async () => {
    await tools.toolConfigPath()
    const requests = join(dir, 'agent-tools', 'requests')
    const cli = talk(join(dir, 'agent-tools', 'open-session.js'), requests, TAB)
    try {
      cli.send({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'open_session', arguments: { task: 'ship the parser', name: 'Parser' } },
      })
      const written = await firstRequest()
      expect(written).toMatchObject({ terminalId: TAB, task: 'ship the parser', name: 'Parser' })
      // main answers exactly this way: the renderer's result, written next to the request
      await tools.replyToolRequest(written.id, {
        ok: true,
        session: { name: 'Parser', cwd: '/repo/.worktrees/parser', branch: 'claude/parser', started: true },
      })
      const answer = await cli.reply(7)
      expect(answer.result?.isError).toBe(false)
      expect(answer.result?.content?.[0]?.text).toContain('claude/parser')
    } finally {
      cli.stop()
    }
  })

  it('a tab it cannot name still asks; the window is what falls back', async () => {
    await tools.toolConfigPath()
    const requests = join(dir, 'agent-tools', 'requests')
    const cli = talk(join(dir, 'agent-tools', 'open-session.js'), requests, null)
    try {
      cli.send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'open_session', arguments: { task: 'anything' } },
      })
      expect((await firstRequest()).terminalId).toBeNull()
    } finally {
      cli.stop()
    }
  })

  it('a refusal from the window is what the agent is told, and it is an error', async () => {
    await tools.toolConfigPath()
    const requests = join(dir, 'agent-tools', 'requests')
    const cli = talk(join(dir, 'agent-tools', 'open-session.js'), requests, TAB)
    try {
      cli.send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'open_session', arguments: { task: 'anything' } },
      })
      const written = await firstRequest()
      await tools.replyToolRequest(written.id, { ok: false, error: 'no project is open' })
      const answer = await cli.reply(4)
      expect(answer.result?.isError).toBe(true)
      expect(answer.result?.content?.[0]?.text).toBe('no project is open')
    } finally {
      cli.stop()
    }
  })

  it('a call with no task is refused before anything is written', async () => {
    await tools.toolConfigPath()
    const requests = join(dir, 'agent-tools', 'requests')
    const cli = talk(join(dir, 'agent-tools', 'open-session.js'), requests, TAB)
    try {
      cli.send({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'open_session', arguments: { task: '  ' } },
      })
      const answer = await cli.reply(5)
      expect(answer.result?.isError).toBe(true)
      expect(emitted).toEqual([])
    } finally {
      cli.stop()
    }
  })
})
