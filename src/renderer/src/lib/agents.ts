import type { AgentDef, AgentHookPaths, AgentRun, Settings, TerminalTab } from '../../../shared/types'

export function findAgent(settings: Settings, agentId?: string): AgentDef | null {
  if (!agentId) return null
  return settings.agents.find((a) => a.id === agentId) ?? null
}

/**
 * Both placeholders are always passed, but a tab may have no conversation id yet — the caller
 * says so with `undefined` rather than by leaving the field out, so nothing here has to guess
 * whether a missing id was meant or forgotten. An argument that fills out empty is dropped.
 */
function fill(args: string[], vars: { session: string | undefined; name: string }): string[] {
  return args
    .map((a) => a.replace('{session}', vars.session ?? '').replace('{name}', vars.name.replace(/"/g, '')))
    .filter((a) => a !== '')
}

function quote(arg: string): string {
  return /[^\w@%+=:,./-]/.test(arg) ? `'${arg.replace(/'/g, `'\\''`)}'` : arg
}

/**
 * A path as a TOML basic string, quotes included. Codex parses the value of `-c key=value` as
 * TOML, so the path travels through two grammars: TOML inside, the shell outside. This is the
 * inner one — a backslash or a quote in the path would end the string early — and `quote()`
 * above is the outer one, which is what carries a path with spaces in it.
 */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * What a tab is started with so that its CLI reports back which conversation it is in — see
 * `main/agentHooks` — and, for claude, so that its agent can open a session of its own. Each CLI
 * has its own way in, and nothing is written into the user's own configuration by either of them:
 *
 * - a `uuid` (claude-like) agent takes the settings overlay as `--settings`. The id we passed is
 *   ours only until the user types `/clear`, and the same overlay carries the turn events the
 *   bell is rung from. It also takes our MCP config as `--mcp-config`, which is the whole of
 *   what gives it the `open_session` tool (`main/agentTools`); without `--strict-mcp-config`
 *   that config is added to the user's own servers rather than replacing them;
 * - a `codex` agent takes the notify program as `-c notify=["…"]`, a config override on the
 *   command line. Codex is never told an id, so this is the only way the tab ever learns one.
 *   It is given no tool: the two CLIs do not share an MCP configuration format on the command
 *   line, and nothing here has been tried against codex.
 *
 * An agent with no per-tab identity (`none`) gets neither: nothing would read the answer.
 */
function reportingArgs(agent: AgentDef, hooks: AgentHookPaths): string[] {
  if (agent.sessionSource === 'uuid') {
    const args = ['--settings', quote(hooks.settings)]
    // the tool is optional in a way the reporting is not: its config may have failed to be
    // written, and a tab without it starts exactly as it did before
    if (hooks.mcp) args.push('--mcp-config', quote(hooks.mcp))
    return args
  }
  if (agent.sessionSource === 'codex') return ['-c', quote(`notify=[${tomlString(hooks.notify)}]`)]
  return []
}

/**
 * Command line for a terminal tab.
 *
 * Each tab carries its own conversation id, so two Claude tabs in one worktree
 * never resume each other: fresh runs pass `--session-id <uuid>`, later ones
 * `--resume <uuid>`. Agents without per-tab identity fall back to their own args.
 *
 * A codex tab has no id to pass on a fresh start — codex names its own thread and reports it
 * when the first turn ends — so it resumes with `{session}` just the same, but only from the
 * second time it is started onwards.
 */
export function commandFor(agent: AgentDef | null, tab: TerminalTab, hooks?: AgentHookPaths): string | undefined {
  if (!agent) return undefined
  const vars = { session: tab.agentSessionId, name: tab.title }
  const resume = Boolean(tab.launched)
  let args = resume ? agent.resumeArgs : agent.args
  // resuming needs an id; without one fall back to the agent's picker args
  if (resume && args.some((a) => a.includes('{session}')) && !tab.agentSessionId) args = agent.historyArgs
  const overlay = hooks ? reportingArgs(agent, hooks) : []
  const parts = [agent.command, ...overlay, ...fill([...args, ...agent.extraArgs], vars).map(quote)]
  // both CLIs take an initial prompt as a positional argument — far more reliable than typing it in
  if (!resume && tab.startPrompt) parts.push(quote(tab.startPrompt))
  return parts.filter(Boolean).join(' ')
}

/** command line that reopens a recorded run */
export function commandForRun(agent: AgentDef, run: AgentRun): string {
  const base = run.agentSessionId
    ? fill(agent.resumeArgs, { session: run.agentSessionId, name: run.title })
    : agent.historyArgs
  return [agent.command, ...[...base, ...agent.extraArgs].map(quote)].filter(Boolean).join(' ')
}

export function titleFor(agent: AgentDef | null, existing: TerminalTab[]): string {
  const base = agent ? agent.name : 'Shell'
  const same = existing.filter((t) => (agent ? t.agentId === agent.id : t.kind === 'shell')).length
  return same ? `${base} ${same + 1}` : base
}

const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'shell'])

/** how a CLI signs the window when it is doing nothing: a calling card, not the name of the work */
const PRODUCT_TITLES = new Set(['claude', 'claude code', 'codex', 'codex cli', 'openai codex'])

/**
 * Agents publish the current task as the terminal title (OSC 0/2). Everything that
 * merely describes the shell or the directory is useless as a tab or session name.
 */
export function nameFromTitle(title: string, cwd: string): string | null {
  // agents prefix titles with spinner glyphs and emoji; strip symbol ranges, keep words.
  // Two details of the character class, both from `no-misleading-character-class`: the astral
  // range is written as code points under /u, because as the surrogate range it matched each
  // half of an emoji on its own; and the variation selector goes in a pass of its own, because
  // inside the class it reads as a combining mark glued to the range in front of it.
  let t = title
    .replace(/\uFE0F/gu, '')
    .replace(/[\u2000-\u2BFF\u3000-\u303F\u{10000}-\u{10FFFF}*\u00B7\u2022]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  t = t.replace(/^\s*[-–—:]\s*/, '').trim()
  if (!t || t.length < 3) return null
  if (t.startsWith('/') || t.startsWith('~')) return null
  if (SHELLS.has(t.toLowerCase())) return null
  if (PRODUCT_TITLES.has(t.toLowerCase())) return null
  if (t.includes('@') && t.includes(':')) return null // user@host:/path
  const base = cwd.split('/').filter(Boolean).pop()
  if (base && t === base) return null
  return t.length > 48 ? t.slice(0, 47).trimEnd() + '…' : t
}

/** shell tabs are named after their directory plus whatever was last run there */
export function shellTitle(cwd: string, lastCommand?: string): string {
  const dir = cwd.split('/').filter(Boolean).pop() ?? cwd
  if (!lastCommand) return dir
  const short = lastCommand.length > 24 ? lastCommand.slice(0, 23) + '…' : lastCommand
  return `${dir} · ${short}`
}

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

export function formatEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

export function parseArgs(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}
