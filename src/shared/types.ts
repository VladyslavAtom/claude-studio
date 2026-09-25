export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

/** working = vs HEAD (staged + unstaged + untracked), base = vs the branch the worktree started from */
export type DiffMode = 'working' | 'base'

/** a tab of a session: a process, an open file, or the diff of a file */
export type TerminalKind = 'agent' | 'shell' | 'editor' | 'diff' | 'merge'

/** how a terminal gets a stable, per-tab conversation id */
export type SessionSource =
  /** we generate a UUID and pass it in via {session} (claude --session-id) */
  | 'uuid'
  /** the CLI picks its own id and reports it through `notify` when a turn ends */
  | 'codex'
  /** no per-tab identity: resume args are used as-is */
  | 'none'

/** a preset pins down what the CLI itself dictates: the command and the way to address a conversation */
export type AgentPreset = 'claude' | 'codex' | 'custom'

export interface AgentDef {
  id: string
  name: string
  preset: AgentPreset
  /** binary as it is called from the shell, e.g. `claude` or `codex` */
  command: string
  /** args for a fresh run; supports {session} and {name} placeholders */
  args: string[]
  /** args used to resume this tab's own conversation; supports {session} and {name} */
  resumeArgs: string[]
  /** args that open the CLI's own session picker (used from the history panel) */
  historyArgs: string[]
  sessionSource: SessionSource
  /** the user's own free-form arguments, added both on a fresh run and on a resume */
  extraArgs: string[]
  /** extra env for this agent, e.g. CLAUDE_CONFIG_DIR=/home/bv/.claude-1 */
  env: Record<string, string>
  color: string
  enabled: boolean
}

/** what generates commit messages: the command and the environment come from the chosen agent */
/** the «ask an open tab» generator: no cold start, and the session's context comes with it */
export const COMMIT_VIA_TAB = ':tab'

/** the «service session» generator: one warmed-up process for the whole application */
export const COMMIT_VIA_SERVICE = ':service'

/** the arguments of the service session: a small model, the lowest effort, a conversation of its own */
export const SERVICE_ARGS = ['--model', 'haiku', '--effort', 'low']

export interface CommitMessageConfig {
  /** the id of an agent from the settings, COMMIT_VIA_TAB, or null — use the command below as is */
  agentId: string | null
  /** the arguments of the non-interactive mode; {outfile} is supported — the path for the answer */
  args: string[]
  prompt: string
  timeoutMs: number
  /** bring the service session up right at application start */
  warmOnStart?: boolean
  /** a fallback for an agent that is not in the list */
  command?: string
  env?: Record<string, string>
}

/** the arguments of a non-interactive run, per preset */
export const COMMIT_ARGS_BY_PRESET: Record<AgentPreset, string[]> = {
  claude: ['-p', '--model', 'haiku', '--effort', 'low', '--no-session-persistence', '--safe-mode'],
  codex: ['exec', '--skip-git-repo-check', '--output-last-message', '{outfile}'],
  custom: [],
}

export interface SleepConfig {
  enabled: boolean
  /** minutes of terminal silence before an agent tab is put to sleep */
  minutes: number
}

export type StartupPolicy = 'ask' | 'all' | 'none'

/** how «Pull — update the project» brings other people's commits in; 'ask' means asking every time */
export type PullStrategy = 'ask' | 'merge' | 'rebase'

export interface NotificationConfig {
  enabled: boolean
  sound: boolean
  /** notify only while the window is in the background */
  onlyWhenUnfocused: boolean
}

export interface LayoutConfig {
  sessions: number
  files: number
  changes: number
  /** the file tree panel is open; the state survives a restart */
  filesOpen: boolean
  /** the changes panel is collapsed */
  changesCollapsed: boolean
}

export interface EditorConfig {
  /** save edits automatically, without Ctrl+S */
  autoSave: boolean
  /** the pause after the last keystroke, ms */
  delayMs: number
}

export const defaultEditor: EditorConfig = { autoSave: true, delayMs: 800 }

export interface TerminalConfig {
  /**
   * How many lines of output a terminal keeps to scroll back through. `null` is «no limit»:
   * everything the tab has printed stays in memory until the tab or the application closes.
   *
   * Null and not 0, and not an absent field. Zero already means the opposite of «no limit» one
   * layer down — xterm's own `scrollback: 0` keeps the viewport and nothing else, and that value
   * is used deliberately for the sleeping-tab snapshot — so spelling «unlimited» as 0 here would
   * put two opposite meanings on one number in files that call each other. An absent field is
   * the shape reserved for «the user has never chosen» (see `locale` and `theme`), and there is
   * nothing to follow here: the app has no system-provided scrollback to defer to, so «never
   * chosen» and «unlimited» would be the same state written two ways.
   */
  scrollbackLines: number | null
}

/**
 * Unlimited, so nothing a person scrolls back for has already been thrown away. What it costs
 * is said on the settings page, not left to be discovered.
 */
export const defaultTerminal: TerminalConfig = { scrollbackLines: null }

/**
 * What the «lines kept» field offers when a limit is switched back on. It is the fixed value the
 * terminals used before the setting existed, so turning the limit on lands on the old behaviour.
 */
export const DEFAULT_SCROLLBACK_LINES = 5000

export const defaultNotifications: NotificationConfig = { enabled: true, sound: true, onlyWhenUnfocused: false }
export const defaultLayout: LayoutConfig = {
  sessions: 232,
  files: 260,
  changes: 340,
  filesOpen: false,
  changesCollapsed: false,
}

/** UI languages; English is the source of the catalogue and the fallback */
export const LOCALES = ['en', 'ru', 'uk'] as const
export type Locale = (typeof LOCALES)[number]

/** the locale the app falls back to when nothing is chosen and the system language is none of ours */
export const defaultLocale: Locale = 'en'

/** a theme that can actually be painted; every colour in the app is defined for each of these */
export const THEMES = ['dark', 'light'] as const
export type ThemeName = (typeof THEMES)[number]

/** what the user picked: a theme, or the standing instruction to follow the OS */
export const THEME_CHOICES = ['system', ...THEMES] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]

export const defaultTheme: ThemeChoice = 'system'

export interface Settings {
  agents: AgentDef[]
  commitMessage: CommitMessageConfig
  sleep: SleepConfig
  startup: StartupPolicy
  pullStrategy: PullStrategy
  notifications: NotificationConfig
  layout: LayoutConfig
  editor: EditorConfig
  terminal: TerminalConfig
  /**
   * UI language. Absent means the user has never picked one: the app then follows the system
   * language when it is one of ours and falls back to English. Picking a language in the
   * settings writes the field, and from then on the system language is ignored.
   */
  locale?: Locale
  /**
   * Colour theme. Absent means the same as 'system': follow the OS and keep following it, which
   * is why it is a choice of its own rather than a resolved theme written down once.
   */
  theme?: ThemeChoice
  /** the agent the «+» button creates without opening the list */
  lastAgentId?: string | null
}

/**
 * The colours an agent is offered by default. Each one clears 3:1 against every surface it lands
 * on in BOTH themes — a dot and a swatch are non-text UI, so 3:1 is the bar. The pastels these
 * replaced were picked against a near-black window and came out at ~2:1 on white.
 */
export const AGENT_COLORS = ['#2f80d0', '#1f9142', '#9b5de5'] as const

/** the blanks behind the «add an agent» button: everything that must not be edited by hand */
export interface AgentPresetDef {
  preset: AgentPreset
  name: string
  command: string
  args: string[]
  resumeArgs: string[]
  historyArgs: string[]
  sessionSource: SessionSource
  color: string
  hint: string
}

export const AGENT_PRESETS: AgentPresetDef[] = [
  {
    preset: 'claude',
    name: 'Claude',
    command: 'claude',
    args: ['--session-id', '{session}'],
    resumeArgs: ['--resume', '{session}'],
    historyArgs: ['--resume'],
    sessionSource: 'uuid',
    color: '#2f80d0',
    hint: 'A conversation of its own per tab: the id is ours, continuation is --resume. The profile comes from CLAUDE_CONFIG_DIR.',
  },
  {
    preset: 'codex',
    name: 'Codex',
    command: 'codex',
    args: [],
    resumeArgs: ['resume', '{session}'],
    historyArgs: ['resume'],
    sessionSource: 'codex',
    color: '#1f9142',
    hint: 'Codex picks the id itself and names it when the first turn ends: a restart before that starts a new conversation.',
  },
  {
    preset: 'custom',
    name: 'Custom agent',
    command: '',
    args: [],
    resumeArgs: [],
    historyArgs: [],
    sessionSource: 'none',
    color: '#9b5de5',
    hint: 'Set up by hand: the command, the arguments and the way a conversation is addressed.',
  },
]

export const defaultAgents: AgentDef[] = [
  {
    id: 'claude',
    name: 'Claude',
    preset: 'claude',
    command: 'claude',
    args: ['--session-id', '{session}'],
    resumeArgs: ['--resume', '{session}'],
    historyArgs: ['--resume'],
    sessionSource: 'uuid',
    extraArgs: [],
    env: {},
    color: '#2f80d0',
    enabled: true,
  },
  {
    id: 'codex',
    name: 'Codex',
    preset: 'codex',
    command: 'codex',
    args: [],
    resumeArgs: ['resume', '{session}'],
    historyArgs: ['resume'],
    sessionSource: 'codex',
    extraArgs: [],
    env: {},
    color: '#1f9142',
    enabled: true,
  },
]

export const defaultCommitMessage: CommitMessageConfig = {
  agentId: COMMIT_VIA_SERVICE,
  args: SERVICE_ARGS,
  timeoutMs: 60_000,
  warmOnStart: true,
  // Deliberately not localised, and not part of the interface dictionaries: this prompt steers
  // the text of git commit messages, and the repository's commit language is the repository's
  // own convention — it does not follow whatever language the window happens to be drawn in.
  // English is the default because it is the default of most repositories; a person who commits
  // in another language edits this in Settings, where it is shown in full.
  prompt:
    'Write a commit message for these changes: an imperative summary of up to 72 characters. ' +
    'No quotes, no preamble, no reasoning.',
}

export const defaultSleep: SleepConfig = { enabled: true, minutes: 30 }

export interface TerminalTab {
  id: string
  kind: TerminalKind
  /** which agent from settings this tab runs; absent for plain shells */
  agentId?: string
  title: string
  /** this tab's own conversation id — never shared with other tabs */
  agentSessionId?: string
  /** the title comes from the agent's store: the terminal title no longer overrides it */
  titleFromStore?: boolean
  /** the name was set by a person: neither the agent nor the window title changes it any more */
  titleManual?: boolean
  /** true once the agent was launched at least once, so the next start resumes */
  launched?: boolean
  startedAt?: number
  /** task typed in the new-session modal; passed to the agent on its first run */
  startPrompt?: string
  /** the conversation lies in another profile of the agent — the tab needs its own CLAUDE_CONFIG_DIR */
  configDir?: string
  /** for editor and merge tabs: the path to the file */
  filePath?: string
  /** for editor tabs: the line to scroll to — a terminal link that named one (`git.ts:42`) */
  fileLine?: number
  /** for merge tabs: the working directory of the repository */
  mergeCwd?: string
  /** for diff tabs: what is compared against what */
  diff?: {
    cwd: string
    path: string
    oldPath?: string
    status: ChangeStatus
    untracked: boolean
    mode: DiffMode
    baseRef?: string
  }
}

/**
 * What a tab's CLI last said about the conversation it is in — see `main/agentHooks`. A tab is
 * started with an id we chose, but `/clear` leaves that conversation for one of the CLI's own,
 * and this is how the tab learns the new id instead of resuming an abandoned one.
 */
export interface AgentSessionReport {
  sessionId: string
  /**
   * The conversation's own file; kept because it is what the id was checked against. Claude
   * only — codex names its thread and nothing else, and there is nothing to cross-check it with.
   */
  transcriptPath?: string
}

/**
 * Where the two things a tab may be started with live. Both are written once, at startup, and
 * their paths are read on every start of a tab — see `main/agentHooks`.
 */
export interface AgentHookPaths {
  /** the settings overlay of a claude tab, passed as `--settings`: the conversation and its turns */
  settings: string
  /** the program a codex tab names its conversation through, passed as `-c notify=[…]` */
  notify: string
  /**
   * the MCP config a claude tab is passed as `--mcp-config`, which is what gives its agent the
   * tool for opening a session of its own (see `main/agentTools`). Absent when the config could
   * not be written: the tab then starts without the tool and behaves exactly as it did before.
   */
  mcp?: string
}

/**
 * What an agent asked the application to do through its tool. Written by the MCP server as a
 * file, taken by main, carried out by the renderer — which is the only side that knows what a
 * session is.
 */
export interface AgentToolRequest {
  id: string
  /** the tab whose agent asked; null when the server could not name it — then the active project */
  terminalId: string | null
  /** the first task of the new session, handed to its agent as the initial prompt */
  task: string
  /** the session name; absent means numbered exactly as the new-session window numbers it */
  name?: string
  /** a worktree of its own; absent means the project's default — isolated when it is a git repo */
  isolate?: boolean
}

/**
 * The answer to one request. It is read by the agent that asked, never by a person, so the
 * `error` is an English sentence rather than an `AppMessageCode`: the renderer is writing to
 * another CLI here, not to the interface.
 */
export interface AgentToolResult {
  ok: boolean
  error?: string
  session?: AgentToolSession
}

export interface AgentToolSession {
  name: string
  cwd: string
  branch?: string
  /** the conversation id the new tab is started with: how the asking agent can name it */
  agentSessionId?: string
  /**
   * its agent is already running. A tab's process starts when its pane is first mounted, and a
   * pane exists only for the session on screen — a session opened in a project the user is not
   * looking at waits for them to open it.
   */
  started: boolean
}

/**
 * Everything a tab's CLI has said since it was last asked. Reading this **consumes** the counts,
 * so the answer has to be acted on: a discarded one is a bell that never rang.
 */
export interface AgentHookReport {
  /**
   * The conversation the CLI is in, or null when it has reported nothing at all. For a claude
   * tab null also answers «are this tab's hooks running»: the CLI reports a start for every tab,
   * so a live tab without one will never ring, and the interface has to say so. A codex tab is
   * not the same case — it names its thread when a turn ends, so silence means «has not answered
   * yet» at least as often as «cannot report», and it has no bell to lose either way.
   */
  session: AgentSessionReport | null
  /**
   * Turns of the **main** agent that ended since the last read. A subagent finishing is not one
   * of them — that is the whole point: the transcript records both the same way, so a finished
   * subagent used to ring the bell while the main agent was still working. Claude alone reports
   * events; for a codex tab this is always zero, which is what it has always been.
   */
  stops: number
  /**
   * Times the CLI itself asked for a person mid-turn: a permission prompt, or an agent left
   * idle. Counted apart from `stops` because it is not the same event — the turn has not ended,
   * so nothing about the conversation is final and its name is not re-read. Claude only: codex
   * raises nothing of the kind that a tab of ours can hear.
   */
  notifications: number
}

/**
 * What a running claude says about itself, taken from the file it keeps per live session — see
 * `main/agentSessions`. This is a **state**, not an event: it is the process's own answer to
 * «what am I doing», so it does not go stale between two polls the way a count of events would.
 *
 * The four words are the whole of the CLI's own set (2.1.220). Anything else — a word a later
 * version invents, an unreadable file, no file at all — is `null` and means «the process did not
 * answer», which is where the tab falls back on what it has printed.
 */
export type AgentActivity =
  /** a turn is being worked on */
  | 'busy'
  /** a shell command of the CLI's own is running; the CLI's session list counts it as working */
  | 'shell'
  /** blocked on a person: a permission prompt, a dialog, a sandbox request */
  | 'waiting'
  /** started, and doing nothing */
  | 'idle'

/** what a terminal is doing right now: what its CLI says, else its output stream and BEL */
export type TerminalStatus = 'running' | 'waiting' | 'idle' | 'asleep' | 'dead'

/** a finished (or superseded) agent run, kept as session history */
export interface AgentRun {
  id: string
  agentId: string
  agentSessionId?: string
  title: string
  startedAt: number
  endedAt?: number
}

export interface WorktreeInfo {
  path: string
  branch: string
  baseRef: string
}

export interface Session {
  id: string
  name: string
  /** name still follows the agent's terminal title; cleared once renamed by hand */
  nameAuto?: boolean
  cwd: string
  worktree?: WorktreeInfo
  terminals: TerminalTab[]
  activeTerminalId: string | null
  createdAt: number
  runs?: AgentRun[]
}

export interface ArchivedSession extends Session {
  closedAt: number
  /** worktree was deleted when the session was closed -> restore is history-only */
  worktreeRemoved?: boolean
}

export interface Project {
  id: string
  name: string
  path: string
  isGit: boolean
  sessions: Session[]
  activeSessionId: string | null
  history?: ArchivedSession[]
}

/**
 * A project the user closed. Kept whole — sessions, their tabs and the project's own history —
 * so that opening the same folder again brings the work back instead of an empty project.
 */
export interface ClosedProject extends Project {
  closedAt: number
}

/**
 * On-disk state version. Bumped together with a migration step in the main process; the loader
 * refuses to overwrite a file written by a newer version rather than discarding what it cannot read.
 */
export const STATE_VERSION = 3

export interface AppState {
  version: number
  projects: Project[]
  /** most recently closed first, capped — the list a project is restored from */
  closedProjects: ClosedProject[]
  activeProjectId: string | null
  settings: Settings
}

/** how many closed projects are remembered; older ones fall off the end */
export const CLOSED_PROJECTS_KEPT = 20

export const emptyState: AppState = {
  version: STATE_VERSION,
  closedProjects: [],
  projects: [],
  activeProjectId: null,
  settings: {
    agents: defaultAgents,
    commitMessage: defaultCommitMessage,
    sleep: defaultSleep,
    startup: 'ask',
    pullStrategy: 'ask',
    notifications: defaultNotifications,
    layout: defaultLayout,
    editor: defaultEditor,
    terminal: defaultTerminal,
  },
}

export interface ChangedFile {
  path: string
  oldPath?: string
  status: ChangeStatus
  staged: boolean
  untracked: boolean
}

export interface GitStatusResult {
  files: ChangedFile[]
  branch: string | null
  /** relative to the base branch: how many commits were made and how far behind it is */
  ahead: number
  behind: number
  /** the tracked branch on the server, and how many commits have not been sent there */
  upstream?: string | null
  unpushed?: number
  /** how many commits exist in the upstream but have not been pulled here yet */
  unpulled?: number
  error?: string
}

export interface PtyStartResult {
  buffer: string
  seq: number
  alive: boolean
}

export interface PtyDataEvent {
  id: string
  data: string
  seq: number
}

export interface PtyExitEvent {
  id: string
  exitCode: number
}

export interface PtySleepEvent {
  id: string
  idleMs: number
}

export interface PtyCommandEvent {
  id: string
  command: string
}

/** a conversation found in the agent CLI's own store, not necessarily started from this app */
/** a commit for the push window: no diff, the files are fetched separately on a click */
export interface CommitInfo {
  hash: string
  short: string
  subject: string
  author: string
  date: number
}

export interface ExternalSession {
  /** conversation id, as accepted by `claude --resume` / `codex resume` */
  id: string
  agentId: string
  /** the store directory the conversation came from: for Claude one of the ~/.claude* */
  configDir?: string
  cwd: string
  title: string
  startedAt: number
  updatedAt: number
}

export interface ExternalSessionQuery {
  agentId: string
  kind: 'claude' | 'codex'
  /** CLAUDE_CONFIG_DIR of that agent, when it differs from the default */
  configDir?: string
}

/** an unfinished operation in the repository: it has to be left before any further work */
export interface RepoState {
  operation: 'none' | 'rebase' | 'merge' | 'cherry-pick' | 'revert'
  conflicted: string[]
  /** for a rebase: «step of steps», when git reports it */
  step?: string
}

export interface BranchInfo {
  /** the short name: main, feature/x, origin/main */
  name: string
  remote: boolean
  /** for a local branch — the remote branch it tracks */
  upstream?: string
  current: boolean
  updatedAt: number
  subject: string
}

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
}

/**
 * What `files:readDir` answers. A failure carries a code rather than a message: the renderer
 * owns the wording, and an empty directory has to stay distinguishable from one that could not
 * be read at all.
 *   denied        — no permission to read the directory (EACCES/EPERM)
 *   missing       — nothing at that path any more (ENOENT)
 *   not-a-dir     — the path exists but is a file (ENOTDIR)
 *   outside-roots — the path is outside every root the user has opened; the read never happened
 *   failed        — anything else the filesystem reported
 */
export type ReadDirResult =
  | { ok: true; entries: DirEntry[] }
  | { ok: false; code: 'denied' | 'missing' | 'not-a-dir' | 'outside-roots' | 'failed' }

// ---------------------------------------------------------------------------
// Sentences the main process authors itself.
//
// The `error` field of a main-process result used to carry two different vocabularies: git's own
// stderr — English plumbing, untranslatable and worth showing verbatim — and sentences this
// application composed, which name its own buttons and panels. Only the second kind can be
// translated, and the renderer could branch on neither.
//
// So everything the app writes itself now travels as a code out of `AppMessageCode` plus the
// values its wording needs, while `error`, `output` and `warning` keep carrying the tool's own
// output and nothing else. The renderer owns every word — only it knows the locale.
// ---------------------------------------------------------------------------

/** the values a message's wording interpolates: a branch name, a file count, a size limit */
export type MessageParams = Record<string, string | number>

export type AppMessageCode =
  // --- the spawn itself failed: the process never ran to completion (main/git/exec.ts) ---
  /** the command printed more than the buffer holds; select fewer files. {command, sub, limitMb} */
  | 'git-output-too-large'
  /** the command was still running when the timeout ran out and was killed. {command, sub, seconds} */
  | 'git-timeout'
  /** the binary is not installed or not on PATH. {command, sub} */
  | 'git-not-found'
  /** the process could not be started at all; `reason` is node's own errno or message. {command, sub, reason} */
  | 'git-spawn-failed'

  // --- committing, reverting, resolving (main/git/commit.ts, main/git/state.ts) ---
  /** the action needs files and none were ticked */
  | 'no-files-selected'
  /** the commit message box is empty */
  | 'commit-empty-message'
  /** none of the selected files differ from the last commit — the panel's list has gone stale */
  | 'commit-already-committed'
  /** git found nothing to commit: the working tree is clean */
  | 'commit-nothing-to-commit'
  /** success note next to git's own line: some selected files were already committed. {count} */
  | 'commit-skipped-committed'

  // --- an unfinished operation in the repository (main/git/state.ts) ---
  /** continue/skip/abort was asked for while nothing is in progress */
  | 'no-operation-in-progress'
  /** merge/rebase/pull stopped on a conflict: resolve them in the changes panel. {operation, ref?, files} */
  | 'conflict-stop'

  // --- branches and worktrees (main/git/branches.ts, main/git/worktree.ts) ---
  /** the branch cannot be deleted: a worktree points at it. {branch, path} */
  | 'branch-used-by-worktree'
  /** a worktree cannot be created: another one already holds that branch. {branch} */
  | 'worktree-branch-busy'
  /** `git worktree remove` failed; `leftover` says what survived it. {leftover: 'both'|'record'|'dir'} */
  | 'worktree-remove-failed'
  /** the worktree is gone but its branch could not be deleted — a warning, not a failure */
  | 'worktree-removed-branch-kept'

  // --- the server (main/git/remote.ts, main/gh.ts) ---
  /** pull has nowhere to pull from: the branch has no upstream yet, a push would create it */
  | 'no-upstream'
  /** `gh pr create` finished without printing a URL and without saying why */
  | 'pr-create-no-url'

  // --- the clone address, checked before the spawn (main/git/clone.ts) ---
  /** nothing was typed */
  | 'clone-url-empty'
  /** the address starts with `-`: git would read it as an option */
  | 'clone-url-leading-dash'
  /** `<helper>::<address>` picks a remote helper, which can run a command */
  | 'clone-url-helper'
  /** the scheme is not one of https/http/ssh/git. {scheme} */
  | 'clone-url-scheme'
  /** none of the accepted forms matched */
  | 'clone-url-unrecognised'

  // --- reading and writing files (main/files.ts) ---
  /** the path lies outside every project root the user has opened */
  | 'path-outside-roots'
  /** the file is past the editable size limit. {limitMb, sizeKb} */
  | 'file-too-large'
  /** a NUL byte in the first block: this is not text */
  | 'file-binary'
  /** a path clicked in terminal output is no longer on disk — it was checked before it was linked */
  | 'terminal-path-gone'
  /** a path clicked in terminal output is a directory, or something else that is not a file */
  | 'terminal-path-not-a-file'

  // --- the draft commit message (main/commitMessage.ts, main/serviceAgent.ts) ---
  /** the selected files differ from neither HEAD nor the base ref, so there is nothing to describe. {ref?} */
  | 'draft-no-changes'
  /** the CLI exited without writing anything */
  | 'draft-empty-answer'
  /** the warmed-up service session produced no answer; `error` holds its stderr tail when there was one */
  | 'service-no-answer'

/** an app-authored sentence: which one, and the values it interpolates */
export interface AppMessage {
  code: AppMessageCode
  params?: MessageParams
}

/**
 * Mixed into every main-process result that can carry an app-authored sentence. Both keys are
 * absent when the result carries only the tool's own output — that text is passed through as is.
 */
export interface Coded {
  code?: AppMessageCode
  params?: MessageParams
}

/** the plain answer of an action: it worked, or it did not and here is why */
export interface OpResult extends Coded {
  ok: boolean
  /** the tool's own stderr, verbatim and untranslated; absent when only a `code` explains the failure */
  error?: string
}

/** the answer of a git action that also has something to show on success */
export interface GitOpResult extends OpResult {
  /** git's own closing line, verbatim */
  output?: string
}

/**
 * How the last load of state.json went. 'none' is the normal case, first run included.
 * 'backup'  — the main file was unusable and the state came from a .bak
 * 'empty'   — neither the file nor any backup could be read; the app started blank
 * 'too-new' — the file was written by a newer build: it is neither parsed nor overwritten
 */
export interface StateLoadOutcome {
  recovered: 'none' | 'backup' | 'empty' | 'too-new'
  reason?: string
}

/**
 * Answer of `state:save`. A save is refused outright when the file on disk was written by a
 * newer build, or when a corrupt one could not even be moved aside — overwriting either would
 * destroy the user's projects. The renderer has to read `ok`: a save that silently did nothing
 * looked exactly like a save that worked.
 */
export type SaveResult = { ok: true } | { ok: false; error: string }

/** answer of `state:health`: what Settings needs to warn about the state on disk */
export interface StateHealth {
  load: StateLoadOutcome
  /**
   * what the agents' env values on disk are protected by:
   *   'os'   — a real keyring (Keychain, DPAPI, libsecret, kwallet)
   *   'weak' — the Linux `basic_text` fallback: a hardcoded key, i.e. obfuscation
   *   'none' — no encryption at all, the values lie there in plain text
   */
  encryption: 'os' | 'weak' | 'none'
  /** every save is refused: the state on disk was never loaded and must not be destroyed */
  saveBlocked: boolean
}

export interface FileContent extends Coded {
  ok: boolean
  content?: string
  /** the filesystem's own message; a refusal the app itself decided on comes as `code` instead */
  error?: string
  binary?: boolean
  /**
   * The file is shown, not edited: a data URL the renderer can paint as it stands. Set instead
   * of `content`, so a reader that only knows about text sees a successful read with nothing in
   * it rather than a picture rendered as mojibake.
   */
  image?: string
  size?: number
}

// ---------------------------------------------------------------------------
// Payloads that cross the IPC boundary. Each one used to be written twice — once in
// `src/main`, once in `src/preload` — and the two copies could drift apart without a
// single compile error, because `ipcRenderer.invoke` types its arguments as `any`.
// They live here so that both sides import the same declaration.
// ---------------------------------------------------------------------------

export interface WorktreeAddOptions {
  repoPath: string
  worktreePath: string
  branch: string
  baseRef: string
}

export interface PtyStartOptions {
  id: string
  cwd: string
  kind: TerminalKind
  /**
   * The measured size of the pane. Both are absent when the renderer has no size to report — a
   * pane that is hidden (`display: none`) cannot be measured, and xterm then hands back its own
   * untouched default. On a re-attach that means "leave the pty's size alone"; on a fresh spawn
   * the default below is used. Real size changes travel through `pty:resize`, not through here.
   */
  cols?: number
  rows?: number
  /** command line typed into the shell right after start (agent tabs); empty for plain shells */
  initialCommand?: string
  /** extra env for this terminal, e.g. CLAUDE_CONFIG_DIR */
  env?: Record<string, string>
  /** agent tabs opt into the idle-sleep policy */
  sleepable?: boolean
}

/**
 * How the third-party CLI that writes the draft commit message is launched. Not the same thing
 * as `CommitMessageConfig`: that one is the setting out of state.json (the agent, the prompt),
 * while this is the finished command line the renderer assembled from the settings and the agent.
 */
export interface CommitDraftConfig {
  command: string
  args: string[]
  env: Record<string, string>
  prompt: string
  timeoutMs?: number
}

/** the agent's warmed-up service session: one for the whole application */
export interface ServiceConfig {
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
}
