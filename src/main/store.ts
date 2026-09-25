import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import {
  AGENT_PRESETS,
  defaultAgents,
  defaultCommitMessage,
  defaultEditor,
  defaultLayout,
  defaultNotifications,
  defaultSleep,
  emptyState,
  LOCALES,
  THEME_CHOICES,
  STATE_VERSION,
  type AppState,
  type SaveResult,
  type StateLoadOutcome,
  type TerminalConfig,
  type TerminalTab,
} from '../shared/types'
import { serialize } from './serialize'

function statePath(): string {
  return join(app.getPath('userData'), 'state.json')
}

/** state.json holds agent env values, so it is written owner-only */
const FILE_MODE = 0o600

/**
 * On-disk shape. A file written by a newer build can carry any version number, and we have to
 * be able to recognise that before trusting anything else in it.
 */
type StoredState = Omit<AppState, 'version'> & { version: number }

/**
 * Ordered migration steps: entry i upgrades a state at version BASE_VERSION + i to
 * BASE_VERSION + i + 1. Adding a step here is what bumps CURRENT_VERSION, which must stay
 * equal to STATE_VERSION in shared/types (asserted below). A file whose version is above
 * CURRENT_VERSION was written by a newer build: it is never parsed and never overwritten.
 */
const BASE_VERSION = 1
/**
 * The agent colours that were the defaults before a light theme existed. They were chosen against
 * a near-black window and sit at roughly 2:1 on white, so the migration below replaces them —
 * but only where the value is still exactly one of these. A colour the user picked themselves is
 * their decision, whatever it measures.
 */
const LEGACY_AGENT_COLORS: Record<string, string> = {
  '#79b8ff': '#2f80d0',
  '#7ee787': '#1f9142',
  '#d2a8ff': '#9b5de5',
}

const MIGRATIONS: ReadonlyArray<(state: StoredState) => StoredState> = [
  // v1 -> v2: closed projects are remembered so reopening a folder restores its sessions
  (state) => ({ ...state, closedProjects: [] }),
  // v2 -> v3: default agent colours that only worked on a dark window
  (state) => ({
    ...state,
    settings: {
      ...state.settings,
      agents: (state.settings?.agents ?? []).map((a) => ({ ...a, color: LEGACY_AGENT_COLORS[a.color] ?? a.color })),
    },
  }),
]
const CURRENT_VERSION = BASE_VERSION + MIGRATIONS.length

if (CURRENT_VERSION !== STATE_VERSION) {
  throw new Error(`state version mismatch: migrations say ${CURRENT_VERSION}, shared/types says ${STATE_VERSION}`)
}

function applyMigrations(state: StoredState): StoredState {
  let out = state
  for (let v = out.version; v < CURRENT_VERSION; v++) {
    const step = MIGRATIONS[v - BASE_VERSION]
    if (!step) break
    out = { ...step(out), version: v + 1 }
  }
  return out
}

// ---------------------------------------------------------------------------
// Tokens end up in the agents' env (keys for CLAUDE_CONFIG_DIR wrappers, for one), while the
// whole AppState is written to state.json and its .bak without any filtering at all. The values
// are encrypted through Electron's safeStorage before they go to disk and decrypted on load;
// old plain values (the ones with no prefix) are read as they are.
// ---------------------------------------------------------------------------

const ENC_PREFIX = 'safeStorage:v1:'

function encryptEnvValue(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) return value
  try {
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
  } catch {
    return value // could not encrypt — better stored in the clear than lost
  }
}

function decryptEnvValue(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value // the old format — plain text already
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return value // no access to the keyring (the machine changed, say) — hand it back as is
  }
}

/**
 * What the env values on disk are actually protected by:
 *   'os'   — a real keyring (Keychain, DPAPI, libsecret, kwallet)
 *   'weak' — Linux `basic_text` fallback: a hardcoded key, i.e. obfuscation, not encryption
 *   'none' — no encryption at all, values are stored in plain text
 * Behaviour does not depend on this; it exists so Settings can warn about 'weak' and 'none'.
 */
export function encryptionStatus(): 'os' | 'weak' | 'none' {
  if (!safeStorage.isEncryptionAvailable()) return 'none'
  if (process.platform !== 'linux') return 'os'
  try {
    return safeStorage.getSelectedStorageBackend() === 'basic_text' ? 'weak' : 'os'
  } catch {
    return 'os' // backend unknown (older Electron); isEncryptionAvailable() already said yes
  }
}

function mapEnv(
  env: Record<string, string> | undefined,
  fn: (value: string) => string,
): Record<string, string> | undefined {
  if (!env) return env
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) out[k] = fn(v)
  return out
}

/** env values just before they go to disk — in memory the app always works with plain text */
function encryptSecrets(state: AppState): AppState {
  // an absent env stays absent: writing the key as `undefined` would put a null into the JSON
  const commitEnv = mapEnv(state.settings.commitMessage.env, encryptEnvValue)
  return {
    ...state,
    settings: {
      ...state.settings,
      agents: state.settings.agents.map((a) => ({ ...a, env: mapEnv(a.env, encryptEnvValue) ?? {} })),
      commitMessage: { ...state.settings.commitMessage, ...(commitEnv ? { env: commitEnv } : {}) },
    },
  }
}

/**
 * Reports how the last loadState() went. 'none' is the normal case (including a first
 * run with no file yet); anything else means the state on disk could not be used as is
 * and the UI should say so instead of letting the user think their projects are gone.
 * The shape is shared with the renderer, which reads it over `state:health`.
 */
export type LoadOutcome = StateLoadOutcome

let loadOutcome: LoadOutcome = { recovered: 'none' }

/** non-null while the state on disk must not be overwritten; the string is the reason */
let writeBlock: string | null = null

export function lastLoadOutcome(): LoadOutcome {
  return { ...loadOutcome }
}

/**
 * True while every save is refused. It is set by a state file written by a newer build (which
 * we cannot understand and must not destroy) and by a corrupt file that could not even be moved
 * aside. Settings has to say so: otherwise the app looks like it is saving and it is not.
 */
export function savesBlocked(): boolean {
  return writeBlock !== null
}

const BACKUP_SUFFIXES = ['.bak', '.bak2'] as const

type ReadResult = { ok: true; state: StoredState } | { ok: false; reason: string; missing?: boolean; tooNew?: boolean }

/** everything migrate() needs before it can be defensive on its own */
function storedProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'not a JSON object'
  const state = value as Partial<StoredState>
  if (typeof state.version !== 'number' || !Number.isFinite(state.version)) return 'version is missing or not a number'
  if (!Array.isArray(state.projects)) return 'projects is not an array'
  return null
}

async function readStateFile(path: string): Promise<ReadResult> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, missing: true, reason: `${basename(path)}: no such file` }
    return { ok: false, reason: `${basename(path)}: ${String(err)}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: `${basename(path)}: ${String(err)}` }
  }
  const problem = storedProblem(parsed)
  if (problem) return { ok: false, reason: `${basename(path)}: ${problem}` }
  const state = parsed as StoredState
  if (state.version > CURRENT_VERSION) {
    return {
      ok: false,
      tooNew: true,
      reason: `${basename(path)}: version ${state.version} is newer than ${CURRENT_VERSION}`,
    }
  }
  return { ok: true, state: applyMigrations(state) }
}

/**
 * Moves an unusable state file aside instead of leaving it to be overwritten by the next
 * save. It is never deleted: the user's projects may still be recoverable by hand.
 */
async function quarantine(target: string): Promise<string | null> {
  const kept = `${target}.corrupt-${Date.now()}`
  try {
    await fs.rename(target, kept)
    console.error('[store] unusable state kept as', kept)
    return kept
  } catch (err) {
    // could not even move it — writing over it would be the only remaining outcome.
    // English like every other `reason` here: Settings shows these as technical detail next to
    // its own sentence, not as the sentence itself
    writeBlock = `could not move the unusable ${basename(target)} aside: ${String(err)}`
    return null
  }
}

export async function loadState(): Promise<AppState> {
  const target = statePath()
  loadOutcome = { recovered: 'none' }
  writeBlock = null
  void sweepStaleTmp(target)

  const primary = await readStateFile(target)
  if (primary.ok) return migrate(primary.state)

  // written by a newer build: we cannot understand it and must not save over it
  if (primary.tooNew) {
    writeBlock = primary.reason
    loadOutcome = { recovered: 'too-new', reason: primary.reason }
    console.error('[store] state file is too new, refusing to overwrite:', primary.reason)
    return emptyState
  }

  for (const suffix of BACKUP_SUFFIXES) {
    const backup = await readStateFile(target + suffix)
    if (!backup.ok) {
      // a backup from a newer build must not be rotated over either
      if (backup.tooNew && !writeBlock) writeBlock = backup.reason
      continue
    }
    // the bad primary would otherwise be rotated over the good backup on the next save
    const kept = primary.missing ? null : await quarantine(target)
    loadOutcome = {
      recovered: 'backup',
      reason: `${primary.reason}; restored from ${basename(target)}${suffix}${kept ? `, bad file kept as ${basename(kept)}` : ''}`,
    }
    console.error('[store] state restored from', suffix, '-', primary.reason)
    return migrate(backup.state)
  }

  if (primary.missing) return emptyState // first run: nothing on disk, nothing lost

  const kept = await quarantine(target)
  loadOutcome = {
    recovered: 'empty',
    reason: `${primary.reason}; no usable backup${kept ? `, bad file kept as ${basename(kept)}` : ''}`,
  }
  console.error('[store] no usable state or backup:', primary.reason)
  return emptyState
}

/** brings state written by older builds up to the current shape */
function migrate(state: StoredState): AppState {
  const stored = state.settings?.agents?.length ? state.settings.agents : defaultAgents
  const agents = stored.map((a) => {
    const fallback = defaultAgents.find((d) => d.id === a.id)
    const preset =
      a.preset ??
      (a.sessionSource === 'codex' || a.command?.endsWith('codex')
        ? 'codex'
        : a.command?.endsWith('claude')
          ? 'claude'
          : 'custom')
    // `-n {name}` gave the conversation a hand-set name, and Claude then stopped inventing its own
    const args = (a.args ?? fallback?.args ?? []).filter(
      (arg, i, all) => !(arg === '-n' && all[i + 1] === '{name}') && !(arg === '{name}' && all[i - 1] === '-n'),
    )
    // a broken colour generator managed to write junk like «#-2758-1edf289d» into the state
    const color = /^#[0-9a-f]{6}$/i.test(a.color ?? '')
      ? a.color
      : (fallback?.color ?? AGENT_PRESETS.find((p) => p.preset === preset)?.color ?? '#79b8ff')
    return {
      ...a,
      env: mapEnv(a.env, decryptEnvValue) ?? {},
      args,
      preset,
      color,
      extraArgs: a.extraArgs ?? [],
      historyArgs: a.historyArgs ?? fallback?.historyArgs ?? [],
      sessionSource: a.sessionSource ?? fallback?.sessionSource ?? 'none',
      resumeArgs: a.resumeArgs ?? fallback?.resumeArgs ?? [],
    }
  })
  const storedCommit = state.settings?.commitMessage as
    | (Partial<typeof defaultCommitMessage> & {
        command?: string
        args?: string[]
      })
    | undefined
  // the old format stored the command directly; it is matched against an agent from the settings
  const commitEnv = mapEnv(storedCommit?.env, decryptEnvValue)
  const commitMessage =
    storedCommit?.agentId !== undefined
      ? { ...defaultCommitMessage, ...storedCommit, ...(commitEnv ? { env: commitEnv } : {}) }
      : {
          ...defaultCommitMessage,
          agentId: agents.find((a) => a.command === storedCommit?.command)?.id ?? defaultCommitMessage.agentId,
          prompt: storedCommit?.prompt ?? defaultCommitMessage.prompt,
          ...(commitEnv ? { env: commitEnv } : {}),
        }

  const sleep = state.settings?.sleep ?? defaultSleep
  const startup = state.settings?.startup ?? 'ask'
  const pullStrategy = state.settings?.pullStrategy ?? 'ask'
  const notifications = state.settings?.notifications ?? defaultNotifications
  // the layout is filled in field by field: a state written by an older build has no new keys
  const layout = { ...defaultLayout, ...(state.settings?.layout ?? {}) }
  const editor = state.settings?.editor ?? defaultEditor
  /**
   * The scrollback limit, in lines. Anything that is not a positive number — an absent setting, a
   * `null` written by the settings page for «no limit», junk from a hand-edited file — is «keep
   * everything», which is also the default, so all three land in the same place without any of
   * them having to be told apart.
   */
  const storedScrollback = state.settings?.terminal?.scrollbackLines
  const terminal: TerminalConfig = {
    scrollbackLines:
      typeof storedScrollback === 'number' && Number.isFinite(storedScrollback) && storedScrollback > 0
        ? Math.floor(storedScrollback)
        : null,
  }
  // An absent locale is not the same as English: it means nobody has ever picked one, and the
  // app is then free to follow the system language. So the key is left out rather than filled
  // in with a default. A value that is not a language we have is dropped for the same reason —
  // it would otherwise pin the interface to a catalogue that does not exist.
  const storedLocale = state.settings?.locale
  const locale = storedLocale && (LOCALES as readonly string[]).includes(storedLocale) ? storedLocale : undefined
  // same shape, same reason as the locale: 'system' is a standing instruction to follow the OS,
  // not a theme, so an absent value is kept absent instead of being resolved once and frozen
  const storedTheme = state.settings?.theme
  const theme = storedTheme && (THEME_CHOICES as readonly string[]).includes(storedTheme) ? storedTheme : undefined
  // same shape, same reason: this list is written out field by field, so an optional setting that
  // is not named here is silently dropped on every load
  const lastAgentId = state.settings?.lastAgentId
  return {
    ...state,
    version: CURRENT_VERSION,
    closedProjects: state.closedProjects ?? [],
    settings: {
      agents,
      commitMessage,
      sleep,
      startup,
      pullStrategy,
      notifications,
      layout,
      editor,
      terminal,
      ...(locale ? { locale } : {}),
      ...(theme ? { theme } : {}),
      ...(lastAgentId === undefined ? {} : { lastAgentId }),
    },
    projects: (state.projects ?? []).map((p) => ({
      ...p,
      history: p.history ?? [],
      sessions: (p.sessions ?? []).map((s) => ({
        ...s,
        runs: s.runs ?? [],
        terminals: (s.terminals ?? []).map((t) => {
          const legacyKind = t.kind as TerminalTab['kind'] | 'claude'
          if (legacyKind === 'claude') return { ...t, kind: 'agent' as const, agentId: 'claude' }
          // an agent tab written before tabs named their agent: it adopts the first configured
          // one. With no agents configured at all there is nothing to adopt, and the tab is left
          // as it is rather than being given an `agentId` of undefined
          if (legacyKind === 'agent' && !t.agentId) {
            const [firstAgent] = agents
            return firstAgent ? { ...t, agentId: firstAgent.id } : t
          }
          return t
        }),
      })),
    })),
  }
}

/** everything encryptSecrets() and the renderer assume; the IPC payload is unvalidated input */
function saveProblem(value: unknown): string | null {
  const shape = storedProblem(value)
  if (shape) return `state:save: ${shape}`
  const state = value as StoredState
  if (state.version > CURRENT_VERSION) return `state:save: version ${state.version} is newer than ${CURRENT_VERSION}`
  const settings = state.settings as Partial<AppState['settings']> | undefined
  if (!settings || typeof settings !== 'object') return 'state:save: settings is missing'
  if (!Array.isArray(settings.agents)) return 'state:save: settings.agents is not an array'
  if (settings.agents.some((a) => !a || typeof a !== 'object'))
    return 'state:save: settings.agents has a non-object entry'
  if (!settings.commitMessage || typeof settings.commitMessage !== 'object')
    return 'state:save: settings.commitMessage is missing'
  return null
}

/** keeps two generations: the newest good file can survive a save that stored garbage */
async function rotateBackups(target: string): Promise<void> {
  // nothing to rotate on the first save, or after a corrupt file was moved aside
  if (!(await fs.stat(target).catch(() => null))) return
  await fs.rename(target + '.bak', target + '.bak2').catch(() => {})
  try {
    await fs.copyFile(target, target + '.bak')
    await fs.chmod(target + '.bak', FILE_MODE)
  } catch (err) {
    console.error('[store] backup rotation failed:', err)
  }
}

const TMP_MAX_AGE_MS = 60 * 60 * 1000

/**
 * Drops tmp files left behind by a crash between write and rename. The age limit keeps a
 * second instance's write in progress out of it.
 */
async function sweepStaleTmp(target: string): Promise<void> {
  const dir = dirname(target)
  const name = basename(target)
  const cutoff = Date.now() - TMP_MAX_AGE_MS
  try {
    for (const entry of await fs.readdir(dir)) {
      if (!entry.endsWith('.tmp')) continue
      if (!entry.startsWith(`${name}.`) && !entry.startsWith(`.${name}.`)) continue
      const full = join(dir, entry)
      const st = await fs.stat(full).catch(() => null)
      if (!st || st.mtimeMs > cutoff) continue
      await fs.unlink(full).catch(() => {})
    }
  } catch (err) {
    console.error('[store] tmp sweep failed:', err)
  }
}

/** shared with the renderer, which reads `ok` on the answer of `state:save` */
export type { SaveResult }

/** atomic write: tmp -> rename, previous versions kept as .bak/.bak2 so a crash mid-write cannot lose everything */
async function writeState(state: AppState): Promise<SaveResult> {
  // the state on disk was never loaded into this session — saving would destroy it
  if (writeBlock) return { ok: false, error: writeBlock }
  const problem = saveProblem(state)
  if (problem) return { ok: false, error: problem }

  const target = statePath()
  // a unique name, so that concurrent writes do not share one and the same tmp file;
  // dotfile so a leftover does not stand out in the userData directory
  const tmp = join(
    dirname(target),
    `.${basename(target)}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  )
  try {
    await fs.mkdir(dirname(target), { recursive: true })
    const payload = JSON.stringify(encryptSecrets(state), null, 2)
    // 0600: the file holds agent env values
    await fs.writeFile(tmp, payload, { encoding: 'utf8', mode: FILE_MODE })
    await fs.chmod(tmp, FILE_MODE) // umask does not apply to an explicit chmod
    await rotateBackups(target)
    await fs.rename(tmp, target)
    return { ok: true }
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    console.error('[store] save failed:', err)
    return { ok: false, error: String(err) }
  }
}

/** a queue: every write waits for the previous one, otherwise concurrent saves race each other */
const saveQueue = serialize()

export function saveState(state: AppState): Promise<SaveResult> {
  return saveQueue(() => writeState(state))
}
