import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SessionState } from '../src/main/agentSessions'
import { agentActivity, parseSessionState, pickSessionState } from '../src/main/agentSessions'

/**
 * The file a running claude keeps about itself, `<profile>/sessions/<pid>.json`. It is
 * undocumented and written by somebody else's process, so what matters here is what is refused
 * and what is tolerated: a shape we do not recognise has to read as «no answer», never as a
 * status, because the wrong answer puts a wrong dot on a tab and that is the defect this exists
 * to fix.
 *
 * The payload below is the one the shipped 2.1.220 binary actually writes, field for field, with
 * the conversation's own name removed. Fields the app does not read are kept: a parser has to
 * survive them, and it has to go on surviving the ones a later version adds.
 */
const SID = '3f2a6b18-0c4d-4e7a-9b21-5d8e6f0a1c33'
const OTHER = '7c91d0e4-2b53-4af6-8d10-6e2b4c9f7a05'

function state(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pid: 1124844,
    sessionId: SID,
    cwd: '/home/u/work',
    startedAt: 1785166510732,
    procStart: '14990233',
    version: '2.1.220',
    peerProtocol: 1,
    kind: 'interactive',
    entrypoint: 'cli',
    name: 'work',
    nameSource: 'derived',
    status: 'busy',
    updatedAt: 1785168319276,
    statusUpdatedAt: 1785168319276,
    ...over,
  })
}

/** a pid nothing is running under: what a session that died without cleaning up leaves behind */
function deadPid(): number {
  for (let pid = 4_000_000; pid > 3_000_000; pid--) {
    try {
      process.kill(pid, 0)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return pid
    }
  }
  throw new Error('no free pid to test with')
}

describe('parseSessionState', () => {
  it('reads the file the CLI writes', () => {
    expect(parseSessionState(state())).toEqual({
      sessionId: SID,
      pid: 1124844,
      status: 'busy',
      startedAt: 1785166510732,
    })
  })

  it('takes every status word the CLI has', () => {
    for (const status of ['busy', 'idle', 'shell', 'waiting']) {
      expect(parseSessionState(state({ status }))?.status).toBe(status)
    }
  })

  it('has no opinion about a status word it has never seen', () => {
    // a later CLI may invent one; the file still identifies a live session, and «no opinion»
    // reads exactly like no file at all — which is the behaviour the tab had before any of this
    expect(parseSessionState(state({ status: 'thinking' }))).toEqual({
      sessionId: SID,
      pid: 1124844,
      status: null,
      startedAt: 1785166510732,
    })
    expect(parseSessionState(state({ status: 7 }))?.status).toBeNull()
    expect(parseSessionState(state({ status: undefined }))?.status).toBeNull()
  })

  it('refuses anything that names no conversation or no process', () => {
    expect(parseSessionState(state({ sessionId: undefined }))).toBeNull()
    expect(parseSessionState(state({ sessionId: 'not-a-uuid' }))).toBeNull()
    expect(parseSessionState(state({ pid: undefined }))).toBeNull()
    expect(parseSessionState(state({ pid: 'first' }))).toBeNull()
    expect(parseSessionState(state({ pid: 0 }))).toBeNull()
    expect(parseSessionState(state({ pid: 12.5 }))).toBeNull()
  })

  it('refuses what is not an object at all', () => {
    // half a file is what a reader sees while the CLI is rewriting it
    expect(parseSessionState('')).toBeNull()
    expect(parseSessionState('{"pid":1124844,"sessi')).toBeNull()
    expect(parseSessionState('null')).toBeNull()
    expect(parseSessionState('[1,2]')).toBeNull()
    expect(parseSessionState('"busy"')).toBeNull()
  })

  it('survives a file with no startedAt', () => {
    expect(parseSessionState(state({ startedAt: undefined }))?.startedAt).toBe(0)
    expect(parseSessionState(state({ startedAt: 'today' }))?.startedAt).toBe(0)
  })
})

describe('pickSessionState', () => {
  const alive = (): boolean => true
  const entry = (over: Partial<SessionState> = {}): SessionState => ({
    sessionId: SID,
    pid: 100,
    status: 'busy',
    startedAt: 1_000,
    ...over,
  })

  it('answers for our conversation and ignores everybody else', () => {
    const states = [entry({ sessionId: OTHER, status: 'idle' }), entry({ status: 'waiting' })]
    expect(pickSessionState(states, SID, alive)?.status).toBe('waiting')
    expect(pickSessionState(states, OTHER, alive)?.status).toBe('idle')
    expect(pickSessionState(states, '11111111-2222-3333-4444-555555555555', alive)).toBeNull()
    expect(pickSessionState([], SID, alive)).toBeNull()
  })

  it('takes the newest process when one conversation has two files', () => {
    // the same conversation resumed in a new process, the old file still on disk
    const states = [
      entry({ pid: 100, startedAt: 1_000, status: 'busy' }),
      entry({ pid: 200, startedAt: 2_000, status: 'idle' }),
    ]
    expect(pickSessionState(states, SID, alive)?.pid).toBe(200)
    expect(pickSessionState([...states].reverse(), SID, alive)?.pid).toBe(200)
  })

  it('drops a file whose process is gone', () => {
    // only an orderly exit removes the file: a crashed CLI leaves its last status frozen, and a
    // frozen `busy` would pin the tab to «running» for the rest of the day
    const states = [entry({ pid: 100, startedAt: 2_000, status: 'busy' }), entry({ pid: 200, startedAt: 1_000 })]
    const live = (pid: number): boolean => pid === 200
    expect(pickSessionState(states, SID, live)?.pid).toBe(200)
    expect(pickSessionState(states, SID, () => false)).toBeNull()
  })
})

/**
 * The reader itself, against a real directory. `HOME` is moved for the duration: the lookup walks
 * every `~/.claude*` profile, and a test that reads the profiles of whoever is running it is a
 * test whose answer depends on what they happen to have open.
 */
describe('agentActivity', () => {
  let root: string
  let profile: string
  const realHome = process.env.HOME

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cs-sessions-'))
    profile = join(root, '.claude')
    await fs.mkdir(join(profile, 'sessions'), { recursive: true })
    process.env.HOME = root
  })

  afterEach(async () => {
    process.env.HOME = realHome
    await rm(root, { recursive: true, force: true })
  })

  const write = async (name: string, body: string): Promise<void> =>
    fs.writeFile(join(profile, 'sessions', name), body, 'utf8')

  it('finds the running session by its conversation id', async () => {
    await write(`${process.pid}.json`, state({ pid: process.pid, status: 'shell' }))
    expect(await agentActivity(SID, profile)).toBe('shell')
  })

  it('answers null for a conversation no file names', async () => {
    await write(`${process.pid}.json`, state({ pid: process.pid, sessionId: OTHER }))
    expect(await agentActivity(SID, profile)).toBeNull()
  })

  it('answers null when there is no file, and never throws for a missing profile', async () => {
    expect(await agentActivity(SID, profile)).toBeNull()
    expect(await agentActivity(SID, join(root, 'nowhere'))).toBeNull()
    expect(await agentActivity('', profile)).toBeNull()
    expect(await agentActivity('not-a-uuid', profile)).toBeNull()
  })

  it('reads only <pid>.json and ignores whatever else is in the directory', async () => {
    await write('notes.json', state({ pid: process.pid }))
    await write(`${process.pid}.json.tmp`, state({ pid: process.pid }))
    expect(await agentActivity(SID, profile)).toBeNull()
  })

  it('ignores the leftovers of a session that died', async () => {
    const gone = deadPid()
    await write(`${gone}.json`, state({ pid: gone, status: 'busy' }))
    expect(await agentActivity(SID, profile)).toBeNull()
  })
})
