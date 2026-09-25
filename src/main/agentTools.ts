/**
 * The tool a tab's agent opens a session with.
 *
 * `agentHooks` is the CLI talking about itself; this is the CLI **asking for something**, and it
 * is the opposite direction: a claude tab is started with an MCP server of ours
 * (`--mcp-config`), the server exposes one tool, `open_session`, and a call to it becomes a new
 * session in the window — a worktree, a tab, an agent already holding its first task.
 *
 * Only claude. Codex is not given the config: the two CLIs do not share an MCP configuration
 * format on the command line, and nothing here has been tried against it.
 *
 * **Why a tool and not a message.** The asking agent already has a way of talking to other
 * claude sessions on this machine; what it cannot do is make one **visible** — a session opened
 * this way is an ordinary tab, with its worktree, its history and its bell, which is exactly
 * what a background subagent is not.
 *
 * The path in, deliberately the same shape as the hooks: files in one directory of our own.
 *
 * | file                  | written by | what it is                                     |
 * | --------------------- | ---------- | ---------------------------------------------- |
 * | `<id>.req.json`       | the server | one request, taken and deleted by main         |
 * | `<id>.reply.json`     | main       | the answer, taken and deleted by the server    |
 *
 * A request is **taken**, not read: main deletes it as it emits it, so a request cannot be
 * carried out twice — the tool call that made it is blocked meanwhile and would have no way of
 * telling two sessions apart afterwards.
 *
 * The renderer is what answers, because a session is a renderer thing — a project, a worktree, a
 * tab and the state that is saved to disk all live there. Main only carries the two files.
 *
 * Everything degrades to silence in the same way the hooks do: no config, no server, an
 * unwritable directory or a nonsensical request all mean the tab simply starts without the tool.
 */
import { app, type WebContents } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { CHANNELS } from '../shared/channels'
import type { AgentToolRequest, AgentToolResult } from '../shared/types'

const DIR_NAME = 'agent-tools'

function baseDir(): string {
  return join(app.getPath('userData'), DIR_NAME)
}

/** the requests and their answers; the server is told this path through the config's `env` */
function requestsDir(): string {
  return join(baseDir(), 'requests')
}

function serverPath(): string {
  return join(baseDir(), 'open-session.js')
}

function configPath(): string {
  return join(baseDir(), 'mcp.json')
}

/**
 * The MCP server, as plain CommonJS with nothing but node's own modules.
 *
 * It is run by the CLI, not by us, so it has to start on whatever is at hand: the file is `.js`
 * in a directory with no `package.json`, which is CommonJS whatever the node version thinks of
 * ESM, and it is launched through our own binary with `ELECTRON_RUN_AS_NODE` — the user's `node`
 * may be absent, old, or a version manager's shim that is not on a spawned process's PATH.
 *
 * **Nothing but protocol messages may reach stdout.** That stream is the transport; a stray
 * `console.log` is a parse error at the other end, which is why every failure here becomes a
 * tool result and nothing is ever printed for a person to read.
 *
 * The call blocks until the window answers or the wait runs out. That is the point: the agent
 * asked for a session and the answer is what it is told about it — its name, its directory and
 * the conversation id, which is how it addresses the new session afterwards.
 */
const SERVER = `#!/usr/bin/env node
// Claude Studio — the MCP server a tab's agent opens a session through. Generated file: it is
// rewritten on every start of the application, so edits here do not survive.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const DIR = process.env.CLAUDE_STUDIO_TOOL_DIR || ''
// the tab this agent is running in — inherited from the pty. Without it the window falls back to
// the project the user is looking at, which is right often enough to be worth doing.
const TERMINAL = process.env.CLAUDE_STUDIO_SESSION || null
const WAIT_MS = 90000
const POLL_MS = 150
const PROTOCOL = '2025-06-18'

const TOOL = {
  name: 'open_session',
  description: [
    'Open a new visible session in Claude Studio: a tab of its own with a Claude agent in it,',
    'started with the task you give here. Use it when a piece of work deserves its own place on',
    'the screen and its own branch - not for a subagent, which nobody can see or talk to.',
    'The new session runs as an ordinary Claude CLI on this machine, so your usual way of',
    'messaging other sessions reaches it once it has started.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The first instruction for the new session, handed to its agent as the initial prompt.',
      },
      name: {
        type: 'string',
        description: 'Name for the session tab. Left out, the window numbers it as it numbers its own.',
      },
      isolate: {
        type: 'boolean',
        description:
          'Give the session a git worktree and a branch of its own. Left out: yes in a git repository, no outside one.',
      },
    },
    required: ['task'],
    additionalProperties: false,
  },
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\\n')
}

function text(body, isError) {
  return { content: [{ type: 'text', text: body }], isError: Boolean(isError) }
}

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms)
  })
}

function removeQuietly(p) {
  try {
    fs.unlinkSync(p)
  } catch (e) {
    /* already gone */
  }
}

async function openSession(args) {
  if (!DIR) return text('Claude Studio is not reachable: this tool works only inside a tab it started.', true)
  const task = typeof args.task === 'string' ? args.task.trim() : ''
  if (!task) return text('task is required: it is the first instruction the new session is given.', true)
  const id = crypto.randomUUID()
  const request = { id: id, terminalId: TERMINAL, task: task }
  if (typeof args.name === 'string' && args.name.trim()) request.name = args.name.trim()
  if (typeof args.isolate === 'boolean') request.isolate = args.isolate

  const tmp = path.join(DIR, id + '.tmp')
  const reqPath = path.join(DIR, id + '.req.json')
  try {
    // written and then renamed: a reader never sees half a request
    fs.writeFileSync(tmp, JSON.stringify(request))
    fs.renameSync(tmp, reqPath)
  } catch (e) {
    removeQuietly(tmp)
    return text('Could not reach Claude Studio: ' + (e && e.message ? e.message : String(e)), true)
  }

  const replyPath = path.join(DIR, id + '.reply.json')
  const until = Date.now() + WAIT_MS
  while (Date.now() < until) {
    let raw = null
    try {
      raw = fs.readFileSync(replyPath, 'utf8')
    } catch (e) {
      raw = null
    }
    if (raw) {
      removeQuietly(replyPath)
      let reply = null
      try {
        reply = JSON.parse(raw)
      } catch (e) {
        reply = null
      }
      if (!reply || typeof reply !== 'object') return text('Claude Studio answered something unreadable.', true)
      if (!reply.ok) return text(reply.error || 'Claude Studio did not open the session.', true)
      const s = reply.session || {}
      const lines = ['Session opened in Claude Studio.', 'name: ' + s.name, 'cwd: ' + s.cwd]
      if (s.branch) lines.push('branch: ' + s.branch)
      if (s.agentSessionId) lines.push('claude session id: ' + s.agentSessionId)
      lines.push(
        s.started
          ? 'Its agent is starting now with the task you gave.'
          : 'It holds the task already; its agent starts when that project is opened on screen.',
      )
      return text(lines.join('\\n'))
    }
    await sleep(POLL_MS)
  }
  removeQuietly(reqPath)
  return text('Claude Studio did not answer within 90 s; no session was opened.', true)
}

async function handle(msg) {
  const id = msg.id
  if (msg.method === 'initialize') {
    const asked = msg.params && typeof msg.params.protocolVersion === 'string' ? msg.params.protocolVersion : PROTOCOL
    return {
      protocolVersion: asked,
      capabilities: { tools: {} },
      serverInfo: { name: 'claude-studio', version: '1.0.0' },
    }
  }
  if (msg.method === 'tools/list') return { tools: [TOOL] }
  if (msg.method === 'ping') return {}
  if (msg.method === 'tools/call') {
    const params = msg.params || {}
    if (params.name !== TOOL.name) return text('Unknown tool: ' + String(params.name), true)
    return await openSession(params.arguments || {})
  }
  const err = new Error('Unknown method: ' + String(msg.method))
  err.code = -32601
  throw err
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', function (chunk) {
  buffer += chunk
  let nl = buffer.indexOf('\\n')
  while (nl >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    nl = buffer.indexOf('\\n')
    if (!line) continue
    let msg = null
    try {
      msg = JSON.parse(line)
    } catch (e) {
      continue // not ours to fix, and there is nobody to tell
    }
    // a notification carries no id and is never answered
    if (msg.id === undefined || msg.id === null) continue
    handle(msg).then(
      function (result) {
        send({ jsonrpc: '2.0', id: msg.id, result: result })
      },
      function (e) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: e && e.code ? e.code : -32603, message: e && e.message ? e.message : String(e) },
        })
      },
    )
  }
})
process.stdin.on('end', function () {
  process.exit(0)
})
`

/** the window the requests are carried to; the same arrangement as `pty.setSender` */
let sender: WebContents | null = null

export function setSender(wc: WebContents): void {
  sender = wc
}

function emit(channel: string, payload: unknown): void {
  if (!sender || sender.isDestroyed()) return
  try {
    sender.send(channel, payload)
  } catch {
    sender = null
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** a task longer than this is not a task; the cap is about a runaway writer, not about style */
const TASK_MAX = 20_000
const NAME_MAX = 200

/**
 * A request is a file written by somebody else's process, so every field is checked and anything
 * unrecognised makes the whole request nothing. The ids are file names as well as ids: a `..` or
 * a separator arriving here would let the answer be written outside the directory.
 */
export function parseToolRequest(raw: string): AgentToolRequest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null // truncated, or the writer wrote nothing at all
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  if (typeof o.id !== 'string' || !UUID.test(o.id)) return null
  if (o.terminalId !== null && (typeof o.terminalId !== 'string' || !UUID.test(o.terminalId))) return null
  if (typeof o.task !== 'string') return null
  const task = o.task.trim()
  if (!task || task.length > TASK_MAX) return null
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, NAME_MAX) : ''
  return {
    id: o.id,
    terminalId: o.terminalId,
    task,
    ...(name ? { name } : {}),
    ...(typeof o.isolate === 'boolean' ? { isolate: o.isolate } : {}),
  }
}

/** the renderer's answer, on its way back to the blocked tool call */
export async function replyToolRequest(id: string, result: AgentToolResult): Promise<void> {
  if (!UUID.test(id)) return
  const dir = requestsDir()
  const tmp = join(dir, `${id}.reply.tmp`)
  try {
    await fs.writeFile(tmp, JSON.stringify(result), 'utf8')
    await fs.rename(tmp, join(dir, `${id}.reply.json`))
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => {})
    // the agent's call times out and says so; there is nothing else to be done from here
  }
}

/** one pass is never overlapped by the next: `watch` fires more than once for a single file */
let draining = false

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    const dir = requestsDir()
    const names = await fs.readdir(dir).catch(() => [] as string[])
    for (const name of names) {
      if (!name.endsWith('.req.json')) continue
      const path = join(dir, name)
      let raw: string
      try {
        raw = await fs.readFile(path, 'utf8')
      } catch {
        continue
      }
      // taken, not read: the request is gone before it is acted on, so it cannot be carried out
      // twice — and the call that made it is blocked, so nothing would notice two sessions
      await fs.rm(path, { force: true }).catch(() => {})
      const request = parseToolRequest(raw)
      if (request) emit(CHANNELS.agent.toolRequest, request)
    }
  } finally {
    draining = false
  }
}

let watcher: FSWatcher | null = null

/** everything left by a previous run: the tool calls that were waiting for it are long dead */
async function sweep(): Promise<void> {
  const dir = requestsDir()
  const names = await fs.readdir(dir).catch(() => [] as string[])
  await Promise.all(names.map((n) => fs.rm(join(dir, n), { force: true }).catch(() => {})))
}

/**
 * The path a claude tab is started with, or null when the tool could not be set up — then the tab
 * starts without it. Prepared once: nothing here changes while the application runs, and the
 * renderer asks for the paths at every start of a tab.
 */
let prepared: Promise<string | null> | null = null

export function toolConfigPath(): Promise<string | null> {
  prepared ??= prepare()
  return prepared
}

async function prepare(): Promise<string | null> {
  try {
    await fs.mkdir(requestsDir(), { recursive: true })
    await sweep()
    await fs.writeFile(serverPath(), SERVER, { encoding: 'utf8', mode: 0o755 })
    const config = {
      mcpServers: {
        'claude-studio': {
          type: 'stdio',
          // our own binary as a plain node: the user's node may be absent, or a shim that a
          // spawned process never sees
          command: process.execPath,
          args: [serverPath()],
          env: { ELECTRON_RUN_AS_NODE: '1', CLAUDE_STUDIO_TOOL_DIR: requestsDir() },
        },
      },
    }
    await fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8')
    watcher ??= watch(requestsDir(), (_event, name) => {
      if (typeof name === 'string' && !name.endsWith('.req.json')) return
      void drain()
    })
    // the window is what keeps this process alive; a directory watch must not be a reason of its
    // own for it to stay up
    watcher.unref()
    // a request written between the sweep and the watcher being armed would otherwise sit there
    void drain()
    return configPath()
  } catch {
    // an unwritable userData: no config, no tool, and every tab starts exactly as it did before
    return null
  }
}
