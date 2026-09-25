import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import { CHANNELS } from '../shared/channels'
import type { PtyStartOptions, PtyStartResult } from '../shared/types'
import { clearReports, reportsDir } from './agentHooks'
import { cleanAgentEnv } from './env'
import type { Scrollback } from './scrollback'
import { NO_LIMIT, appendChunk, charLimitForLines, clearChunks, joinChunks, trimToTail } from './scrollback'

const MAX_EXITED_TERMS = 50 // how many finished sessions are kept before the oldest are forgotten
const SLEEP_TICK_MS = 20_000
/** what a pty is spawned with when the renderer had nothing to measure yet */
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const FLUSH_MS = 25 // TUI agents repaint dozens of times per second; batch before crossing IPC

/** a running (or lately running) terminal; the scrollback it keeps for replay is in `scrollback.ts` */
interface Term extends Scrollback {
  proc: pty.IPty
  seq: number
  alive: boolean
  /**
   * Generation of this pty: `terms` is keyed by terminal id alone, and a restart reuses the
   * same id, so a dead pty and its replacement are told apart only by object identity.
   */
  gen: number
  /**
   * Set by `kill()`. The process is gone from `terms` but its `onData`/`onExit` fire 50-300ms
   * later, and by then the id may already belong to a freshly spawned pty; those late events
   * must not be emitted, or the live terminal is reported dead.
   */
  discarded: boolean
  cwd: string
  /** agent tabs may be put to sleep when idle; shells are left alone */
  sleepable: boolean
  lastActivity: number
  /** characters typed since the last Enter, used to report the last shell command */
  inputLine: string
  lastCommand: string
  /** output waiting to be flushed to the renderer */
  pending: string
  flushTimer: NodeJS.Timeout | null
}

const terms = new Map<string, Term>()
/** stamped on every spawned pty; never reused, so a late event can always name its own pty */
let lastGen = 0
/** the order in which processes finished — so the oldest records go first once too many pile up */
const exitedOrder: string[] = []
let sender: WebContents | null = null
let sleepMs = 30 * 60_000
let sleepTimer: NodeJS.Timeout | null = null
/**
 * How much of what a terminal prints is kept for replay, in characters. One number for every
 * pty: the setting is one number for the whole application, and a per-terminal copy would only
 * be a place for the two to disagree after a change.
 *
 * It starts unlimited — the same default the settings hold — so the terminals opened before the
 * renderer has pushed the setting keep everything rather than silently losing output to a
 * limit nobody chose.
 */
let bufferLimit = NO_LIMIT

export function setSender(wc: WebContents): void {
  sender = wc
}

/** the window can go away while a pty is still streaming */
function emit(channel: string, payload: unknown): void {
  if (!sender || sender.isDestroyed()) return
  try {
    sender.send(channel, payload)
  } catch {
    sender = null
  }
}

/**
 * How much scrollback to keep, as the setting states it: a number of lines, or `null` for no
 * limit. The characters this buffer counts are derived here rather than in the renderer, which
 * has no business knowing that main measures the same history in a different unit —
 * `charLimitForLines` explains the rate.
 *
 * A lowered limit is applied to what is already buffered, not only to what arrives next: the
 * point of lowering it is to stop holding the memory, and a quiet terminal would otherwise keep
 * its old history until it printed something again.
 */
export function setScrollbackLimit(lines: number | null): void {
  bufferLimit = charLimitForLines(lines)
  if (bufferLimit === NO_LIMIT) return
  for (const t of terms.values()) {
    if (t.chunksLen > bufferLimit) trimToTail(t, bufferLimit)
  }
}

export function setSleepPolicy(enabled: boolean, minutes: number): void {
  sleepMs = Math.max(1, minutes) * 60_000
  if (sleepTimer) clearInterval(sleepTimer)
  sleepTimer = null
  if (!enabled) return
  sleepTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, t] of terms) {
      if (!t.alive || !t.sleepable) continue
      const idle = now - t.lastActivity
      if (idle < sleepMs) continue
      sleep(id)
    }
  }, SLEEP_TICK_MS)
  sleepTimer.unref?.()
}

/**
 * Put a terminal to sleep: kill the process and announce it.
 *
 * The sweep above and the menu item in the tab strip both come here, so a hand-slept tab and an
 * idle-slept one cannot drift apart — one path kills, one path announces, and the renderer has
 * one event to react to.
 *
 * Two deliberate differences from the sweep's own tests. `sleepable` is not consulted: it says
 * which tabs the timer may take by itself (shells are left alone), and it has no business
 * overruling a person who asked. And an id with no record still gets its `slept` — there is
 * nothing to kill, but the renderer believes the tab is awake and this is what corrects it;
 * staying silent would leave the menu item looking broken.
 */
export function sleep(id: string): void {
  const idle = Date.now() - (terms.get(id)?.lastActivity ?? Date.now())
  kill(id)
  emit(CHANNELS.pty.slept, { id, idleMs: idle })
}

/**
 * The options a terminal starts with. The shape arrives from the renderer through preload, so
 * the declaration is one for everybody — in `shared/types`; here it is only the short name
 * everyone is used to.
 */
export type StartOptions = PtyStartOptions

function shellPath(): string {
  return process.env.SHELL || '/bin/bash'
}

export function start(opts: StartOptions): PtyStartResult {
  const existing = terms.get(opts.id)
  if (existing) {
    // A re-attach is not a resize. A pane that is merely hidden (`display: none`) cannot be
    // measured by FitAddon, and pushing a made-up size onto a live pty sends SIGWINCH and mangles
    // the TUI of every background agent on session switch. So the renderer says outright that it
    // has no size (both fields absent) and the pty is left alone; a size that is here was
    // measured, and the pty may have gone stale while the pane was unmounted, so it is applied.
    // Real size changes arrive through `resize()`, which the renderer wires to `term.onResize`.
    if (existing.alive && opts.cols !== undefined && opts.rows !== undefined) {
      try {
        existing.proc.resize(Math.max(opts.cols, 2), Math.max(opts.rows, 2))
      } catch {
        /* ignore */
      }
    }
    return { buffer: joinChunks(existing), seq: existing.seq, alive: existing.alive }
  }

  const env = cleanAgentEnv()
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  // The two halves of one address, inherited by every process the tab starts — a hook among
  // them. Which tab reported, and where to leave the report: see `agentHooks`.
  env.CLAUDE_STUDIO_SESSION = opts.id
  env.CLAUDE_STUDIO_HOOK_DIR = reportsDir()
  for (const [k, v] of Object.entries(opts.env ?? {})) env[k] = v

  // a first start with no measurement to go on: the shell gets the classic terminal size, and
  // the renderer corrects it through `resize()` as soon as the pane can be measured
  const proc = pty.spawn(shellPath(), ['-i'], {
    name: 'xterm-256color',
    cwd: opts.cwd,
    env,
    cols: Math.max(opts.cols ?? DEFAULT_COLS, 2),
    rows: Math.max(opts.rows ?? DEFAULT_ROWS, 2),
  })

  const term: Term = {
    proc,
    chunks: [],
    chunksLen: 0,
    seq: 0,
    alive: true,
    gen: ++lastGen,
    discarded: false,
    cwd: opts.cwd,
    sleepable: Boolean(opts.sleepable),
    lastActivity: Date.now(),
    inputLine: '',
    lastCommand: '',
    pending: '',
    flushTimer: null,
  }
  terms.set(opts.id, term)

  proc.onData((data) => {
    // a killed pty can still flush a last chunk; the id may already be a different pty's
    if (term.discarded || !data) return
    term.lastActivity = Date.now()
    appendChunk(term, data, bufferLimit)
    term.pending += data
    if (term.flushTimer) return
    term.flushTimer = setTimeout(() => {
      term.flushTimer = null
      const payload = term.pending
      term.pending = ''
      if (!payload || term.discarded) return
      term.seq += 1
      emit(CHANNELS.pty.data, { id: opts.id, data: payload, seq: term.seq })
    }, FLUSH_MS)
  })

  proc.onExit(({ exitCode }) => {
    term.alive = false
    if (term.flushTimer) clearTimeout(term.flushTimer)
    term.flushTimer = null
    term.pending = ''
    // Exit of a pty that `kill()` already retired: the renderer has remounted the pane under the
    // same id and is listening again, so emitting here would print «the process has finished» over a
    // terminal that is running. The scrollback goes with it — the record is gone from `terms`.
    if (term.discarded || terms.get(opts.id) !== term) return
    // A dead pty is exactly what a person scrolls back through — what did it say before it went?
    // So its record is trimmed to the same limit a live one is held to, and to nothing else: an
    // «unlimited» setting that quietly kept four thousand characters of a finished agent would be
    // a limit under another name. The record still goes when the tab is closed, and at most
    // MAX_EXITED_TERMS of them are kept.
    trimToTail(term, bufferLimit)
    emit(CHANNELS.pty.exit, { id: opts.id, exitCode, gen: term.gen })
    rememberExited(opts.id)
  })

  const cmd = opts.initialCommand
  if (cmd) {
    // let the shell print its prompt first, otherwise the line gets eaten by rc-file output
    const boot = setTimeout(() => {
      if (term.alive && !term.discarded) term.proc.write(cmd + '\r')
    }, 400)
    // a terminal closed within those 400ms must not hold the event loop open
    boot.unref?.()
  }

  return { buffer: '', seq: 0, alive: true }
}

export function write(id: string, data: string): void {
  const t = terms.get(id)
  if (!t?.alive) return
  t.lastActivity = Date.now()
  trackCommand(id, t, data)
  t.proc.write(data)
}

/** reconstructs the command line the user typed, so shell tabs can show it */
function trackCommand(id: string, t: Term, data: string): void {
  for (const ch of data) {
    if (ch === '\r' || ch === '\n') {
      const cmd = t.inputLine.trim()
      t.inputLine = ''
      if (cmd && cmd !== t.lastCommand) {
        t.lastCommand = cmd
        emit(CHANNELS.pty.command, { id, command: cmd })
      }
      continue
    }
    if (ch === '\x7f' || ch === '\b') {
      t.inputLine = t.inputLine.slice(0, -1)
      continue
    }
    // ignore escape sequences (arrows, history navigation) and other control chars
    if (ch < ' ') {
      // Ctrl-C / Ctrl-U discard whatever was typed
      if (ch === '\x03' || ch === '\x15') t.inputLine = ''
      continue
    }
    t.inputLine += ch
  }
  if (t.inputLine.length > 200) t.inputLine = t.inputLine.slice(-200)
}

export function resize(id: string, cols: number, rows: number): void {
  const t = terms.get(id)
  if (!t?.alive) return
  try {
    t.proc.resize(Math.max(cols, 2), Math.max(rows, 2))
  } catch {
    /* pty may have died between checks */
  }
}

/** remembers the id of a finished process and forgets the oldest once too many records pile up */
function rememberExited(id: string): void {
  exitedOrder.push(id)
  while (exitedOrder.length > MAX_EXITED_TERMS) {
    const oldest = exitedOrder.shift()
    if (oldest === undefined) break
    const t = terms.get(oldest)
    if (t && !t.alive) terms.delete(oldest)
  }
}

export function kill(id: string): void {
  const t = terms.get(id)
  if (!t) return
  // `proc.kill()` only sends the signal: onExit lands 50-300ms later, by which time the renderer
  // may have restarted this id. Retire the record now so those late events stay silent.
  t.discarded = true
  if (t.flushTimer) clearTimeout(t.flushTimer)
  t.flushTimer = null
  t.pending = ''
  clearChunks(t)
  try {
    if (t.alive) t.proc.kill()
  } catch {
    /* ignore */
  }
  terms.delete(id)
  // the process is retired, so nothing it reported is about anything any more
  clearReports(id)
  const idx = exitedOrder.indexOf(id)
  if (idx !== -1) exitedOrder.splice(idx, 1)
}

/**
 * Forget what a terminal has printed, without touching the process.
 *
 * The text has two owners: the xterm instance in the renderer, which the pane clears itself, and
 * this buffer, which `start()` hands back whenever a pane re-attaches — after a session switch,
 * a window resize that remounts, a wake. Clearing one and not the other only postpones the
 * history: the next attach paints all of it back.
 *
 * Two fields are deliberately left alone. `seq` keeps counting, because an attaching pane uses
 * it to drop the events it has already been given (`e.seq > res.seq`); restarting the count
 * would have it write them a second time. And `pending` — up to 25ms of output on its way to the
 * renderer — is delivered as it is: it is a repaint in flight, and cutting one in half leaves
 * escape sequences without their ends. It has already been counted into the buffer, so that much
 * output is dropped from the replay copy while still reaching the screen; a screen and its record
 * differing by one frame is the smaller of the two faults.
 */
export function clearScrollback(id: string): void {
  const t = terms.get(id)
  if (!t) return
  clearChunks(t)
}

export function killAll(): void {
  for (const id of [...terms.keys()]) kill(id)
}

/**
 * Scrollback of a live terminal, read straight out of the main process. Nothing in the app
 * needs it — the renderer gets the buffer from `start()` and the stream from `pty:data`.
 * It exists for `smoke.ts`, which has no renderer to read output from and polls this instead.
 */
export function bufferOf(id: string): string {
  const t = terms.get(id)
  return t ? joinChunks(t) : ''
}

export function isAlive(id: string): boolean {
  return terms.get(id)?.alive ?? false
}
