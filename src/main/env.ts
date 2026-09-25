/**
 * Agent CLIs mark the environment of processes they spawn. If the app itself was
 * started from inside such a session (or from an agent tab), those markers leak
 * into every terminal we open, and the nested agent decides it is a child session:
 * it stops saving its transcript, which also makes `--resume <id>` useless.
 *
 * Terminals opened by the app are always top-level sessions, so the markers go.
 * User-facing configuration (CLAUDE_CONFIG_DIR, ANTHROPIC_*, CODEX_HOME) is kept.
 */
const SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_FORCE_SESSION_PERSISTENCE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CODEX_SESSION_ID',
  'CODEX_THREAD_ID',
]

const MARKER_PREFIXES = ['CLAUDE_CODE_EXPERIMENTAL_']

/**
 * Profile selection must come from the agent's settings, not from whatever shell
 * happened to launch the app: otherwise the same tab reads a different history and
 * a different session store depending on how the window was started.
 */
const AMBIENT_PROFILE = ['CLAUDE_CONFIG_DIR']

/** the variables that override -C and would swap the repository out from under us */
const GIT_OVERRIDES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']

function buildGitEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string' || GIT_OVERRIDES.includes(key)) continue
    env[key] = value
  }
  return env
}

function buildAgentEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue
    if (SESSION_MARKERS.includes(key)) continue
    if (MARKER_PREFIXES.some((p) => key.startsWith(p))) continue
    if (AMBIENT_PROFILE.includes(key)) continue
    env[key] = value
  }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

// Every spawn used to rebuild the whole environment (~11 spawns per poll per open
// session). The filtered result is cached instead, but callers mutate what they get
// (pty.ts adds TERM, serviceAgent.ts merges the agent's own env), so each call still
// hands out a fresh shallow copy.
//
// process.env can change at runtime (smoke.ts sets session markers to prove they do
// not leak), so the cache is dropped whenever the number of keys changes. That covers
// added/removed variables; a variable whose value is rewritten in place needs an
// explicit invalidateEnvCache().
let cachedGitEnv: Record<string, string> | null = null
let cachedAgentEnv: Record<string, string> | null = null
let cachedEnvSize = -1

/** Drops the memoised environments. Call after mutating process.env in place. */
export function invalidateEnvCache(): void {
  cachedGitEnv = null
  cachedAgentEnv = null
  cachedEnvSize = -1
}

function checkGeneration(): void {
  const size = Object.keys(process.env).length
  if (size === cachedEnvSize) return
  cachedGitEnv = null
  cachedAgentEnv = null
  cachedEnvSize = size
}

export function cleanGitEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (source !== process.env) return buildGitEnv(source)
  checkGeneration()
  if (!cachedGitEnv) cachedGitEnv = buildGitEnv(process.env)
  return { ...cachedGitEnv }
}

export function cleanAgentEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (source !== process.env) return buildAgentEnv(source)
  checkGeneration()
  if (!cachedAgentEnv) cachedAgentEnv = buildAgentEnv(process.env)
  return { ...cachedAgentEnv }
}
