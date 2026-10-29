/**
 * Claude Code asks «do you trust the files in this folder?» the first time it starts in a
 * directory, and a session's worktree is a new directory every time. The answer is kept in the
 * profile's `.claude.json` as `projects[<path>].hasTrustDialogAccepted`, and this writes it for
 * a worktree the app has just created — but only when the person already gave that answer for
 * the project root (or a directory above it) in the same profile. The app never trusts a
 * repository on the person's behalf; it carries an existing answer over to a checkout of the
 * same repository that it made itself.
 *
 * Why the worktree is not covered already: in Claude Code 2.1.312 the walk up from the cwd stops
 * at the cwd's git root, and a worktree is a git root of its own — so a worktree nested inside a
 * trusted checkout still asks.
 *
 * The file is shared with every running CLI of that profile, each rewriting it whole. So:
 *  - read, change one key, write a temp file next to it and rename it over — never truncate in
 *    place, and a symlinked `.claude.json` is written at its target;
 *  - a file that does not parse is left alone (no «repair» to `{}`);
 *  - right before the rename the file is checked again; if a CLI wrote it in between, the read is
 *    redone, so its write is not lost to ours. A write landing in the microseconds between that
 *    check and the rename can still be lost — the same race every CLI of the profile has with
 *    the others, and it costs at most one of their own keys until they write again.
 */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve as resolvePath } from 'node:path'

/** the profile's config file: `$CLAUDE_CONFIG_DIR/.claude.json`, or `~/.claude.json` */
export function claudeConfigFile(configDir?: string): string {
  return join(configDir || homedir(), '.claude.json')
}

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function trustedExactly(config: Json, path: string): boolean {
  const projects = config.projects
  if (!isObject(projects)) return false
  const entry = projects[path]
  return isObject(entry) && entry.hasTrustDialogAccepted === true
}

/** trusted at this path or at any directory above it */
export function isTrusted(config: Json, path: string): boolean {
  let p = resolvePath(path)
  for (;;) {
    if (trustedExactly(config, p)) return true
    const up = dirname(p)
    if (up === p) return false
    p = up
  }
}

/**
 * The config with the worktree trusted, or null when nothing is to be written: the root is not
 * trusted (in any of the spellings given), or the worktree already is, exactly. Everything else
 * in the file, and in the worktree's own entry, is kept as it was.
 */
export function withTrustedWorktree(config: Json, rootPaths: string[], worktreePath: string): Json | null {
  if (!rootPaths.some((r) => isTrusted(config, r))) return null
  if (trustedExactly(config, worktreePath)) return null
  const projects = isObject(config.projects) ? config.projects : {}
  const existing = isObject(projects[worktreePath]) ? projects[worktreePath] : {}
  return { ...config, projects: { ...projects, [worktreePath]: { ...existing, hasTrustDialogAccepted: true } } }
}

export type TrustOutcome = 'trusted' | 'already' | 'root-untrusted' | 'unreadable' | 'busy'

async function stamp(file: string): Promise<string> {
  const st = await fs.stat(file)
  return `${st.mtimeMs}:${st.size}:${st.ino}`
}

const ATTEMPTS = 3

/**
 * Marks the worktree trusted in the profile, if its root is. The paths are compared as the CLI
 * will see them: the worktree by its real path (a process's cwd is always resolved), the root
 * both as given and resolved, since the person may have trusted either spelling.
 */
export async function trustWorktree(configFile: string, rootPath: string, worktreePath: string): Promise<TrustOutcome> {
  let file: string
  try {
    file = await fs.realpath(configFile)
  } catch {
    // no config file means nothing is trusted in this profile yet: nothing to carry over
    return 'root-untrusted'
  }
  const roots = [resolvePath(rootPath), await fs.realpath(rootPath).catch(() => resolvePath(rootPath))]
  const tree = await fs.realpath(worktreePath).catch(() => resolvePath(worktreePath))

  for (let i = 0; i < ATTEMPTS; i++) {
    let before: string
    let parsed: unknown
    let mode: number
    try {
      before = await stamp(file)
      mode = (await fs.stat(file)).mode & 0o777
      parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch {
      return 'unreadable'
    }
    if (!isObject(parsed)) return 'unreadable'
    if (!roots.some((r) => isTrusted(parsed, r))) return 'root-untrusted'
    const next = withTrustedWorktree(parsed, roots, tree)
    if (!next) return 'already'

    const tmp = `${file}.claude-studio-${process.pid}.tmp`
    try {
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), { mode })
      if ((await stamp(file)) !== before) {
        // a CLI wrote the file while ours was being prepared: start over from its version
        await fs.rm(tmp, { force: true })
        continue
      }
      await fs.rename(tmp, file)
      return 'trusted'
    } catch {
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      return 'unreadable'
    }
  }
  return 'busy'
}
