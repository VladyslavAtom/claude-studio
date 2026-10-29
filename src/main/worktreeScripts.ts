/**
 * A repository's own worktree scripts: `setup` after a session's worktree is created, `teardown`
 * before it is removed. They live in `.claude-studio.json` at the repository root:
 *
 *     { "scripts": { "setup": "npm ci && cp .env.example .env", "teardown": "docker compose down" } }
 *
 * Each is one `sh -c` string, run in the worktree with the worktree's env (`shared/worktreeSetup`).
 *
 * Running them is running code the repository brought, so two gates stand in front of it:
 *  - the scripts are read from a project the person opened in the app, never from a path an
 *    agent or a conversation named (`projectRoots.isOpenedProject`);
 *  - the file's sha256 has to be approved, once, by the person. An edit — by a teammate, by an
 *    agent — is a new hash and asks again. Approvals are kept here in main, in a file of their
 *    own, not in state.json: the renderer cannot mark a script approved without coming through
 *    `approveScripts`, which re-reads the file and compares the hash.
 *
 * The file is read from the project root, not from the new worktree: the root is what the person
 * opened, and a worktree's copy is what its agent may have just edited.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { WORKTREE_CONFIG_FILE } from '../shared/types'
import type { AppMessage } from '../shared/types'
import { cleanAgentEnv } from './env'
import { run } from './git/exec'

/** how long a teardown may hold up the removal; it is killed after that and the removal goes on */
export const TEARDOWN_TIMEOUT_MS = 30_000
/** how many approved versions are remembered per repository */
const KEEP_PER_REPO = 20

export interface ScriptsConfig {
  setup?: string
  teardown?: string
}

export type ReadConfig =
  { kind: 'none' } | { kind: 'invalid'; error: string } | { kind: 'ok'; config: ScriptsConfig; hash: string }

export function hashConfig(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** the scripts a config file's text declares; anything that is not a non-empty string is ignored */
export function parseScriptsConfig(text: string): ScriptsConfig {
  const root: unknown = JSON.parse(text)
  if (typeof root !== 'object' || root === null || Array.isArray(root)) throw new Error('the root is not an object')
  const scripts = (root as { scripts?: unknown }).scripts
  if (typeof scripts !== 'object' || scripts === null) return {}
  const pick = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
  const setup = pick((scripts as { setup?: unknown }).setup)
  const teardown = pick((scripts as { teardown?: unknown }).teardown)
  return { ...(setup ? { setup } : {}), ...(teardown ? { teardown } : {}) }
}

export async function readScriptsConfig(repoPath: string): Promise<ReadConfig> {
  let text: string
  try {
    const file = join(repoPath, WORKTREE_CONFIG_FILE)
    if (!(await fs.lstat(file)).isFile()) return { kind: 'none' }
    text = await fs.readFile(file, 'utf8')
  } catch {
    return { kind: 'none' }
  }
  try {
    const config = parseScriptsConfig(text)
    if (!config.setup && !config.teardown) return { kind: 'none' }
    return { kind: 'ok', config, hash: hashConfig(text) }
  } catch (e) {
    return { kind: 'invalid', error: e instanceof Error ? e.message : String(e) }
  }
}

// --- approvals ---------------------------------------------------------------

type Approvals = Record<string, string[]>

async function readApprovals(file: string): Promise<Approvals> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    const approved = (parsed as { approved?: unknown }).approved
    if (typeof approved !== 'object' || approved === null) return {}
    const out: Approvals = {}
    for (const [repo, hashes] of Object.entries(approved)) {
      if (Array.isArray(hashes)) out[repo] = hashes.filter((h): h is string => typeof h === 'string')
    }
    return out
  } catch {
    // missing or unreadable: nothing is approved, which only means the person is asked again
    return {}
  }
}

export async function isApproved(file: string, repoPath: string, hash: string): Promise<boolean> {
  return (await readApprovals(file))[repoPath]?.includes(hash) ?? false
}

export async function recordApproval(file: string, repoPath: string, hash: string): Promise<void> {
  const all = await readApprovals(file)
  const kept = (all[repoPath] ?? []).filter((h) => h !== hash)
  all[repoPath] = [...kept, hash].slice(-KEEP_PER_REPO)
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify({ version: 1, approved: all }, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(tmp, file)
}

// --- teardown ----------------------------------------------------------------

/**
 * Runs the teardown in the worktree. Never throws and never takes longer than the timeout; the
 * answer is a note for the person, not a reason to keep the worktree.
 */
export async function runTeardown(
  worktreePath: string,
  script: string,
  env: Record<string, string>,
): Promise<(AppMessage & { detail?: string }) | null> {
  try {
    if (!(await fs.stat(worktreePath)).isDirectory()) return null
  } catch {
    // the directory is already gone: there is nothing left for a teardown to act on
    return null
  }
  const r = await run('sh', worktreePath, ['-c', script], TEARDOWN_TIMEOUT_MS, { ...cleanAgentEnv(), ...env })
  if (r.code === 0 && !r.problem) return null
  const detail = (r.stderr || r.stdout).trim().split('\n').slice(-5).join('\n')
  const reason = r.problem === 'timeout' ? 'timeout' : r.problem ? 'spawn' : 'exit'
  return {
    code: 'worktree-teardown-failed',
    params:
      reason === 'exit'
        ? { reason, exit: r.code }
        : reason === 'timeout'
          ? { reason, seconds: TEARDOWN_TIMEOUT_MS / 1000 }
          : { reason },
    ...(detail ? { detail } : {}),
  }
}
