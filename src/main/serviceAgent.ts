/**
 * The agent's service session: one warmed-up process for the whole application.
 *
 * It runs in the streaming mode of `claude -p --input-format stream-json --output-format
 * stream-json`: requests leave as JSON lines on stdin, answers arrive as JSON events on stdout.
 * That is sounder than the interactive TUI tried earlier: there one had to answer the question
 * about trusting the directory, wait out the initialisation and fish the answer out of a screen
 * being repainted, going by markers — on a real machine that never worked.
 *
 * A cold start of the CLI costs about five seconds, so the process is reused and put out only
 * after it has been idle.
 */
import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { OpResult, ServiceConfig } from '../shared/types'
import { cleanAgentEnv } from './env'
import { serialize } from './serialize'

export type { ServiceConfig }

/** the answer of a turn: the model's text, or why there is none */
export interface AskResult extends OpResult {
  message?: string
}

const IDLE_SHUTDOWN_MS = 15 * 60_000
const STREAM_ARGS = [
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  // the service session needs neither MCP servers nor CLAUDE.md nor hooks: all they do is slow
  // the start down (npx brings up playwright and the like) and they can hang the first answer
  '--safe-mode',
  '--strict-mcp-config',
  '--mcp-config',
  '{"mcpServers":{}}',
  // without a system prompt the model says hello and reasons out loud — that is both time lost
  // and rubbish in the field.
  // Deliberately not localised: this prompt steers the text of git commit messages, not the
  // interface. The commit language is the repository's own convention and must not change
  // because the window is drawn in another language.
  '--system-prompt',
  'You write git commit messages and nothing else. Answer with one commit message: no greeting, no explanation, no quotes, no discussion.',
]

/** after this many requests the process is restarted: context piles up inside one process */
const MAX_TURNS_PER_PROCESS = 15

interface Service {
  proc: ChildProcessWithoutNullStreams
  key: string
  turns: number
  /** the unfinished tail of stdout: an event arrives as a single line */
  pending: string
  idleTimer: NodeJS.Timeout | null
  onEvent: ((event: Record<string, unknown>) => void) | null
  /** id of the turn currently in flight; events tagged with any other id are stale */
  reqId: number
  /** called when the process dies, so an in-flight turn fails fast instead of waiting out the timeout */
  onClose: (() => void) | null
  stderr: string
}

let service: Service | null = null
/** there is only one process, so the turns line up in a queue */
const turnQueue = serialize()
/** monotonic turn counter: every `ask` gets its own id, ids are never reused */
let lastReqId = 0

function keyOf(cfg: ServiceConfig): string {
  return [cfg.command, cfg.args.join(' '), JSON.stringify(cfg.env), cfg.cwd].join('|')
}

function stop(): void {
  if (!service) return
  const dying = service
  // drop the reference first: stdout of a dying process must not reach a new turn
  service = null
  dying.onEvent = null
  if (dying.idleTimer) clearTimeout(dying.idleTimer)
  dying.idleTimer = null
  try {
    dying.proc.kill()
  } catch {
    /* dead already */
  }
  // `onClose` is left in place on purpose: the exit releases a turn still waiting on it
}

function touchIdle(): void {
  if (!service) return
  if (service.idleTimer) clearTimeout(service.idleTimer)
  // a warmed-up process holds memory, so it is put out once it has been idle
  service.idleTimer = setTimeout(stop, IDLE_SHUTDOWN_MS)
  service.idleTimer.unref?.()
}

function spawnService(cfg: ServiceConfig): Service {
  const env = cleanAgentEnv()
  for (const [k, v] of Object.entries(cfg.env)) env[k] = v

  const proc = spawn(cfg.command, ['-p', ...cfg.args, ...STREAM_ARGS], {
    cwd: cfg.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const created: Service = {
    proc,
    key: keyOf(cfg),
    turns: 0,
    pending: '',
    idleTimer: null,
    onEvent: null,
    reqId: 0,
    onClose: null,
    stderr: '',
  }

  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    created.pending += chunk
    const lines = created.pending.split('\n')
    created.pending = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) continue
      try {
        created.onEvent?.(JSON.parse(trimmed) as Record<string, unknown>)
      } catch {
        /* a partial event */
      }
    }
  })

  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    created.stderr = (created.stderr + chunk).slice(-2000)
  })

  const drop = (): void => {
    if (service === created) service = null
    if (created.idleTimer) clearTimeout(created.idleTimer)
    created.idleTimer = null
    created.onEvent = null
    const closed = created.onClose
    created.onClose = null
    closed?.()
  }
  proc.on('exit', drop)
  proc.on('error', drop)

  return created
}

function sendMessage(active: Service, text: string): void {
  const payload = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
  active.proc.stdin.write(JSON.stringify(payload) + '\n')
}

/** a request to the warmed-up session; the calls line up in a queue — there is one process */
export async function ask(cfg: ServiceConfig, prompt: string, payload: string, timeoutMs = 60_000): Promise<AskResult> {
  const run = async (): Promise<AskResult> => {
    if (service && service.key !== keyOf(cfg)) stop()
    if (service && service.turns >= MAX_TURNS_PER_PROCESS) stop()
    if (!service || service.proc.exitCode !== null) service = spawnService(cfg)
    const active = service
    active.turns += 1
    // restart the idle countdown before the turn, not only after: a long turn (the 90s warm-up)
    // could otherwise be killed mid-flight by an idle timer armed before it started
    touchIdle()

    const reqId = ++lastReqId
    active.reqId = reqId
    // model input, not interface text: the label follows the prompt, not the window's locale
    const question = `${prompt}\n\nThe changes:\n${payload}`

    /** the turn was given up on: the CLI is still generating with nobody listening */
    let abandoned = false

    const answer = await new Promise<string | null>((resolve) => {
      let text = ''
      let done = false
      let timer: NodeJS.Timeout | null = null

      const finish = (value: string | null): void => {
        if (done) return
        done = true
        if (timer) clearTimeout(timer)
        // release the slot only if a later turn has not already claimed it
        if (active.reqId === reqId) {
          active.onEvent = null
          active.onClose = null
        }
        resolve(value)
      }

      timer = setTimeout(() => {
        abandoned = true
        finish(null)
      }, timeoutMs)

      active.onClose = () => finish(null)

      active.onEvent = (event) => {
        // an event of a turn we already gave up on: never let it answer somebody else's question
        if (active.reqId !== reqId) return
        if (event.type === 'assistant') {
          const message = event.message as { content?: { type?: string; text?: string }[] } | undefined
          for (const part of message?.content ?? []) if (part.type === 'text' && part.text) text += part.text
        }
        if (event.type !== 'result') return
        const fallback = typeof event.result === 'string' ? event.result : ''
        finish((text || fallback).trim() || null)
      }

      try {
        sendMessage(active, question)
      } catch {
        // the pipe is broken (or half-written): the process cannot be trusted with a next turn
        abandoned = true
        finish(null)
      }
    })

    // The CLI is still generating an answer nobody waits for. A reused process would hand that
    // answer to the *next* `ask`: the message describing the previously selected files, applied
    // to the files selected now. Stopping the turn is only possible by killing the process.
    if (abandoned && service === active) stop()

    touchIdle() // no-op if the process was just killed
    if (abandoned || !answer) {
      // the CLI's own stderr tail travels verbatim next to the code; the sentence is the renderer's
      const hint = active.stderr.trim().slice(-200)
      return { ok: false, code: 'service-no-answer', ...(hint ? { error: hint } : {}) }
    }
    // the model sometimes wraps its answer in a code block — the wrapper comes off
    const clean = answer
      .replace(/^```[a-z]*\n?/i, '')
      .replace(/```$/, '')
      .trim()
    return { ok: true, message: clean }
  }

  return turnQueue(run)
}

/** the warm-up: the CLI start is paid for once, when the application launches */
export async function warmUp(cfg: ServiceConfig): Promise<OpResult> {
  // model input, not interface text — see the system prompt above
  const res = await ask(cfg, 'Answer with one word: ready.', 'warm-up', 90_000)
  // no error means no key: a warm-up that went fine must not carry an empty `error` around
  const { message: _answer, ...rest } = res
  return rest
}

/**
 * The directory of the service session: permanent and empty. It has no need of a repository —
 * the summary of the changes arrives as text — and in return the question about trusting the
 * directory is asked once.
 */
async function serviceDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'service-session')
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/**
 * The same as `ask`/`warmUp`, but in the service's own directory. The directory is chosen by
 * this side and not by the renderer: the `cwd` from the settings is the agent's directory, and
 * it will not do for the service session.
 */
export async function serviceAsk(
  cfg: ServiceConfig,
  prompt: string,
  payload: string,
  timeoutMs?: number,
): Promise<AskResult> {
  return ask({ ...cfg, cwd: await serviceDir() }, prompt, payload, timeoutMs)
}

export async function serviceWarmUp(cfg: ServiceConfig): Promise<OpResult> {
  return warmUp({ ...cfg, cwd: await serviceDir() })
}

export function shutdownService(): void {
  stop()
}

export function serviceAlive(): boolean {
  return Boolean(service && service.proc.exitCode === null)
}
