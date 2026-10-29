/**
 * The tools a tab's agent opens and manages its child sessions with.
 *
 * `agentHooks` is the CLI talking about itself; this is the CLI **asking for something**, and it
 * is the opposite direction: a claude tab is started with an MCP server of ours
 * (`--mcp-config`), the server exposes `open_session`, and a call to it becomes a new session in
 * the window — a worktree, a tab, an agent already holding its first task. That session is the
 * asker's child, and four more tools act on children only: `list_sessions`, `close_session`,
 * `send_to_session`, `read_session`. Which session is whose is checked in the renderer, which
 * owns the state; `read_session` is then answered from the child's conversation file by
 * `conversationLog`.
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

const SESSION_ARG = {
  type: 'string',
  description: 'The session id, as open_session or list_sessions gave it.',
}

const TOOLS = [
  {
    name: 'open_session',
    description: [
      'Open a new visible session in Claude Studio: a tab of its own with a Claude agent in it,',
      'started with the task you give here. Use it when a piece of work deserves its own place on',
      'the screen and its own branch - not for a subagent, which nobody can see or talk to.',
      'The new session runs as an ordinary Claude CLI on this machine, so your usual way of',
      'messaging other sessions reaches it once it has started.',
      'It becomes your child: you may list it, read it, type into it and close it, and closing it is your',
      'job once your overall plan has nothing left for it - not after its first answer.',
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
            'Give the session a git worktree and a branch of its own, forked from your branch. Left out: yes in a git repository, no outside one.',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_sessions',
    description: [
      'List the sessions you opened, and the ones they opened in turn: id, name, parent, branch,',
      'directory, conversation id, whether its agent is working or waiting, and uncommitted files.',
    ].join(' '),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'close_session',
    description: [
      'Close a session you opened (or one opened by it). Do it once your overall plan needs',
      'nothing more from it, not after its first task. Its worktree is removed only when clean,',
      'its branch only when merged into your branch; otherwise the call is refused, unless',
      'force is true - then the session closes and its worktree and branch stay on disk.',
      'A session with open children of its own is refused: close those first.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        session: SESSION_ARG,
        force: { type: 'boolean', description: 'Close even with unsaved work; the worktree and branch are kept.' },
      },
      required: ['session'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_to_session',
    description: [
      'Type text into the agent of a session you opened and submit it, as the person would.',
      'Meant for a child stuck on a question or a permission prompt in its terminal; ordinary',
      'messages also go through your usual way of messaging sessions.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        session: SESSION_ARG,
        text: { type: 'string', description: 'What to type. Submitted with Enter.' },
      },
      required: ['session', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_session',
    description: [
      'Read what a session you opened (or one opened by it) said and did: its conversation since',
      'a cursor, one line per event - [user] prompts, [assistant] text, [tool] calls with their',
      'main argument, [result] tool output clipped to a few hundred characters. Thinking is left',
      'out. One answer holds at most 20 KB; the last line gives the cursor to pass next time, and',
      'says when more is waiting. Without a cursor it reads from the start of the conversation.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        session: SESSION_ARG,
        cursor: {
          type: 'string',
          description: 'The cursor the previous read_session answer ended with. Left out: from the start.',
        },
        tab: {
          type: 'string',
          description: 'Which agent tab of the session, as list_sessions names them. Left out: its first agent tab.',
        },
      },
      required: ['session'],
      additionalProperties: false,
    },
  },
]

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

/** the request a tool call becomes, or a string saying what is wrong with the arguments */
function requestFor(name, args) {
  if (name === 'open_session') {
    const task = typeof args.task === 'string' ? args.task.trim() : ''
    if (!task) return 'task is required: it is the first instruction the new session is given.'
    const r = { tool: 'open', task: task }
    if (typeof args.name === 'string' && args.name.trim()) r.name = args.name.trim()
    if (typeof args.isolate === 'boolean') r.isolate = args.isolate
    return r
  }
  if (name === 'list_sessions') return { tool: 'list' }
  const session = typeof args.session === 'string' ? args.session.trim() : ''
  if (!session) return 'session is required: the id open_session or list_sessions gave.'
  if (name === 'close_session') {
    const r = { tool: 'close', session: session }
    if (args.force === true) r.force = true
    return r
  }
  if (name === 'send_to_session') {
    if (typeof args.text !== 'string' || !args.text.trim()) return 'text is required.'
    return { tool: 'send', session: session, text: args.text }
  }
  if (name === 'read_session') {
    const r = { tool: 'read', session: session }
    if (typeof args.cursor === 'string' && args.cursor.trim()) r.cursor = args.cursor.trim()
    if (typeof args.tab === 'string' && args.tab.trim()) r.tab = args.tab.trim()
    return r
  }
  return 'Unknown tool: ' + String(name)
}

function describeOpened(s) {
  const lines = ['Session opened in Claude Studio.', 'session id: ' + s.id, 'name: ' + s.name, 'cwd: ' + s.cwd]
  if (s.branch) lines.push('branch: ' + s.branch)
  if (s.agentSessionId) lines.push('claude session id: ' + s.agentSessionId)
  lines.push(
    s.started
      ? 'Its agent is starting now with the task you gave.'
      : 'Its agent could not be started yet; it holds the task and starts when the session is opened on screen.',
  )
  return lines.join('\\n')
}

async function call(name, args) {
  if (!DIR) return text('Claude Studio is not reachable: this tool works only inside a tab it started.', true)
  const body = requestFor(name, args)
  if (typeof body === 'string') return text(body, true)
  const id = crypto.randomUUID()
  const request = Object.assign({ id: id, terminalId: TERMINAL }, body)

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
      if (!reply.ok) return text(reply.error || 'Claude Studio refused.', true)
      if (reply.session) return text(describeOpened(reply.session))
      return text(reply.text || 'Done.')
    }
    await sleep(POLL_MS)
  }
  removeQuietly(reqPath)
  return text('Claude Studio did not answer within 90 s; nothing was done.', true)
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
  if (msg.method === 'tools/list') return { tools: TOOLS }
  if (msg.method === 'ping') return {}
  if (msg.method === 'tools/call') {
    const params = msg.params || {}
    return await call(params.name, params.arguments || {})
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
/** `<conversation id>:<offset>`, checked again where it is used; this only bounds the file */
const CURSOR_MAX = 200

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
  const head = { id: o.id, terminalId: o.terminalId }
  // a request written before the tool had siblings carries no `tool`: it can only be an open
  const tool = o.tool ?? 'open'
  if (tool === 'list') return { ...head, tool }
  if (tool === 'read') {
    if (typeof o.session !== 'string' || !UUID.test(o.session)) return null
    if (o.tab !== undefined && (typeof o.tab !== 'string' || !UUID.test(o.tab))) return null
    if (o.cursor !== undefined && (typeof o.cursor !== 'string' || o.cursor.length > CURSOR_MAX)) return null
    return {
      ...head,
      tool,
      session: o.session,
      ...(typeof o.tab === 'string' ? { tab: o.tab } : {}),
      ...(typeof o.cursor === 'string' ? { cursor: o.cursor } : {}),
    }
  }
  if (tool === 'close' || tool === 'send') {
    if (typeof o.session !== 'string' || !UUID.test(o.session)) return null
    if (tool === 'close') return { ...head, tool, session: o.session, ...(o.force === true ? { force: true } : {}) }
    if (typeof o.text !== 'string' || !o.text.trim() || o.text.length > TASK_MAX) return null
    return { ...head, tool, session: o.session, text: o.text }
  }
  if (tool !== 'open' || typeof o.task !== 'string') return null
  const task = o.task.trim()
  if (!task || task.length > TASK_MAX) return null
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, NAME_MAX) : ''
  return {
    ...head,
    tool,
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
