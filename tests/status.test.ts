import { describe, expect, it } from 'vitest'
import { PULSE_LOOK, PULSE_ORDER, projectPulse, terminalStatus } from '../src/renderer/src/lib/status'
import type { StatusInput } from '../src/renderer/src/lib/status'

/**
 * The dot on a tab. Two of the cases below are the whole reason the CLI's own state is read at
 * all: an agent that thinks without printing used to look idle, and an agent drawing a spinner
 * used to look busy for as long as it drew one. Both are decided here by what the process says
 * about itself, and neither can be told apart by output.
 */
const tab = (over: Partial<StatusInput> = {}): StatusInput => ({
  awake: true,
  attention: false,
  busy: false,
  ...over,
})

describe('terminalStatus', () => {
  it('says what the CLI says it is doing', () => {
    expect(terminalStatus(tab({ activity: 'busy' }))).toBe('running')
    expect(terminalStatus(tab({ activity: 'idle' }))).toBe('idle')
    expect(terminalStatus(tab({ activity: 'waiting' }))).toBe('waiting')
    // the CLI runs a command of its own; its own session list counts this as working
    expect(terminalStatus(tab({ activity: 'shell' }))).toBe('running')
  })

  it('believes the process over its output', () => {
    // thinking without printing: nothing has been written for a minute, and it is working
    expect(terminalStatus(tab({ activity: 'busy', busy: false }))).toBe('running')
    // a spinner: bytes every frame, and the turn ended long ago
    expect(terminalStatus(tab({ activity: 'idle', busy: true }))).toBe('idle')
  })

  it('falls back on the output of a tab nothing answers for', () => {
    // a shell tab, and a claude session that writes no state file: exactly the old behaviour
    expect(terminalStatus(tab({ busy: true }))).toBe('running')
    expect(terminalStatus(tab({ busy: false }))).toBe('idle')
    expect(terminalStatus(tab({ activity: null, busy: true }))).toBe('running')
    expect(terminalStatus(tab({ activity: null, busy: false }))).toBe('idle')
  })

  it('lets a tab that called for the person outrank everything it is doing', () => {
    // `attention` is not about the process: it means this tab rang and nobody has looked yet
    expect(terminalStatus(tab({ attention: true, activity: 'busy', busy: true }))).toBe('waiting')
    expect(terminalStatus(tab({ attention: true, activity: 'idle' }))).toBe('waiting')
  })

  it('lets a tab with no process outrank what it last said', () => {
    expect(terminalStatus(tab({ awake: false, activity: 'busy', busy: true }))).toBe('asleep')
    expect(terminalStatus(tab({ awake: false, attention: true }))).toBe('asleep')
    expect(terminalStatus(tab({ dead: true, awake: false, attention: true, activity: 'busy' }))).toBe('dead')
  })
})

/**
 * What a project tab adds up to. The point of the whole thing is the first test: a project that
 * holds something calling *and* something working says both, because those are two different
 * things to go and do — the old tab could only ever be one colour, and it was always the same one.
 */
describe('projectPulse', () => {
  it('shows everything active at once, waiting before running', () => {
    expect(projectPulse(['running', 'waiting'])).toEqual([
      { status: 'waiting', count: 1 },
      { status: 'running', count: 1 },
    ])
    expect(projectPulse(['waiting', 'waiting', 'running'])).toEqual([
      { status: 'waiting', count: 2 },
      { status: 'running', count: 1 },
    ])
  })

  it('lets the quiet tabs be quiet: forty idle and one calling is one dot, not a wall', () => {
    const statuses = [...Array.from({ length: 40 }, () => 'idle' as const), 'waiting' as const]
    expect(projectPulse(statuses)).toEqual([{ status: 'waiting', count: 1 }])
  })

  it('speaks of the resting state only when nothing at all is happening', () => {
    expect(projectPulse(['idle', 'idle', 'asleep'])).toEqual([{ status: 'idle', count: 2 }])
    // a live silent process outranks no process: idle speaks for the rest
    expect(projectPulse(['asleep', 'idle'])).toEqual([{ status: 'idle', count: 1 }])
    expect(projectPulse(['asleep', 'asleep'])).toEqual([{ status: 'asleep', count: 2 }])
  })

  it('says nothing about a project that holds no tabs', () => {
    expect(projectPulse([])).toEqual([])
  })

  it('counts a tab whose process has exited among the tabs that have no process', () => {
    // no tab list carries `dead` today; the type does, and «its process is gone» is what the
    // hollow ring already means
    expect(projectPulse(['dead', 'asleep'])).toEqual([{ status: 'asleep', count: 2 }])
    expect(projectPulse(['dead', 'running'])).toEqual([{ status: 'running', count: 1 }])
  })

  it('has a word and a colour for every status it can return', () => {
    for (const status of PULSE_ORDER) {
      expect(PULSE_LOOK[status].cls, status).toBeTruthy()
      expect(PULSE_LOOK[status].key, status).toMatch(/^sessions\.pulse\./)
    }
  })
})
