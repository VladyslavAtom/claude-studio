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
    message: 'Claude needs your permission to use Bash',
    notification_type: 'permission_prompt',
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
    expect(await hooks.takeHookReport(TERM)).toEqual({
      session: { sessionId: THREAD },
      stops: 0,
      notifications: 0,
      permission: null,
      activity: null,
    })
  })

  it('is null while the last thing written was a subagent’s turn', async () => {
    // the program cannot tell them apart, so a subagent's payload can sit in the state file. The
    // tab keeps the id it already has, and the next turn of the main agent overwrites this.
    await writeReport(TERM, subturnPayload())
    expect((await hooks.takeHookReport(TERM)).session).toBeNull()
  })

  it('is null when no hook has run for this tab', async () => {
    await fs.mkdir(hooks.reportsDir(), { recursive: true })
    expect(await hooks.takeHookReport(TERM)).toEqual({
      session: null,
      stops: 0,
      notifications: 0,
      permission: null,
      activity: null,
    })
  })

  it('is null when the reports directory does not exist at all', async () => {
    expect(await hooks.takeHookReport(TERM)).toEqual({
      session: null,
      stops: 0,
      notifications: 0,
      permission: null,
      activity: null,
    })
  })

  it('never reads outside the reports directory', async () => {
    await writeReport(TERM, payload())
    expect(await hooks.takeHookReport(`../reports/${TERM}`)).toEqual({
      session: null,
      stops: 0,
      notifications: 0,
      permission: null,
      activity: null,
    })
  })
})

describe('takeHookReport — events', () => {
  const empty = { session: null, stops: 0, notifications: 0, permission: null, activity: null }

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
      permission: null,
      activity: null,
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
      expect(await hooks.takeHookReport(TERM)).toEqual({
        session: null,
        stops: 0,
        notifications: 0,
        permission: null,
        activity: null,
      }),
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
  it('asks for four events, and for nothing else', async () => {
    const paths = await hooks.hookPaths()
    expect(paths).toEqual({
      settings: join(dir, 'agent-hooks', 'settings.json'),
      notify: join(dir, 'agent-hooks', 'codex-notify.sh'),
      codexHooks: hooks.codexHookOverrides(join(dir, 'agent-hooks', 'codex-state.sh')),
      // the other half a claude tab is started with: the tool it opens a session through
      mcp: join(dir, 'agent-tools', 'mcp.json'),
    })
    const parsed = JSON.parse(await fs.readFile(paths?.settings as string, 'utf8')) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }[]>
    }
    // SubagentStop is the one that must never be here: it is what rang for a finished subagent
    expect(Object.keys(parsed.hooks)).toEqual(['SessionStart', 'Stop', 'Notification', 'PermissionRequest'])
    for (const event of ['SessionStart', 'Stop', 'Notification']) {
      const hook = parsed.hooks[event]?.[0]?.hooks[0]
      expect(hook?.type).toBe('command')
      expect(hook?.command).toContain('$CLAUDE_STUDIO_HOOK_DIR')
      expect(hook?.command).toContain('$CLAUDE_STUDIO_SESSION')
    }
    const permission = parsed.hooks.PermissionRequest?.[0]?.hooks[0]
    expect(permission?.command).toBe(`sh '${join(dir, 'agent-hooks', 'permission.sh')}'`)
    // the CLI's limit sits above the program's own wait, so the program always ends by itself
    expect(permission?.timeout).toBeGreaterThan(900)
  })

  it('asks to be told of a real block only: idle_prompt is not one', async () => {
    const paths = await hooks.hookPaths()
    const parsed = JSON.parse(await fs.readFile(paths?.settings as string, 'utf8')) as {
      hooks: Record<string, { matcher?: string }[]>
    }
    const matcher = new RegExp(`^(?:${parsed.hooks.Notification?.[0]?.matcher ?? ''})$`)
    for (const type of ['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog']) {
      expect(matcher.test(type)).toBe(true)
    }
    for (const type of ['idle_prompt', 'auth_success', 'agent_completed', 'elicitation_complete']) {
      expect(matcher.test(type)).toBe(false)
    }
  })

  it('sweeps the previous run: no pty exists yet, so every report and turn is stale', async () => {
    await writeReport(TERM, payload())
    await writeEvent(TERM, 'stop', stopPayload(), '1.1')
    await hooks.hookPaths()
    expect(await hooks.takeHookReport(TERM)).toEqual({
      session: null,
      stops: 0,
      notifications: 0,
      permission: null,
      activity: null,
    })
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
    expect(await fresh.takeHookReport(TERM)).toEqual({
      session: null,
      stops: 0,
      notifications: 0,
      permission: null,
      activity: null,
    })
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
    expect(await hooks.takeHookReport(TERM)).toEqual({
      session: { sessionId: THREAD },
      stops: 0,
      notifications: 0,
      permission: null,
      activity: null,
    })
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
    expect(await hooks.takeHookReport(TERM)).toEqual({
      session: null,
      stops: 0,
      notifications: 0,
      permission: null,
      activity: null,
    })
  })
})

/**
 * A permission prompt, as the CLI hands it to `PermissionRequest` (shape from the 2.1.312 binary's
 * own schema: the common fields, `tool_name`, `tool_input`, optional `permission_suggestions`; no
 * `tool_use_id`).
 */
function askPayload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: SID,
    transcript_path: TRANSCRIPT,
    cwd: '/tmp/work',
    permission_mode: 'default',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf node_modules', description: 'Remove node_modules' },
    permission_suggestions: [
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'rm -rf node_modules' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
    ...over,
  })
}

async function writeAsk(terminalId: string, askId: string, body: string): Promise<void> {
  await fs.mkdir(hooks.reportsDir(), { recursive: true })
  await fs.writeFile(join(hooks.reportsDir(), `${terminalId}.ask.${askId}`), body, 'utf8')
}

describe('parsePermissionRequest', () => {
  it('names the tool and what it would act on', () => {
    expect(hooks.parsePermissionRequest(askPayload())).toEqual({ tool: 'Bash', detail: 'rm -rf node_modules' })
  })

  it('takes the path of a file tool, and no detail when there is nothing to show', () => {
    const edit = askPayload({
      tool_name: 'Edit',
      tool_input: { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' },
    })
    expect(hooks.parsePermissionRequest(edit)).toEqual({ tool: 'Edit', detail: '/w/a.ts' })
    const bare = askPayload({ tool_name: 'mcp__srv__do', tool_input: { n: 1 } })
    expect(hooks.parsePermissionRequest(bare)).toEqual({ tool: 'mcp__srv__do', detail: null })
  })

  it('folds and clips a long command', () => {
    const long = askPayload({ tool_input: { command: 'echo\n' + 'x'.repeat(500) } })
    const detail = hooks.parsePermissionRequest(long)?.detail ?? ''
    expect(detail.startsWith('echo x')).toBe(true)
    expect(detail.length).toBe(300)
  })

  it('leaves a subagent’s request to the CLI', () => {
    expect(hooks.parsePermissionRequest(askPayload({ agent_id: 'a1', agent_type: 'general-purpose' }))).toBeNull()
  })

  it('leaves a prompt that is itself the answer to the terminal', () => {
    expect(hooks.parsePermissionRequest(askPayload({ tool_name: 'AskUserQuestion' }))).toBeNull()
    expect(hooks.parsePermissionRequest(askPayload({ tool_name: 'ExitPlanMode' }))).toBeNull()
  })

  it('refuses another event, a broken payload and a request with nothing to show', () => {
    expect(hooks.parsePermissionRequest(askPayload({ hook_event_name: 'PreToolUse' }))).toBeNull()
    expect(hooks.parsePermissionRequest('{"hook_event_name":"Permis')).toBeNull()
    expect(hooks.parsePermissionRequest(askPayload({ tool_name: '' }))).toBeNull()
    expect(hooks.parsePermissionRequest(askPayload({ tool_input: 'rm' }))).toBeNull()
    expect(hooks.parsePermissionRequest(askPayload({ session_id: 'x' }))).toBeNull()
  })
})

describe('permissionOutput', () => {
  it('is the CLI’s own decision shape, and nothing more', () => {
    expect(JSON.parse(hooks.permissionOutput('allow'))).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    })
    const deny = JSON.parse(hooks.permissionOutput('deny')) as {
      hookSpecificOutput: { decision: { behavior: string; message: string; interrupt?: boolean } }
    }
    expect(deny.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(typeof deny.hookSpecificOutput.decision.message).toBe('string')
    // a deny lets the agent go on; stopping the turn is not what the person clicked
    expect(deny.hookSpecificOutput.decision.interrupt).toBeUndefined()
  })
})

describe('takeHookReport — permission prompts', () => {
  it('offers the open prompt and does not consume it', async () => {
    await writeAsk(TERM, '100.7', askPayload())
    const ask = { id: '100.7', tool: 'Bash', detail: 'rm -rf node_modules' }
    expect((await hooks.takeHookReport(TERM)).permission).toEqual(ask)
    expect((await hooks.takeHookReport(TERM)).permission).toEqual(ask)
  })

  it('keeps the newest only, and withdraws the older ones', async () => {
    await writeAsk(TERM, '100.7', askPayload())
    await writeAsk(TERM, '100.12', askPayload({ tool_input: { command: 'ls' } }))
    await writeAsk(TERM, '99.900', askPayload())
    expect((await hooks.takeHookReport(TERM)).permission?.id).toBe('100.12')
    expect(await fs.readdir(hooks.reportsDir())).toEqual([`${TERM}.ask.100.12`])
  })

  it('withdraws every prompt once the turn has ended', async () => {
    await writeAsk(TERM, '100.7', askPayload())
    await writeEvent(TERM, 'stop', stopPayload(), '101.1')
    const report = await hooks.takeHookReport(TERM)
    expect([report.stops, report.permission]).toEqual([1, null])
    expect(await fs.readdir(hooks.reportsDir())).toEqual([])
  })

  it('withdraws a request the window must not offer', async () => {
    await writeAsk(TERM, '100.7', askPayload({ agent_id: 'a1' }))
    expect((await hooks.takeHookReport(TERM)).permission).toBeNull()
    expect(await fs.readdir(hooks.reportsDir())).toEqual([])
  })
})

describe('answerPermission', () => {
  it('leaves the answer beside the ask, once', async () => {
    await writeAsk(TERM, '100.7', askPayload())
    expect(await hooks.answerPermission(TERM, '100.7', 'deny')).toBe(true)
    // a second click — or a second answer of the other kind — changes nothing
    expect(await hooks.answerPermission(TERM, '100.7', 'allow')).toBe(false)
    const written = await fs.readFile(join(hooks.reportsDir(), `${TERM}.answer.100.7`), 'utf8')
    expect(written).toBe(hooks.permissionOutput('deny'))
    expect((await fs.readdir(hooks.reportsDir())).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('answers nothing that is not open', async () => {
    expect(await hooks.answerPermission(TERM, '100.7', 'allow')).toBe(false)
    await writeAsk(TERM, '100.7', askPayload())
    expect(await hooks.answerPermission(TERM, '../100.7', 'allow')).toBe(false)
    expect(await hooks.answerPermission(`../${TERM}`, '100.7', 'allow')).toBe(false)
    expect(await hooks.answerPermission(TERM, '100.7', 'always' as 'allow')).toBe(false)
    expect(await fs.readdir(hooks.reportsDir())).toEqual([`${TERM}.ask.100.7`])
  })
})

/**
 * The permission program, run the way the CLI runs it: `sh <path>`, the payload on stdin, the
 * tab's environment. The wait is cut to seconds through the variable that exists for this.
 */
describe('the permission program itself', () => {
  const env = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    ...process.env,
    CLAUDE_STUDIO_HOOK_DIR: hooks.reportsDir(),
    CLAUDE_STUDIO_SESSION: TERM,
    CLAUDE_STUDIO_PERMISSION_WAIT: '3',
    ...over,
  })

  async function start(vars: NodeJS.ProcessEnv, stdin: string): Promise<{ out: string; code: number }> {
    await hooks.hookPaths()
    const path = join(dir, 'agent-hooks', 'permission.sh')
    return new Promise((resolve) => {
      const child = spawn('/bin/sh', [path], { env: vars })
      let out = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => (out += chunk))
      child.on('close', (code) => resolve({ out, code: code ?? -1 }))
      child.stdin.on('error', () => undefined) // a program that exits before reading closes the pipe
      child.stdin.end(stdin)
    })
  }

  async function openAsk(): Promise<string> {
    let id = ''
    await vi.waitFor(
      async () => {
        const ask = (await hooks.takeHookReport(TERM)).permission
        expect(ask).not.toBeNull()
        id = ask?.id ?? ''
      },
      { timeout: 2000, interval: 50 },
    )
    return id
  }

  it('prints the window’s answer and cleans up after itself', async () => {
    const done = start(env(), askPayload())
    const id = await openAsk()
    expect(await hooks.answerPermission(TERM, id, 'allow')).toBe(true)
    expect(await done).toEqual({ out: hooks.permissionOutput('allow'), code: 0 })
    expect(await fs.readdir(hooks.reportsDir())).toEqual([])
  })

  it('decides nothing when nobody clicks: the wait runs out, silently', async () => {
    const { out, code } = await start(env({ CLAUDE_STUDIO_PERMISSION_WAIT: '1' }), askPayload())
    expect([out, code]).toEqual(['', 0])
    expect(await fs.readdir(hooks.reportsDir())).toEqual([])
  })

  it('stops waiting, silently, when main withdraws the ask', async () => {
    const done = start(env({ CLAUDE_STUDIO_PERMISSION_WAIT: '30' }), askPayload())
    await openAsk()
    await writeEvent(TERM, 'stop', stopPayload(), '1.1')
    await hooks.takeHookReport(TERM)
    expect(await done).toEqual({ out: '', code: 0 })
  })

  it('does not wait at all for a subagent or for a prompt that is the answer', async () => {
    for (const body of [
      askPayload({ agent_id: 'a1' }),
      askPayload({ tool_name: 'AskUserQuestion' }),
      askPayload({ tool_name: 'ExitPlanMode' }),
    ]) {
      expect(await start(env({ CLAUDE_STUDIO_PERMISSION_WAIT: '30' }), body)).toEqual({ out: '', code: 0 })
    }
    expect(await fs.readdir(hooks.reportsDir())).toEqual([])
  })

  it('falls through at once when the app did not mark this terminal or its directory is gone', async () => {
    expect(await start(env({ CLAUDE_STUDIO_SESSION: '' }), askPayload())).toEqual({ out: '', code: 0 })
    await hooks.hookPaths()
    await rm(hooks.reportsDir(), { recursive: true, force: true })
    expect(await start(env(), askPayload())).toEqual({ out: '', code: 0 })
  })
})

describe('codexHookOverrides', () => {
  const overrides = (): string[] => hooks.codexHookOverrides('/home/u/.config/claude-studio/agent-hooks/codex-state.sh')

  it('gives codex one override per lifecycle event, each running the same program', () => {
    const list = overrides()
    expect(list.map((o) => o.slice(0, o.indexOf('=')))).toEqual([
      'hooks.SessionStart',
      'hooks.UserPromptSubmit',
      'hooks.PreToolUse',
      'hooks.PermissionRequest',
      'hooks.PostToolUse',
      'hooks.Stop',
      'hooks.Interrupt',
      'hooks.SessionEnd',
    ])
    for (const o of list) {
      const event = o.slice('hooks.'.length, o.indexOf('='))
      expect(o).toContain(`command="sh '/home/u/.config/claude-studio/agent-hooks/codex-state.sh' ${event}"`)
    }
  })

  it('asks PreToolUse about the question tool only', () => {
    const pre = overrides().find((o) => o.startsWith('hooks.PreToolUse=')) ?? ''
    expect(pre).toContain('matcher="^request_user_input$"')
    expect(overrides().filter((o) => o.includes('matcher='))).toHaveLength(1)
  })

  it('is the same text every time: codex trusts a hook by the hash of its definition', () => {
    expect(overrides()).toEqual(overrides())
  })

  it('escapes what would end the TOML string early', () => {
    const [first] = hooks.codexHookOverrides('/home/u/we"ird\\dir/codex-state.sh')
    expect(first).toContain(`command="sh '/home/u/we\\"ird\\\\dir/codex-state.sh' SessionStart"`)
  })
})

describe('codexActivity', () => {
  it('reads the last event as a state', () => {
    expect(hooks.codexActivity('UserPromptSubmit')).toBe('busy')
    expect(hooks.codexActivity('PostToolUse')).toBe('busy')
    expect(hooks.codexActivity('PermissionRequest')).toBe('waiting')
    expect(hooks.codexActivity('PreToolUse')).toBe('waiting')
    expect(hooks.codexActivity('Stop')).toBe('idle')
    expect(hooks.codexActivity('Interrupt')).toBe('idle')
    expect(hooks.codexActivity('SessionStart')).toBe('idle')
  })

  it('has no opinion once the session ended, or about a word it does not know', () => {
    expect(hooks.codexActivity('SessionEnd')).toBeNull()
    expect(hooks.codexActivity('')).toBeNull()
    expect(hooks.codexActivity('Notification')).toBeNull()
  })
})

/**
 * The codex state program, run the way codex runs a command hook: a shell, the event's name as
 * the argument the override gives it, the payload on stdin, the tab's environment.
 */
describe('the codex state program itself', () => {
  const env = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    ...process.env,
    CLAUDE_STUDIO_HOOK_DIR: hooks.reportsDir(),
    CLAUDE_STUDIO_SESSION: TERM,
    ...over,
  })

  async function fire(
    event: string,
    vars: NodeJS.ProcessEnv = env(),
    stdin = '{"x":1}',
  ): Promise<{ out: string; code: number }> {
    await hooks.hookPaths()
    return new Promise((resolve) => {
      const child = spawn('/bin/sh', [join(dir, 'agent-hooks', 'codex-state.sh'), event], { env: vars })
      let out = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => (out += chunk))
      child.on('close', (code) => resolve({ out, code: code ?? -1 }))
      child.stdin.on('error', () => undefined)
      child.stdin.end(stdin)
    })
  }

  it('follows the tab through a turn, and prints nothing — no decision for an approval', async () => {
    const seen: (string | null)[] = []
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'Stop']) {
      expect(await fire(event)).toEqual({ out: '', code: 0 })
      seen.push((await hooks.takeHookReport(TERM)).activity)
    }
    expect(seen).toEqual(['idle', 'busy', 'waiting', 'busy', 'idle'])
  })

  it('takes a large payload without choking on it', async () => {
    expect(await fire('PostToolUse', env(), 'x'.repeat(2_000_000))).toEqual({ out: '', code: 0 })
    expect((await hooks.takeHookReport(TERM)).activity).toBe('busy')
  })

  it('leaves the state, and nothing else; the session ending clears what it means', async () => {
    await fire('UserPromptSubmit')
    await fire('SessionEnd')
    expect(await fs.readdir(hooks.reportsDir())).toEqual([`${TERM}.codex`])
    expect((await hooks.takeHookReport(TERM)).activity).toBeNull()
  })

  it('does nothing in a codex the app did not start', async () => {
    expect(await fire('Stop', env({ CLAUDE_STUDIO_SESSION: '' }))).toEqual({ out: '', code: 0 })
    expect(await fs.readdir(hooks.reportsDir())).toEqual([])
  })

  it('goes with the tab', async () => {
    await fire('UserPromptSubmit')
    hooks.clearReports(TERM)
    await vi.waitFor(async () => expect((await hooks.takeHookReport(TERM)).activity).toBeNull())
  })
})
