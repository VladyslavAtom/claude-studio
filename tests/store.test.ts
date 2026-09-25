import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { AppState } from '../src/shared/types'
import { STATE_VERSION } from '../src/shared/types'

/**
 * store.ts is the only module here that needs Electron. `app.getPath` becomes a per-test
 * temp directory and `safeStorage` becomes a switchable fake, so encryption is exercised as
 * a round trip without a keyring — the real crypto belongs to Electron, not to this code.
 */
const hoisted = vi.hoisted(() => ({ userData: '', encryption: false }))

vi.mock('electron', () => ({
  app: { getPath: () => hoisted.userData },
  safeStorage: {
    isEncryptionAvailable: () => hoisted.encryption,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
    getSelectedStorageBackend: () => 'basic_text',
  },
}))

type Store = typeof import('../src/main/store')

let dir = ''
let statePath = ''

/** every test gets its own directory and its own module instance: the store keeps state in
 *  module scope (writeBlock, the last load outcome), and that must not leak between cases */
async function freshStore(): Promise<Store> {
  vi.resetModules()
  return import('../src/main/store')
}

function stateFile(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, projects: [], activeProjectId: null, ...over })
}

function appState(over: Partial<AppState> = {}): AppState {
  return {
    version: STATE_VERSION,
    projects: [],
    closedProjects: [],
    activeProjectId: null,
    settings: {
      agents: [
        {
          id: 'claude',
          name: 'Claude',
          preset: 'claude',
          command: 'claude',
          args: [],
          resumeArgs: [],
          historyArgs: [],
          sessionSource: 'uuid',
          extraArgs: [],
          env: {},
          color: '#79b8ff',
          enabled: true,
        },
      ],
      commitMessage: { agentId: 'claude', prompt: 'x', timeoutMs: 1000, warmOnStart: false, args: [] },
      sleep: { enabled: false, minutes: 30 },
      startup: 'ask',
      pullStrategy: 'ask',
      notifications: { enabled: false, sound: false, onlyWhenUnfocused: true },
      layout: { sessions: 232, files: 260, changes: 340, filesOpen: false, changesCollapsed: false },
      editor: { autoSave: false, delayMs: 800 },
      terminal: { scrollbackLines: null },
    },
    ...over,
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cs-store-'))
  hoisted.userData = dir
  hoisted.encryption = false
  statePath = join(dir, 'state.json')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

const ls = () => fs.readdir(dir)

describe('loadState — the happy paths', () => {
  it('returns the empty state on a first run with no file', async () => {
    const store = await freshStore()
    const state = await store.loadState()
    expect(state.projects).toEqual([])
    expect(store.lastLoadOutcome()).toEqual({ recovered: 'none' })
  })

  it('does not quarantine anything when the file is simply absent', async () => {
    const store = await freshStore()
    await store.loadState()
    expect(await ls()).toEqual([])
  })

  it('reads a good file and reports no recovery', async () => {
    await fs.writeFile(statePath, stateFile({ projects: [{ id: 'p1', name: 'demo', sessions: [] }] }))
    const store = await freshStore()
    const state = await store.loadState()
    expect(state.projects.map((p) => p.id)).toEqual(['p1'])
    expect(store.lastLoadOutcome().recovered).toBe('none')
  })
})

describe('loadState — falling back to a backup', () => {
  it('falls back to .bak when the primary is unparsable', async () => {
    await fs.writeFile(statePath, '{ this is not json')
    await fs.writeFile(`${statePath}.bak`, stateFile({ projects: [{ id: 'from-bak', name: 'b', sessions: [] }] }))
    const store = await freshStore()
    const state = await store.loadState()
    expect(state.projects.map((p) => p.id)).toEqual(['from-bak'])
    expect(store.lastLoadOutcome().recovered).toBe('backup')
  })

  it('falls back to .bak2 when both the primary and .bak are unusable', async () => {
    await fs.writeFile(statePath, 'garbage')
    await fs.writeFile(`${statePath}.bak`, 'garbage too')
    await fs.writeFile(`${statePath}.bak2`, stateFile({ projects: [{ id: 'from-bak2', name: 'b', sessions: [] }] }))
    const store = await freshStore()
    const state = await store.loadState()
    expect(state.projects.map((p) => p.id)).toEqual(['from-bak2'])
    expect(store.lastLoadOutcome().recovered).toBe('backup')
  })

  it('prefers .bak over .bak2 when both are readable', async () => {
    await fs.writeFile(statePath, 'garbage')
    await fs.writeFile(`${statePath}.bak`, stateFile({ projects: [{ id: 'newer', name: 'b', sessions: [] }] }))
    await fs.writeFile(`${statePath}.bak2`, stateFile({ projects: [{ id: 'older', name: 'b', sessions: [] }] }))
    const store = await freshStore()
    expect((await store.loadState()).projects.map((p) => p.id)).toEqual(['newer'])
  })

  it('rejects a file that parses but has the wrong shape', async () => {
    await fs.writeFile(statePath, JSON.stringify({ version: 1, projects: 'not an array' }))
    await fs.writeFile(`${statePath}.bak`, stateFile({ projects: [{ id: 'ok', name: 'b', sessions: [] }] }))
    const store = await freshStore()
    expect((await store.loadState()).projects.map((p) => p.id)).toEqual(['ok'])
    expect(store.lastLoadOutcome().reason).toMatch(/projects is not an array/)
  })

  it('rejects a file whose version is missing or not a number', async () => {
    await fs.writeFile(statePath, JSON.stringify({ projects: [] }))
    const store = await freshStore()
    await store.loadState()
    expect(store.lastLoadOutcome().reason).toMatch(/version is missing or not a number/)
  })
})

describe('loadState — quarantine', () => {
  it('keeps an unusable primary as state.json.corrupt-<ts> and never deletes it', async () => {
    await fs.writeFile(statePath, 'not json at all')
    await fs.writeFile(`${statePath}.bak`, stateFile())
    const store = await freshStore()
    await store.loadState()

    const kept = (await ls()).filter((f) => /^state\.json\.corrupt-\d+$/.test(f))
    expect(kept).toHaveLength(1)
    expect(await fs.readFile(join(dir, kept[0]!), 'utf8')).toBe('not json at all')
    await expect(fs.stat(statePath)).rejects.toThrow() // moved aside, not copied
  })

  it('quarantines even when there is no usable backup at all', async () => {
    await fs.writeFile(statePath, 'not json')
    const store = await freshStore()
    const state = await store.loadState()
    expect(state.projects).toEqual([])
    expect(store.lastLoadOutcome().recovered).toBe('empty')
    expect((await ls()).some((f) => f.startsWith('state.json.corrupt-'))).toBe(true)
  })

  it('names the kept file in the reason, so the UI can tell the user where it went', async () => {
    await fs.writeFile(statePath, 'nope')
    const store = await freshStore()
    await store.loadState()
    expect(store.lastLoadOutcome().reason).toMatch(/kept as state\.json\.corrupt-\d+/)
  })

  it('keeps the corrupt file safe from the next save', async () => {
    await fs.writeFile(statePath, 'nope')
    const store = await freshStore()
    await store.loadState()
    const kept = (await ls()).find((f) => f.startsWith('state.json.corrupt-'))!
    expect(await store.saveState(appState())).toEqual({ ok: true })
    expect(await fs.readFile(join(dir, kept), 'utf8')).toBe('nope')
  })
})

describe('loadState — a state file from a newer build', () => {
  it('refuses to use it and reports too-new', async () => {
    await fs.writeFile(statePath, stateFile({ version: 99 }))
    const store = await freshStore()
    const state = await store.loadState()
    expect(state.projects).toEqual([])
    expect(store.lastLoadOutcome().recovered).toBe('too-new')
    expect(store.lastLoadOutcome().reason).toMatch(/version 99 is newer/)
  })

  it('blocks saving, so the newer file is not overwritten', async () => {
    await fs.writeFile(statePath, stateFile({ version: 99 }))
    const store = await freshStore()
    await store.loadState()
    const result = await store.saveState(appState())
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/version 99 is newer/)
    expect(await fs.readFile(statePath, 'utf8')).toBe(stateFile({ version: 99 }))
  })

  it('says so through savesBlocked, which is what state:health reports', async () => {
    await fs.writeFile(statePath, stateFile({ version: 99 }))
    const store = await freshStore()
    expect(store.savesBlocked()).toBe(false) // nothing loaded yet: nothing to protect
    await store.loadState()
    expect(store.savesBlocked()).toBe(true)
  })

  it('does not quarantine a too-new file — it is not corrupt', async () => {
    await fs.writeFile(statePath, stateFile({ version: 99 }))
    const store = await freshStore()
    await store.loadState()
    expect((await ls()).some((f) => f.includes('corrupt'))).toBe(false)
  })

  it('blocks saving when the primary is corrupt and the only backup is too new', async () => {
    await fs.writeFile(statePath, 'garbage')
    await fs.writeFile(`${statePath}.bak`, stateFile({ version: 99 }))
    const store = await freshStore()
    await store.loadState()
    expect((await store.saveState(appState())).ok).toBe(false)
  })
})

describe('saveState — atomic write and rotation', () => {
  it('writes the file owner-only and leaves no tmp behind', async () => {
    const store = await freshStore()
    expect(await store.saveState(appState())).toEqual({ ok: true })
    const st = await fs.stat(statePath)
    expect(st.mode & 0o777).toBe(0o600)
    expect((await ls()).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('writes formatted JSON that loads back', async () => {
    const store = await freshStore()
    await store.saveState(appState({ activeProjectId: 'p1' }))
    const raw = await fs.readFile(statePath, 'utf8')
    expect(raw).toContain('\n  ')
    expect(JSON.parse(raw).activeProjectId).toBe('p1')
  })

  it('does not rotate anything on the first save', async () => {
    const store = await freshStore()
    await store.saveState(appState())
    expect(await ls()).toEqual(['state.json'])
  })

  it('keeps two generations of backups', async () => {
    const store = await freshStore()
    await store.saveState(appState({ activeProjectId: 'first' }))
    await store.saveState(appState({ activeProjectId: 'second' }))
    await store.saveState(appState({ activeProjectId: 'third' }))

    expect(JSON.parse(await fs.readFile(statePath, 'utf8')).activeProjectId).toBe('third')
    expect(JSON.parse(await fs.readFile(`${statePath}.bak`, 'utf8')).activeProjectId).toBe('second')
    expect(JSON.parse(await fs.readFile(`${statePath}.bak2`, 'utf8')).activeProjectId).toBe('first')
  })

  it('writes the backup owner-only too', async () => {
    const store = await freshStore()
    await store.saveState(appState())
    await store.saveState(appState())
    expect((await fs.stat(`${statePath}.bak`)).mode & 0o777).toBe(0o600)
  })

  it('serialises concurrent saves instead of racing them', async () => {
    const store = await freshStore()
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => store.saveState(appState({ activeProjectId: `p${n}` }))),
    )
    expect(results.every((r) => r.ok)).toBe(true)
    expect(JSON.parse(await fs.readFile(statePath, 'utf8')).activeProjectId).toBe('p5')
    expect((await ls()).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('saveState — rejecting bad payloads', () => {
  it('refuses a payload that is not an object', async () => {
    const store = await freshStore()
    expect((await store.saveState(null as unknown as AppState)).ok).toBe(false)
    await expect(fs.stat(statePath)).rejects.toThrow()
  })

  it('refuses a payload whose projects is not an array', async () => {
    const store = await freshStore()
    const bad = { ...appState(), projects: 'nope' } as unknown as AppState
    expect((await store.saveState(bad)).ok).toBe(false)
  })

  it('refuses a payload with no settings', async () => {
    const store = await freshStore()
    const bad = { version: 1, projects: [], activeProjectId: null } as unknown as AppState
    const r = await store.saveState(bad)
    expect(r.ok === false && r.error).toMatch(/settings is missing/)
  })

  it('refuses a payload whose version is newer than this build', async () => {
    const store = await freshStore()
    const r = await store.saveState(appState({ version: 42 as AppState['version'] }))
    expect(r.ok === false && r.error).toMatch(/newer than/)
  })

  it('refuses a payload whose agents list holds a non-object', async () => {
    const store = await freshStore()
    const bad = appState()
    ;(bad.settings.agents as unknown[])[0] = 'claude'
    const r = await store.saveState(bad)
    expect(r.ok === false && r.error).toMatch(/non-object entry/)
  })

  it('leaves an existing good file untouched when the payload is rejected', async () => {
    const store = await freshStore()
    await store.saveState(appState({ activeProjectId: 'good' }))
    await store.saveState(null as unknown as AppState)
    expect(JSON.parse(await fs.readFile(statePath, 'utf8')).activeProjectId).toBe('good')
    expect(await ls()).toEqual(['state.json'])
  })
})

describe('env value encryption', () => {
  it('stores env values in the clear when no keyring is available', async () => {
    const store = await freshStore()
    const state = appState()
    state.settings.agents[0]!.env = { TOKEN: 'secret' }
    await store.saveState(state)
    expect(await fs.readFile(statePath, 'utf8')).toContain('"TOKEN": "secret"')
  })

  it('round-trips through safeStorage when a keyring is available', async () => {
    hoisted.encryption = true
    const store = await freshStore()
    const state = appState()
    state.settings.agents[0]!.env = { TOKEN: 'secret' }
    await store.saveState(state)

    const raw = await fs.readFile(statePath, 'utf8')
    expect(raw).not.toContain('secret')
    expect(raw).toContain('safeStorage:v1:')

    const loaded = await store.loadState()
    expect(loaded.settings.agents[0]?.env).toEqual({ TOKEN: 'secret' })
  })

  it('reads pre-encryption plain values unchanged', async () => {
    hoisted.encryption = true
    const store = await freshStore()
    const state = appState()
    state.settings.agents[0]!.env = { TOKEN: 'secret' }
    await fs.writeFile(statePath, JSON.stringify({ ...state, version: 1 }))
    const loaded = await store.loadState()
    expect(loaded.settings.agents[0]?.env).toEqual({ TOKEN: 'secret' })
  })

  it('reports the encryption backend', async () => {
    const store = await freshStore()
    expect(store.encryptionStatus()).toBe('none')
  })
})

describe('migrate', () => {
  it('fills in defaults for a state written by an older build', async () => {
    await fs.writeFile(statePath, stateFile({ settings: {} }))
    const store = await freshStore()
    const state = await store.loadState()
    expect(state.settings.agents.length).toBeGreaterThan(0)
    expect(state.settings.layout.sessions).toBeGreaterThan(0)
    expect(state.settings.startup).toBe('ask')
  })

  // settings are rebuilt field by field here, so an optional one that nobody named is dropped
  // on every load — the user's choice then never survives a restart
  it('keeps the chosen locale', async () => {
    await fs.writeFile(statePath, stateFile({ settings: { locale: 'uk' } }))
    const store = await freshStore()
    expect((await store.loadState()).settings.locale).toBe('uk')
  })

  it('leaves the locale absent when none was ever chosen — that is not the same as English', async () => {
    await fs.writeFile(statePath, stateFile({ settings: {} }))
    const store = await freshStore()
    expect((await store.loadState()).settings.locale).toBeUndefined()
  })

  it('drops a locale we have no catalogue for', async () => {
    await fs.writeFile(statePath, stateFile({ settings: { locale: 'kl' } }))
    const store = await freshStore()
    expect((await store.loadState()).settings.locale).toBeUndefined()
  })

  // the same trap as the locale: the terminal settings are rebuilt by name, and a scrollback
  // limit nobody named here would be «unlimited» again after every restart
  it('keeps the chosen scrollback limit', async () => {
    await fs.writeFile(statePath, stateFile({ settings: { terminal: { scrollbackLines: 20000 } } }))
    const store = await freshStore()
    expect((await store.loadState()).settings.terminal.scrollbackLines).toBe(20000)
  })

  it('gives a state written before the setting existed the unlimited default', async () => {
    await fs.writeFile(statePath, stateFile({ settings: {} }))
    const store = await freshStore()
    expect((await store.loadState()).settings.terminal.scrollbackLines).toBeNull()
  })

  it('reads the saved «no limit» back as no limit, not as a missing setting', async () => {
    await fs.writeFile(statePath, stateFile({ settings: { terminal: { scrollbackLines: null } } }))
    const store = await freshStore()
    const state = await store.loadState()
    expect(state.settings.terminal).toEqual({ scrollbackLines: null })
  })

  // a hand-edited file, or one written by a build that spelled the value differently: none of
  // these may reach xterm or the replay buffer as a limit
  it('takes a scrollback limit that is not a positive number as no limit', async () => {
    for (const bad of [0, -5, 'lots', Number.NaN]) {
      await fs.writeFile(statePath, stateFile({ settings: { terminal: { scrollbackLines: bad } } }))
      const store = await freshStore()
      expect((await store.loadState()).settings.terminal.scrollbackLines).toBeNull()
    }
  })

  it('rounds a fractional limit down to whole lines', async () => {
    await fs.writeFile(statePath, stateFile({ settings: { terminal: { scrollbackLines: 1000.7 } } }))
    const store = await freshStore()
    expect((await store.loadState()).settings.terminal.scrollbackLines).toBe(1000)
  })

  it('survives a save and a load, which is where migrate() drops what it does not name', async () => {
    const store = await freshStore()
    const state = appState()
    state.settings.terminal = { scrollbackLines: 12345 }
    await store.saveState(state)
    expect((await store.loadState()).settings.terminal.scrollbackLines).toBe(12345)
  })

  it('keeps the agent the «+» button last created', async () => {
    await fs.writeFile(statePath, stateFile({ settings: { lastAgentId: 'codex' } }))
    const store = await freshStore()
    expect((await store.loadState()).settings.lastAgentId).toBe('codex')
  })

  it('stamps the loaded state with the current version', async () => {
    await fs.writeFile(statePath, stateFile())
    const store = await freshStore()
    expect((await store.loadState()).version).toBe(STATE_VERSION)
  })

  it('gives a v1 state the closed-projects list it never had', async () => {
    await fs.writeFile(statePath, stateFile({ version: 1, projects: [{ id: 'p1', name: 'demo', sessions: [] }] }))
    const store = await freshStore()
    const state = await store.loadState()
    expect(state.version).toBe(STATE_VERSION)
    expect(state.closedProjects).toEqual([])
    expect(state.projects).toHaveLength(1)
  })

  it('replaces the dark-only default agent colours, and only those', async () => {
    await fs.writeFile(
      statePath,
      stateFile({
        version: 2,
        closedProjects: [],
        settings: {
          agents: [
            { id: 'a', name: 'A', command: 'claude', color: '#79b8ff', env: {} },
            { id: 'b', name: 'B', command: 'codex', color: '#7ee787', env: {} },
            // picked by hand: not ours to overrule, whatever it measures on white
            { id: 'c', name: 'C', command: 'x', color: '#ff00aa', env: {} },
          ],
        },
      }),
    )
    const store = await freshStore()
    const agents = (await store.loadState()).settings.agents
    expect(agents.map((a) => a.color)).toEqual(['#2f80d0', '#1f9142', '#ff00aa'])
  })

  it('rewrites a legacy "claude" terminal kind as an agent tab', async () => {
    const legacy = stateFile({
      projects: [
        {
          id: 'p1',
          name: 'demo',
          sessions: [{ id: 's1', name: 'x', terminals: [{ id: 't1', kind: 'claude', title: 'Claude' }] }],
        },
      ],
    })
    await fs.writeFile(statePath, legacy)
    const store = await freshStore()
    const tab = (await store.loadState()).projects[0]?.sessions[0]?.terminals[0]
    expect(tab).toMatchObject({ kind: 'agent', agentId: 'claude' })
  })

  it('drops a colour the broken generator wrote', async () => {
    const legacy = stateFile({
      settings: { agents: [{ id: 'claude', name: 'Claude', command: 'claude', color: '#-2758-1edf289d' }] },
    })
    await fs.writeFile(statePath, legacy)
    const store = await freshStore()
    const color = (await store.loadState()).settings.agents[0]?.color
    expect(color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('strips the legacy `-n {name}` argument pair', async () => {
    const legacy = stateFile({
      settings: { agents: [{ id: 'claude', name: 'Claude', command: 'claude', args: ['-n', '{name}', '--verbose'] }] },
    })
    await fs.writeFile(statePath, legacy)
    const store = await freshStore()
    expect((await store.loadState()).settings.agents[0]?.args).toEqual(['--verbose'])
  })

  it('gives every session an empty runs list rather than undefined', async () => {
    const legacy = stateFile({
      projects: [{ id: 'p1', name: 'demo', sessions: [{ id: 's1', name: 'x' }] }],
    })
    await fs.writeFile(statePath, legacy)
    const store = await freshStore()
    const session = (await store.loadState()).projects[0]?.sessions[0]
    expect(session?.runs).toEqual([])
    expect(session?.terminals).toEqual([])
  })
})

describe('stale tmp sweep', () => {
  it('removes a tmp file left by a crash more than an hour ago', async () => {
    const stale = join(dir, '.state.json.123-456-abc.tmp')
    await fs.writeFile(stale, 'half written')
    const old = Date.now() - 2 * 60 * 60 * 1000
    await fs.utimes(stale, old / 1000, old / 1000)

    const store = await freshStore()
    await store.loadState()
    await new Promise((r) => setTimeout(r, 50)) // the sweep is fire-and-forget
    await expect(fs.stat(stale)).rejects.toThrow()
  })

  it('leaves a fresh tmp alone — another instance may be writing it right now', async () => {
    const fresh = join(dir, '.state.json.123-456-abc.tmp')
    await fs.writeFile(fresh, 'in progress')
    const store = await freshStore()
    await store.loadState()
    await new Promise((r) => setTimeout(r, 50))
    expect(await fs.stat(fresh)).toBeTruthy()
  })

  it('leaves unrelated files alone', async () => {
    const other = join(dir, 'something-else.tmp')
    await fs.writeFile(other, 'x')
    const old = Date.now() - 2 * 60 * 60 * 1000
    await fs.utimes(other, old / 1000, old / 1000)
    const store = await freshStore()
    await store.loadState()
    await new Promise((r) => setTimeout(r, 50))
    expect(await fs.stat(other)).toBeTruthy()
  })
})
