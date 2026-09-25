import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

/**
 * agentHooks needs Electron only for `app.getPath('userData')` — the rest is file I/O and
 * parsing, and both are exercised for real against a temp directory. A report is a file written
 * by somebody else's process, so what matters here is what is refused, not what is accepted.
 *
 * The payloads below are the ones the shipped 2.1.220 binary actually wrote, captured from a
 * throwaway run: fields the app does not read are kept, because a parser has to survive them.
 */
const hoisted = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({ app: { getPath: () => hoisted.userData } }))

type Hooks = typeof import('../src/main/agentHooks')

const TERM = '11111111-2222-3333-4444-555555555555'
const SID = '37b09d99-26e9-4d94-a029-d1c7d0e2bfcc'
const TRANSCRIPT = `/home/u/.claude/projects/-tmp-work/${SID}.jsonl`

function payload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: SID,
    transcript_path: TRANSCRIPT,
    cwd: '/tmp/work',
    hook_event_name: 'SessionStart',
    source: 'clear',
    ...over,
  })
}

function stopPayload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: SID,
    transcript_path: TRANSCRIPT,
    cwd: '/tmp/work',
    prompt_id: '3fec0020-9ddf-4846-a628-da43167fe3d8',
    permission_mode: 'bypassPermissions',
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'ok',
    background_tasks: [],
    session_crons: [],
    ...over,
  })
}

function notePayload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: SID,
    transcript_path: TRANSCRIPT,
    cwd: '/tmp/work',
    prompt_id: 'dee25ace-9de7-464d-bcd3-47a6139bc87c',
    hook_event_name: 'Notification',
    message: 'Claude is waiting for your input',
    notification_type: 'idle_prompt',
    ...over,
  })
}

/**
 * The codex side, captured the same way: a real interactive session driven through a pty, with a
 * prompt that made it spawn subagents. `TURN` is what the tab itself wrote; `SUBTURN` is what a
 * subagent wrote **one second earlier**, through the same program, for the same prompt.
 */
const THREAD = '019fa071-49e1-7f23-b50e-de1155a76d1e'
const SUBTHREAD = '019fa071-8df5-72f2-9d04-1d9c221e687f'

function turnPayload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'agent-turn-complete',
    'thread-id': THREAD,
    'turn-id': '019fa071-8249-7c30-82e4-73aba9b0da9d',
    cwd: '/tmp/work',
    client: 'codex-tui',
    'input-messages': ['spawn two subagents'],
    'last-assistant-message': 'MAINDONE',
    ...over,
  })
}

/** a finished subagent: its own thread, no client, nothing it was asked by a person */
function subturnPayload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'agent-turn-complete',
    'thread-id': SUBTHREAD,
    'turn-id': '019fa071-8e1c-7973-9e58-98c9b341aea5',
    cwd: '/tmp/work',
    'input-messages': [],
    'last-assistant-message': 'ALPHA',
    ...over,
  })
}

let dir = ''
let hooks: Hooks

async function writeReport(terminalId: string, body: string): Promise<void> {
  await fs.mkdir(hooks.reportsDir(), { recursive: true })
  await fs.writeFile(join(hooks.reportsDir(), `${terminalId}.json`), body, 'utf8')
}

/** an event as the hooks publish it: one file per occurrence, the name unique and never parsed */
async function writeEvent(terminalId: string, kind: 'stop' | 'note', body: string, unique: string): Promise<void> {
  await fs.mkdir(hooks.reportsDir(), { recursive: true })
  await fs.writeFile(join(hooks.reportsDir(), `${terminalId}.${kind}.${unique}`), body, 'utf8')
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cs-hooks-'))
  hoisted.userData = dir
  vi.resetModules()
  hooks = await import('../src/main/agentHooks')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('parseSessionReport', () => {
  it('reads the conversation id out of a SessionStart payload', () => {
    expect(hooks.parseSessionReport(payload())).toEqual({ sessionId: SID, transcriptPath: TRANSCRIPT })
  })

  it('accepts every source the CLI has — the id is what matters, not the reason', () => {
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      expect(hooks.parseSessionReport(payload({ source }))?.sessionId).toBe(SID)
    }
  })

  it('refuses a half-written file', () => {
    expect(hooks.parseSessionReport(payload().slice(0, 40))).toBeNull()
    expect(hooks.parseSessionReport('')).toBeNull()
  })

  it('refuses anything that is not an object', () => {
    expect(hooks.parseSessionReport('"a string"')).toBeNull()
    expect(hooks.parseSessionReport('null')).toBeNull()
    expect(hooks.parseSessionReport('[]')).toBeNull()
  })

  it('refuses another event: only a start names the conversation that is beginning', () => {
    expect(hooks.parseSessionReport(payload({ hook_event_name: 'SessionEnd', reason: 'clear' }))).toBeNull()
    expect(hooks.parseSessionReport(stopPayload())).toBeNull()
    expect(hooks.parseSessionReport(payload({ hook_event_name: undefined }))).toBeNull()
  })

  it('refuses an id that is not a uuid', () => {
    expect(hooks.parseSessionReport(payload({ session_id: 'default' }))).toBeNull()
    expect(hooks.parseSessionReport(payload({ session_id: `../../${SID}` }))).toBeNull()
    expect(hooks.parseSessionReport(payload({ session_id: 42 }))).toBeNull()
    expect(hooks.parseSessionReport(payload({ session_id: undefined }))).toBeNull()
  })

  it('refuses a transcript that belongs to another conversation', () => {
    const other = '00000000-0000-4000-8000-000000000000'
    expect(hooks.parseSessionReport(payload({ transcript_path: `/p/${other}.jsonl` }))).toBeNull()
    expect(hooks.parseSessionReport(payload({ transcript_path: `/p/${SID}.json` }))).toBeNull()
    expect(hooks.parseSessionReport(payload({ transcript_path: '' }))).toBeNull()
    expect(hooks.parseSessionReport(payload({ transcript_path: undefined }))).toBeNull()
  })
})

describe('isEventReport', () => {
  it('takes the payload of the event it was asked about', () => {
    expect(hooks.isEventReport(stopPayload(), 'Stop')).toBe(true)
    expect(hooks.isEventReport(notePayload(), 'Notification')).toBe(true)
  })

  it('does not take one event for another', () => {
    expect(hooks.isEventReport(notePayload(), 'Stop')).toBe(false)
    expect(hooks.isEventReport(stopPayload(), 'Notification')).toBe(false)
    expect(hooks.isEventReport(payload(), 'Stop')).toBe(false)
  })

  it('refuses SubagentStop above all', () => {
    // the overlay never asks for it; if one ever arrived it would be the exact bell this
    // feature exists to stop ringing
    expect(hooks.isEventReport(stopPayload({ hook_event_name: 'SubagentStop' }), 'Stop')).toBe(false)
    expect(hooks.isEventReport(stopPayload({ hook_event_name: undefined }), 'Stop')).toBe(false)
  })

  it('refuses a half-written or nonsensical file', () => {
    expect(hooks.isEventReport(stopPayload().slice(0, 30), 'Stop')).toBe(false)
    expect(hooks.isEventReport('', 'Stop')).toBe(false)
    expect(hooks.isEventReport('[]', 'Stop')).toBe(false)
    expect(hooks.isEventReport(stopPayload({ session_id: 'nope' }), 'Stop')).toBe(false)
    expect(hooks.isEventReport(notePayload({ session_id: undefined }), 'Notification')).toBe(false)
  })

  it('survives fields it does not read', () => {
    expect(hooks.isEventReport(stopPayload({ something_new: { deeply: ['nested'] } }), 'Stop')).toBe(true)
    // `message` is the CLI's own wording and is never read: main writes no interface copy
    expect(hooks.isEventReport(notePayload({ message: undefined }), 'Notification')).toBe(true)
  })

  it('is claude’s alone: a codex payload is no event of ours', () => {
    // the notify program writes state and nothing else, so a codex tab's counts stay at zero —
    // which is what they have always been, since a codex tab has never rung
    expect(hooks.isEventReport(turnPayload(), 'Stop')).toBe(false)
    expect(hooks.isEventReport(turnPayload(), 'Notification')).toBe(false)
  })
})

describe('parseNotifyReport', () => {
  it('reads the thread out of a finished turn', () => {
    expect(hooks.parseNotifyReport(turnPayload())).toEqual({ sessionId: THREAD })
  })

  it('refuses a finished subagent, which names somebody else’s thread', () => {
    // measured: for one prompt codex called the program three times, twice for subagents, and
    // the subagents' calls arrived first. The last writer wins the state file, so without this
    // the tab would rebind to a subagent's thread and resume a conversation that is not its own.
    expect(hooks.parseNotifyReport(subturnPayload())).toBeNull()
    expect(hooks.parseNotifyReport(turnPayload({ client: undefined }))).toBeNull()
    expect(hooks.parseNotifyReport(turnPayload({ client: '' }))).toBeNull()
    expect(hooks.parseNotifyReport(turnPayload({ client: 42 }))).toBeNull()
  })

  it('takes any client, not codex-tui alone', () => {
    // what matters is that some front-end owns this conversation; a subagent has none
    expect(hooks.parseNotifyReport(turnPayload({ client: 'codex-exec' }))?.sessionId).toBe(THREAD)
  })

  it('refuses a call of a kind it does not understand', () => {
    expect(hooks.parseNotifyReport(turnPayload({ type: 'agent-turn-failed' }))).toBeNull()
    expect(hooks.parseNotifyReport(turnPayload({ type: undefined }))).toBeNull()
  })

  it('refuses a thread that is not a thread id', () => {
    expect(hooks.parseNotifyReport(turnPayload({ 'thread-id': 'default' }))).toBeNull()
    expect(hooks.parseNotifyReport(turnPayload({ 'thread-id': `../../${THREAD}` }))).toBeNull()
    expect(hooks.parseNotifyReport(turnPayload({ 'thread-id': undefined }))).toBeNull()
  })

  it('refuses a half-written file, and anything that is not an object', () => {
    expect(hooks.parseNotifyReport(turnPayload().slice(0, 40))).toBeNull()
    expect(hooks.parseNotifyReport('')).toBeNull()
    expect(hooks.parseNotifyReport('[]')).toBeNull()
    expect(hooks.parseNotifyReport('null')).toBeNull()
  })

  it('survives fields it does not read', () => {
    expect(hooks.parseNotifyReport(turnPayload({ 'something-new': { deeply: ['nested'] } }))?.sessionId).toBe(THREAD)
  })

  it('does not take a claude payload for a codex one, or the other way round', () => {
    expect(hooks.parseNotifyReport(payload())).toBeNull()
    expect(hooks.parseNotifyReport(stopPayload())).toBeNull()
    expect(hooks.parseSessionReport(turnPayload())).toBeNull()
  })
})

describe('isTerminalId', () => {
  it('takes a uuid and nothing else — the id is used as a file name', () => {
    expect(hooks.isTerminalId(TERM)).toBe(true)
    expect(hooks.isTerminalId('../../state')).toBe(false)
    expect(hooks.isTerminalId(`${TERM}/../x`)).toBe(false)
    expect(hooks.isTerminalId('')).toBe(false)
  })
})

describe('takeHookReport — the conversation', () => {
  it('reads the file named after the tab', async () => {
    await writeReport(TERM, payload())
    expect((await hooks.takeHookReport(TERM)).session?.sessionId).toBe(SID)
  })

  it('reads a codex thread out of the same file', async () => {
    await writeReport(TERM, turnPayload())
    expect(await hooks.takeHookReport(TERM)).toEqual({ session: { sessionId: THREAD }, stops: 0, notifications: 0 })
  })

  it('is null while the last thing written was a subagent’s turn', async () => {
    // the program cannot tell them apart, so a subagent's payload can sit in the state file. The
    // tab keeps the id it already has, and the next turn of the main agent overwrites this.
    await writeReport(TERM, subturnPayload())
    expect((await hooks.takeHookReport(TERM)).session).toBeNull()
  })

  it('is null when no hook has run for this tab', async () => {
    await fs.mkdir(hooks.reportsDir(), { recursive: true })
    expect(await hooks.takeHookReport(TERM)).toEqual({ session: null, stops: 0, notifications: 0 })
  })

  it('is null when the reports directory does not exist at all', async () => {
    expect(await hooks.takeHookReport(TERM)).toEqual({ session: null, stops: 0, notifications: 0 })
  })

  it('never reads outside the reports directory', async () => {
    await writeReport(TERM, payload())
    expect(await hooks.takeHookReport(`../reports/${TERM}`)).toEqual({ session: null, stops: 0, notifications: 0 })
  })
})

describe('takeHookReport — events', () => {
  const empty = { session: null, stops: 0, notifications: 0 }

  it('counts a turn and consumes it, so it rings exactly once', async () => {
    await writeEvent(TERM, 'stop', stopPayload(), '1785100765.457196')
    expect((await hooks.takeHookReport(TERM)).stops).toBe(1)
    expect((await hooks.takeHookReport(TERM)).stops).toBe(0)
  })

  it('keeps two turns that landed inside one interval apart', async () => {
    await writeEvent(TERM, 'stop', stopPayload(), '1785100765.457196')
    await writeEvent(TERM, 'stop', stopPayload(), '1785100765.457301')
    expect((await hooks.takeHookReport(TERM)).stops).toBe(2)
  })

  it('does not collapse the turns of two tabs into one', async () => {
    const other = '99999999-8888-7777-6666-555555555555'
    await writeEvent(TERM, 'stop', stopPayload(), '1.1')
    await writeEvent(other, 'stop', stopPayload(), '1.2')
    expect((await hooks.takeHookReport(TERM)).stops).toBe(1)
    expect((await hooks.takeHookReport(other)).stops).toBe(1)
  })

  it('counts a call for attention apart from a finished turn', async () => {
    // they are not the same event: a Stop ends a turn, a Notification interrupts one, and only
    // the renderer knows what to do about that
    await writeEvent(TERM, 'stop', stopPayload(), '1.1')
    await writeEvent(TERM, 'note', notePayload(), '1.2')
    await writeEvent(TERM, 'note', notePayload(), '1.3')
    const report = await hooks.takeHookReport(TERM)
    expect([report.stops, report.notifications]).toEqual([1, 2])
  })

  it('consumes a file it could not make sense of, so it is not read again for ever', async () => {
    await writeEvent(TERM, 'stop', 'not json at all', '1.1')
    await writeEvent(TERM, 'stop', stopPayload({ hook_event_name: 'SubagentStop' }), '1.2')
    await writeEvent(TERM, 'note', notePayload({ hook_event_name: 'Stop' }), '1.3')
    expect(await hooks.takeHookReport(TERM)).toEqual(empty)
    expect(await fs.readdir(hooks.reportsDir())).toEqual([])
  })

  it('comes back with the conversation and the events together', async () => {
    await writeReport(TERM, payload())
    await writeEvent(TERM, 'stop', stopPayload(), '1.1')
    await writeEvent(TERM, 'note', notePayload(), '1.2')
    expect(await hooks.takeHookReport(TERM)).toEqual({
      session: { sessionId: SID, transcriptPath: TRANSCRIPT },
      stops: 1,
      notifications: 1,
    })
  })
})

describe('clearReports', () => {
  it('removes everything the tab left and nothing a neighbour did', async () => {
    const other = '99999999-8888-7777-6666-555555555555'
    await writeReport(TERM, payload())
    await writeEvent(TERM, 'stop', stopPayload(), '1.1')
    await writeReport(other, payload())
    await writeEvent(other, 'stop', stopPayload(), '1.2')
    hooks.clearReports(TERM)
    await vi.waitFor(async () =>
      expect(await hooks.takeHookReport(TERM)).toEqual({ session: null, stops: 0, notifications: 0 }),
    )
    const kept = await hooks.takeHookReport(other)
    expect([kept.session?.sessionId, kept.stops]).toEqual([SID, 1])
  })

  it('refuses a name that is not a terminal id', async () => {
    await writeReport(TERM, payload())
    hooks.clearReports(`../reports/${TERM}`)
    await new Promise((r) => setTimeout(r, 20))
    expect((await hooks.takeHookReport(TERM)).session).not.toBeNull()
  })
})

describe('hookPaths', () => {
  it('asks for three events, and for nothing else', async () => {
    const paths = await hooks.hookPaths()
    expect(paths).toEqual({
      settings: join(dir, 'agent-hooks', 'settings.json'),
      notify: join(dir, 'agent-hooks', 'codex-notify.sh'),
      // the other half a claude tab is started with: the tool it opens a session through
      mcp: join(dir, 'agent-tools', 'mcp.json'),
    })
    const parsed = JSON.parse(await fs.readFile(paths?.settings as string, 'utf8')) as {
      hooks: Record<string, { hooks: { type: string; command: string }[] }[]>
    }
    // SubagentStop is the one that must never be here: it is what rang for a finished subagent
    expect(Object.keys(parsed.hooks)).toEqual(['SessionStart', 'Stop', 'Notification'])
    for (const event of ['SessionStart', 'Stop', 'Notification']) {
      const hook = parsed.hooks[event]?.[0]?.hooks[0]
      expect(hook?.type).toBe('command')
      expect(hook?.command).toContain('$CLAUDE_STUDIO_HOOK_DIR')
      expect(hook?.command).toContain('$CLAUDE_STUDIO_SESSION')
    }
  })

  it('sweeps the previous run: no pty exists yet, so every report and turn is stale', async () => {
    await writeReport(TERM, payload())
    await writeEvent(TERM, 'stop', stopPayload(), '1.1')
    await hooks.hookPaths()
    expect(await hooks.takeHookReport(TERM)).toEqual({ session: null, stops: 0, notifications: 0 })
  })

  it('is prepared once, so a later report is not swept away', async () => {
    await hooks.hookPaths()
    await writeReport(TERM, payload())
    await hooks.hookPaths()
    expect((await hooks.takeHookReport(TERM)).session).not.toBeNull()
  })

  it('is null when userData cannot be written, and nothing throws', async () => {
    hoisted.userData = join(dir, 'file-in-the-way')
    await fs.writeFile(hoisted.userData, 'not a directory', 'utf8')
    vi.resetModules()
    const fresh = (await import('../src/main/agentHooks')) as Hooks
    expect(await fresh.hookPaths()).toBeNull()
    expect(await fresh.takeHookReport(TERM)).toEqual({ session: null, stops: 0, notifications: 0 })
  })
})

/**
 * The hooks are lines of shell, and a line of shell that goes wrong says nothing to anybody —
 * the CLI neither reports nor retries. So they are run here for real, the way the CLI runs them:
 * a shell, the tab's environment, the payload on stdin.
 */
describe('the hook commands themselves', () => {
  const env = (): NodeJS.ProcessEnv => ({
    ...process.env,
    CLAUDE_STUDIO_HOOK_DIR: hooks.reportsDir(),
    CLAUDE_STUDIO_SESSION: TERM,
  })

  async function commandFor(event: 'SessionStart' | 'Stop' | 'Notification'): Promise<string> {
    const paths = await hooks.hookPaths()
    const parsed = JSON.parse(await fs.readFile(paths?.settings as string, 'utf8')) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>
    }
    return parsed.hooks[event]?.[0]?.hooks[0]?.command ?? ''
  }

  function run(command: string, vars: NodeJS.ProcessEnv, stdin: string): Promise<{ out: string; code: number }> {
    return new Promise((resolve) => {
      const child = spawn('/bin/sh', ['-c', command], { env: vars })
      let out = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => (out += chunk))
      child.on('close', (code) => resolve({ out, code: code ?? -1 }))
      child.stdin.end(stdin)
    })
  }

  it('SessionStart writes the payload under the tab’s name and prints nothing', async () => {
    const { out, code } = await run(await commandFor('SessionStart'), env(), payload())
    expect(out).toBe('') // stdout of a SessionStart hook is fed to the agent as context
    expect(code).toBe(0)
    expect((await hooks.takeHookReport(TERM)).session?.sessionId).toBe(SID)
  })

  it('SessionStart overwrites the previous report of the same tab', async () => {
    const command = await commandFor('SessionStart')
    await run(command, env(), payload({ source: 'startup' }))
    const next = '00000000-1111-4222-8333-444444444444'
    await run(command, env(), payload({ session_id: next, transcript_path: `/p/${next}.jsonl`, source: 'clear' }))
    expect((await hooks.takeHookReport(TERM)).session?.sessionId).toBe(next)
  })

  it('Stop leaves one file per turn rather than overwriting', async () => {
    const command = await commandFor('Stop')
    await run(command, env(), stopPayload())
    await run(command, env(), stopPayload())
    await run(command, env(), stopPayload())
    expect((await hooks.takeHookReport(TERM)).stops).toBe(3)
  })

  it('Notification lands beside the turns, not among them', async () => {
    await run(await commandFor('Stop'), env(), stopPayload())
    await run(await commandFor('Notification'), env(), notePayload())
    const report = await hooks.takeHookReport(TERM)
    expect([report.stops, report.notifications]).toEqual([1, 1])
  })

  it('the three hooks do not tread on each other', async () => {
    await run(await commandFor('SessionStart'), env(), payload())
    await run(await commandFor('Stop'), env(), stopPayload())
    await run(await commandFor('Notification'), env(), notePayload())
    const report = await hooks.takeHookReport(TERM)
    expect([report.session?.sessionId, report.stops, report.notifications]).toEqual([SID, 1, 1])
  })

  it('leaves no temp file behind', async () => {
    await run(await commandFor('SessionStart'), env(), payload())
    await run(await commandFor('Stop'), env(), stopPayload())
    await run(await commandFor('Notification'), env(), notePayload())
    const names = await fs.readdir(hooks.reportsDir())
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
    expect(names).toHaveLength(3)
  })

  it('exits quietly when the app did not mark this terminal', async () => {
    const bare = { ...env(), CLAUDE_STUDIO_SESSION: '' }
    for (const event of ['SessionStart', 'Stop', 'Notification'] as const) {
      const { out, code } = await run(await commandFor(event), bare, payload())
      expect([out, code]).toEqual(['', 0])
    }
    expect(await fs.readdir(hooks.reportsDir())).toEqual([])
  })

  it('exits quietly when the reports directory is gone', async () => {
    const start = await commandFor('SessionStart')
    const stop = await commandFor('Stop')
    const note = await commandFor('Notification')
    await rm(hooks.reportsDir(), { recursive: true, force: true })
    expect([
      await run(start, env(), payload()),
      await run(stop, env(), stopPayload()),
      await run(note, env(), notePayload()),
    ]).toEqual([
      { out: '', code: 0 },
      { out: '', code: 0 },
      { out: '', code: 0 },
    ])
  })
})

/**
 * The notify program is a file codex executes with the payload as its first argument, and a
 * program that goes wrong says nothing to anybody — codex neither reports nor retries. So it is
 * run here the way codex runs it: the tab's environment, one argument, nothing on stdin.
 */
describe('the notify program itself', () => {
  const env = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    ...process.env,
    CLAUDE_STUDIO_HOOK_DIR: hooks.reportsDir(),
    CLAUDE_STUDIO_SESSION: TERM,
    ...over,
  })

  async function program(): Promise<string> {
    const paths = await hooks.hookPaths()
    return paths?.notify ?? ''
  }

  function run(path: string, arg: string, vars: NodeJS.ProcessEnv): Promise<{ out: string; code: number }> {
    return new Promise((resolve) => {
      const child = spawn(path, [arg], { env: vars })
      let out = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => (out += chunk))
      child.on('close', (code) => resolve({ out, code: code ?? -1 }))
      child.stdin.end()
    })
  }

  it('is written where it can be run at all', async () => {
    const path = await program()
    expect(path).toBe(join(dir, 'agent-hooks', 'codex-notify.sh'))
    const stat = await fs.stat(path)
    expect(stat.mode & 0o111).toBeTruthy()
  })

  it('names the tab’s conversation, and rings nothing', async () => {
    const { out, code } = await run(await program(), turnPayload(), env())
    expect([out, code]).toEqual(['', 0])
    expect(await hooks.takeHookReport(TERM)).toEqual({ session: { sessionId: THREAD }, stops: 0, notifications: 0 })
  })

  it('leaves exactly one file, whatever it is called with', async () => {
    // state, and nothing else: a codex turn has never rung here, and a bell for it would be a
    // change of its own rather than part of learning the id
    const path = await program()
    await run(path, turnPayload(), env())
    await run(path, turnPayload(), env())
    expect(await fs.readdir(hooks.reportsDir())).toEqual([`${TERM}.json`])
  })

  it('follows the conversation when codex leaves the old one', async () => {
    const next = '019fa081-e6ae-7ee0-a3ce-a252dd29ea12'
    const path = await program()
    await run(path, turnPayload(), env())
    await run(path, turnPayload({ 'thread-id': next }), env())
    expect((await hooks.takeHookReport(TERM)).session?.sessionId).toBe(next)
  })

  it('leaves no temp file behind', async () => {
    await run(await program(), turnPayload(), env())
    const names = await fs.readdir(hooks.reportsDir())
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
    expect(names).toHaveLength(1)
  })

  it('does not tread on a neighbouring tab', async () => {
    const other = '99999999-8888-7777-6666-555555555555'
    const path = await program()
    await run(path, turnPayload(), env())
    await run(path, turnPayload({ 'thread-id': SUBTHREAD, client: 'codex-tui' }), env({ CLAUDE_STUDIO_SESSION: other }))
    expect([
      (await hooks.takeHookReport(TERM)).session?.sessionId,
      (await hooks.takeHookReport(other)).session?.sessionId,
    ]).toEqual([THREAD, SUBTHREAD])
  })

  it('exits quietly when the app did not mark this terminal', async () => {
    const path = await program()
    for (const vars of [env({ CLAUDE_STUDIO_SESSION: '' }), env({ CLAUDE_STUDIO_HOOK_DIR: '' })]) {
      expect(await run(path, turnPayload(), vars)).toEqual({ out: '', code: 0 })
    }
    expect(await fs.readdir(hooks.reportsDir())).toEqual([])
  })

  it('exits quietly when codex called it with nothing', async () => {
    expect(await run(await program(), '', env())).toEqual({ out: '', code: 0 })
    expect(await fs.readdir(hooks.reportsDir())).toEqual([])
  })

  it('exits quietly when the reports directory is gone', async () => {
    const path = await program()
    await rm(hooks.reportsDir(), { recursive: true, force: true })
    expect(await run(path, turnPayload(), env())).toEqual({ out: '', code: 0 })
  })

  it('says nothing about a payload it does not understand — that is main’s business', async () => {
    // the program writes what it was handed; a subagent's turn is refused where the parser is,
    // and the tab is left with no reported conversation rather than with somebody else's
    await run(await program(), subturnPayload(), env())
    expect(await hooks.takeHookReport(TERM)).toEqual({ session: null, stops: 0, notifications: 0 })
  })
})
