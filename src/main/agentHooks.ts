/**
 * What a tab's CLI says about itself. Two questions, one channel, and both CLIs answer them.
 *
 * **Which conversation is it in.** A claude tab starts `claude --session-id <uuid>` and
 * remembers that uuid, but `/clear` abandons the conversation and the CLI opens a new one with
 * an id of its own; a codex tab is never told an id at all and only ever learns the one codex
 * picked. Neither can be found by looking at the store — nothing in a conversation file says
 * which pty wrote it, so two tabs in one directory are indistinguishable there.
 *
 * **Has it finished, or has one of its subagents.** This one is claude's alone — a codex tab has
 * never rung here. Neither store can tell the two apart: a Task subagent's turn is written into
 * the same claude conversation file and ends with the same `stop_reason: end_turn` as the main
 * agent's, so a finished «Teammate @plan-B» rang the bell while the main agent was still
 * working.
 *
 * **Is it blocked on a person, and can the window answer for them.** Claude's alone again. A
 * permission prompt is offered to the window through the `PermissionRequest` hook while the
 * terminal shows the same prompt; whichever answer comes first is the one the CLI takes. See
 * `PERMISSION_PROGRAM`.
 *
 * All of these can only come from the CLI itself, and each CLI has exactly one way of saying
 * them:
 *
 * - **claude** — hooks. The app writes a settings overlay of its own and passes it as
 *   `--settings`; its hooks copy their stdin into `<reports>/`. `Stop` fires for the main agent
 *   alone, so a subagent cannot ring.
 * - **codex** — the `notify` program, passed as `-c notify=["…"]` and handed one JSON object as
 *   its **first argument**. Codex has hooks too, but they sit behind a trust gate, and its own
 *   event list has neither a `Stop` nor a `Notification`. Its one call, `agent-turn-complete`,
 *   names the thread; only that is read, because a codex turn has never rung here and a bell for
 *   it is a change of its own. The call **also fires for a finished subagent** (observed live),
 *   and such a payload names somebody else's thread — so the parser refuses it, or the tab would
 *   follow a subagent into a conversation that is not its own. See `parseNotifyReport`.
 *
 * Neither is ever merged into the user's own configuration: both must apply to the CLIs this
 * app starts and to nothing else, or a `claude` or `codex` the user runs by hand in the same
 * directory would be taken for a tab.
 *
 * The tab is named by CLAUDE_STUDIO_SESSION, which `pty.ts` already puts into the tab's
 * environment; the directory to write into by CLAUDE_STUDIO_HOOK_DIR, put there next to it.
 * A hook or a notify process inherits both.
 *
 * Everything here degrades to silence: no overlay, no hook, no notify program, an unreadable or
 * nonsensical report all mean «nothing was reported», which is exactly how the app behaved
 * before any of this.
 */
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  AgentHookPaths,
  AgentHookReport,
  AgentSessionReport,
  PermissionAnswer,
  PermissionAsk,
} from '../shared/types'
import { toolConfigPath } from './agentTools'

/** everything this feature owns lives under one directory of its own inside userData */
const DIR_NAME = 'agent-hooks'

function baseDir(): string {
  return join(app.getPath('userData'), DIR_NAME)
}

function settingsPath(): string {
  return join(baseDir(), 'settings.json')
}

/** the program a codex tab is started with; a file rather than a line, because codex runs it */
function notifyPath(): string {
  return join(baseDir(), 'codex-notify.sh')
}

/** the program a claude tab's `PermissionRequest` hook runs; a file, because it is a loop */
function permissionPath(): string {
  return join(baseDir(), 'permission.sh')
}

/** the directory the hooks write into; handed to every pty as CLAUDE_STUDIO_HOOK_DIR */
export function reportsDir(): string {
  return join(baseDir(), 'reports')
}

/**
 * The kinds of file a tab leaves behind, all named after the terminal so that a report can never
 * be applied to the wrong tab.
 *
 * `<id>.json` is **state**: which conversation the CLI is in, rewritten by claude on every start
 * and by codex at the end of every turn — the only two moments either of them names it. It is
 * the whole of what a codex tab leaves behind.
 * `<id>.stop.<seconds>.<pid>` and `<id>.note.<seconds>.<pid>` are **events**, and claude's alone:
 * one file per occurrence, deleted as it is read. A single rewritten file would collapse two
 * events that fell inside one poll interval into one bell; a file each cannot, whatever the
 * interval turns out to be. The name only has to be unique — nothing parses it.
 *
 * The two kinds of event stay apart on disk because they are not the same thing: a `Stop` ends a
 * turn, a `Notification` interrupts one. Only the renderer knows what to do with that, so main
 * does not fold them together.
 */
function sessionPath(terminalId: string): string {
  return join(reportsDir(), `${terminalId}.json`)
}

const EVENT_KINDS = {
  Stop: 'stop',
  Notification: 'note',
} as const

type EventName = keyof typeof EVENT_KINDS

function eventPrefix(terminalId: string, event: EventName): string {
  return `${terminalId}.${EVENT_KINDS[event]}.`
}

/**
 * The third kind of file, and a state again: `<id>.ask.<n>` is a permission prompt the CLI is
 * holding open, written by the hook that is still waiting on it, and `<id>.answer.<n>` is the
 * window's answer to it. `<n>` is `<seconds>.<hook pid>` — unique, and ordered by time first.
 */
const ASK_ID = /^\d+\.\d+$/

function askPrefix(terminalId: string): string {
  return `${terminalId}.ask.`
}

function answerPath(terminalId: string, askId: string): string {
  return join(reportsDir(), `${terminalId}.answer.${askId}`)
}

/**
 * The half every hook shares: work out which tab this is and where to leave the answer, then
 * take stdin into a temp file. The rename that follows is what publishes it, so a reader never
 * sees half a file.
 *
 * A hook that errors is silent — nobody is told and nothing retries — so this has to be too
 * simple to fail: missing variables are an exit rather than an error, a failed write takes its
 * temp file with it, and the exit status is always zero. Nothing is ever printed, because what a
 * SessionStart hook writes to stdout is handed to the agent as context.
 */
const PROLOGUE =
  'd=$CLAUDE_STUDIO_HOOK_DIR; s=$CLAUDE_STUDIO_SESSION; ' +
  '[ -n "$d" ] && [ -n "$s" ] || exit 0; t="$d/$s.$$.tmp"; ' +
  'cat > "$t" || { rm -f "$t"; exit 0; }; '

/** `dest` is a shell word evaluated by the hook — the name the temp file is published under */
function hookCommand(dest: string): string {
  return `sh -c '${PROLOGUE}mv -f "$t" ${dest} || rm -f "$t"; exit 0'`
}

/**
 * How long the permission hook waits for the window, in seconds. The terminal prompt is up the
 * whole time and works as it always did, so this is not how long anything is blocked — only how
 * long a card stays answerable. The CLI's own limit for the hook is set a minute above it, so the
 * hook always ends by itself and never by being killed.
 */
const PERMISSION_WAIT_S = 900

/**
 * The `PermissionRequest` hook. The interactive CLI runs it **alongside** its own prompt rather
 * than before it (2.1.312: the hook is started without being awaited, and the prompt and the
 * hook share one `claim()`, so whichever answers first wins and the other's answer is dropped).
 * That is what makes it safe to wait here: nothing is held up while the hook sleeps.
 *
 * What it does: publish the payload as `<id>.ask.<n>`, then wait for `<id>.answer.<n>` and print
 * it. It stops waiting, printing nothing — which the CLI reads as «no decision» — when:
 *
 * - main withdraws the ask by deleting its file (the turn ended, a newer prompt replaced it);
 * - the wait runs out; the CLI ends it (`TERM`), or the variables or the directory are missing.
 *
 * Nothing is ever decided here. An answer is a file main writes only on a person's click.
 *
 * Two kinds of request are refused at once, before anything is written:
 *
 * - **a subagent's** (`agent_id` is present only then). A background subagent has no prompt of
 *   its own: the CLI awaits its hooks and denies when none decides, so waiting here would hold
 *   it for the whole wait instead of a moment. A foreground one keeps its terminal prompt.
 * - **`AskUserQuestion` and `ExitPlanMode`**: their prompt *is* the answer, and the CLI ignores a
 *   hook's allow for them.
 *
 * Both checks are substring tests on the raw JSON. A false match is harmless — the request falls
 * through to the terminal exactly as it did before this existed — and main checks the same two
 * things again on the parsed payload. `CLAUDE_STUDIO_PERMISSION_WAIT` overrides the wait; it is
 * for the tests, and nothing in the app sets it.
 */
const PERMISSION_PROGRAM = `#!/bin/sh
# Claude Studio — offers a permission prompt to the window. Generated file: it is rewritten on
# every start of the application, so edits here do not survive.
exec 2>/dev/null
d=$CLAUDE_STUDIO_HOOK_DIR; s=$CLAUDE_STUDIO_SESSION
[ -n "$d" ] && [ -n "$s" ] || exit 0
p=$(cat) || exit 0
case $p in
  *'"agent_id"'*|*'"tool_name":"AskUserQuestion"'*|*'"tool_name":"ExitPlanMode"'*) exit 0 ;;
esac
n="$(date +%s).$$"
r="$d/$s.ask.$n"; a="$d/$s.answer.$n"; t="$d/$s.$$.tmp"
printf '%s' "$p" > "$t" || { rm -f "$t"; exit 0; }
mv -f "$t" "$r" || { rm -f "$t"; exit 0; }
trap 'rm -f "$r" "$a"; exit 0' HUP INT TERM
i=0
w=\${CLAUDE_STUDIO_PERMISSION_WAIT:-${PERMISSION_WAIT_S}}
while [ "$i" -lt "$w" ]; do
  if [ -f "$a" ]; then cat "$a"; rm -f "$a" "$r"; exit 0; fi
  [ -f "$r" ] || exit 0
  sleep 1
  i=$((i + 1))
done
rm -f "$r" "$a"
exit 0
`

/** a path as one shell word: the overlay's command line is run by a shell */
function shellWord(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`
}

/**
 * Four events, and deliberately no fifth.
 *
 * `SessionStart` carries the id of the conversation that is beginning, for every source the
 * shipped CLI has — startup, resume, clear, compact. It also fires at plain startup for every
 * tab, which is what makes its absence mean something: a tab that has never reported is a tab
 * whose hooks are not running, and the interface says so rather than falling quiet.
 *
 * `Stop` fires when the main agent has finished responding. `Notification` is what the CLI raises
 * when it wants a person mid-turn, which `Stop` cannot cover: an agent blocked on a prompt has not
 * stopped, and is waiting for exactly one person. **Only a real block is asked for** — a
 * permission prompt or an MCP elicitation dialog, `NOTIFICATION_MATCHER`. `idle_prompt`, which
 * the CLI raises about a minute after any finished turn, is not one: the agent is not blocked, and
 * it used to ring a second time for a turn the person had already looked at.
 *
 * `PermissionRequest` fires the moment a prompt appears (the `permission_prompt` notification
 * waits ~6 s and is put off by every keystroke), and it is the one hook whose output is read —
 * see `PERMISSION_PROGRAM`. It does not ring: the notification still does that.
 *
 * **`SubagentStop` is not registered on purpose.** It is the event this feature exists to be rid
 * of; asking for it and then remembering to ignore it is only a way to get it wrong later.
 * `SessionEnd` is left out for the same reason — it would add a writer and answer nothing.
 */
export const NOTIFICATION_MATCHER = 'permission_prompt|elicitation_dialog|elicitation_url_dialog'

function overlay(permissionProgram: string): unknown {
  return {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: hookCommand('"$d/$s.json"') }] }],
      Stop: [{ hooks: [{ type: 'command', command: hookCommand('"$d/$s.stop.$(date +%s).$$"') }] }],
      Notification: [
        {
          matcher: NOTIFICATION_MATCHER,
          hooks: [{ type: 'command', command: hookCommand('"$d/$s.note.$(date +%s).$$"') }],
        },
      ],
      PermissionRequest: [
        {
          hooks: [{ type: 'command', command: `sh ${shellWord(permissionProgram)}`, timeout: PERMISSION_WAIT_S + 60 }],
        },
      ],
    },
  }
}

/**
 * The codex half of the same discipline, and the same guarantees: too simple to fail, silent
 * whatever happens, exit zero. Two differences from a hook, both forced by codex:
 *
 * - the payload arrives as **the first argument**, not on stdin;
 * - it is a file on disk rather than a line in a config, because `notify` is a program codex
 *   executes, so it is written `+x` and starts with a `#!`.
 *
 * It writes **one** file, the conversation state. Codex's only call is «a turn has ended», and a
 * finished codex turn has never rung in this application — the bell is claude's, and giving one
 * to codex is a change of its own, not part of learning the id.
 *
 * `exec 2>/dev/null` is the first line because everything after it may fail — an unwritable
 * directory, a vanished report directory — and codex neither reports nor retries a notify
 * program that complained.
 */
const NOTIFY_PROGRAM = `#!/bin/sh
exec 2>/dev/null
d=$CLAUDE_STUDIO_HOOK_DIR; s=$CLAUDE_STUDIO_SESSION
[ -n "$d" ] && [ -n "$s" ] && [ -n "$1" ] || exit 0
t="$d/$s.$$.tmp"
printf '%s' "$1" > "$t" || { rm -f "$t"; exit 0; }
mv -f "$t" "$d/$s.json" || rm -f "$t"
exit 0
`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A terminal id is a `crypto.randomUUID()` and it is used as a file name. Checking it is not
 * about ids the app generates — it is about the id being a name and nothing else: a `..` or a
 * separator arriving here would read and delete files outside the reports directory.
 */
export function isTerminalId(id: string): boolean {
  return UUID.test(id)
}

/** a report is a file written by somebody else's process: an object, or nothing we understand */
function objectOf(raw: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null // a truncated or empty file: the writer is mid-write, or wrote nothing at all
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  return parsed as Record<string, unknown>
}

/** the fields every claude payload shares, as far as they can be trusted */
function payloadOf(raw: string, event: string): Record<string, unknown> | null {
  const payload = objectOf(raw)
  if (!payload) return null
  if (payload.hook_event_name !== event) return null
  if (typeof payload.session_id !== 'string' || !UUID.test(payload.session_id)) return null
  return payload
}

/**
 * One SessionStart report, as far as it can be trusted.
 *
 * What is checked: the payload is an object, it is a SessionStart (a file left by another event
 * must not rebind anything), `session_id` is a uuid, and `transcript_path` is the conversation
 * file of that very id. The last one is a cross-check, not a lookup: a payload whose two halves
 * disagree is not a payload we understand.
 *
 * What is deliberately not checked: that this pty is what created the conversation — nothing in
 * the payload or in the conversation file records that, which is the whole reason the CLI is
 * asked instead of the store; and `cwd`, because the agent may legitimately have been asked to
 * work somewhere else. The tie to a tab is the file's name alone, and the file is only ever
 * written by a process that inherited that tab's CLAUDE_STUDIO_SESSION.
 */
export function parseSessionReport(raw: string): AgentSessionReport | null {
  const payload = payloadOf(raw, 'SessionStart')
  if (!payload) return null
  const sessionId = payload.session_id as string
  const transcriptPath = payload.transcript_path
  if (typeof transcriptPath !== 'string' || basename(transcriptPath) !== `${sessionId}.jsonl`) return null
  return { sessionId, transcriptPath }
}

/**
 * One codex notify payload, as far as it can be trusted. Only one thing is taken from it: the
 * thread it names is the conversation the tab is in. That a turn ended is not acted on.
 *
 * What is checked, and why each one matters:
 *
 * - `type` is `agent-turn-complete` — the only kind of call this app understands.
 * - `thread-id` is a uuid. It is stored, resumed with and used as an argument, and a thread id
 *   is the whole of codex's answer to «which conversation».
 * - **`client` is a non-empty string.** This is the subagent filter, and it is not a guess:
 *   a real session driven through a pty called this program once per finished **subagent** as
 *   well, and with two subagents their calls arrived four and two seconds *before* the tab's.
 *   Those payloads carry no `client` and empty `input-messages`; the tab's own carries
 *   `client: "codex-tui"`. Without the check the last writer would win and the tab would rebind
 *   to a subagent's thread — resuming and naming itself from a conversation that is not its own.
 *   Filtering by thread instead is not possible: the tab learns its thread from the first call
 *   it accepts, and the first call to arrive can be a subagent's.
 *
 * Any `client` is taken rather than `codex-tui` alone: what matters is that a front-end owns
 * this conversation, and a subagent has none. `turn-id`, `cwd`, `input-messages` and
 * `last-assistant-message` are all present and none is read — `last-assistant-message` is the
 * agent's own words, and main writes no interface copy.
 */
export function parseNotifyReport(raw: string): AgentSessionReport | null {
  const payload = objectOf(raw)
  if (!payload) return null
  if (payload.type !== 'agent-turn-complete') return null
  const threadId = payload['thread-id']
  if (typeof threadId !== 'string' || !UUID.test(threadId)) return null
  if (typeof payload.client !== 'string' || payload.client === '') return null
  return { sessionId: threadId }
}

/**
 * Is this file the event it was filed under?
 *
 * Neither payload is read for anything — that one exists is the whole message — so this only
 * establishes that the file is one of ours: the right event, from a real conversation. Which
 * conversation is deliberately not compared against the tab's own id: a `/clear` and the turn
 * that follows it can land inside one poll, and the tab is rebound from the state report rather
 * than from here. A `Notification`'s `message` is not read either — it is the CLI's own wording,
 * and main writes no interface copy.
 *
 * Only claude writes events. Codex's notify program leaves state and nothing else, so a codex
 * tab's counts are zero on every poll, exactly as they were before it reported anything at all.
 */
export function isEventReport(raw: string, event: 'Stop' | 'Notification'): boolean {
  return payloadOf(raw, event) !== null
}

/** what a tool would act on, for the card: the first of the fields the CLI's own tools use */
const DETAIL_FIELDS = ['command', 'file_path', 'notebook_path', 'url', 'path', 'pattern', 'query'] as const
const DETAIL_MAX = 300

/** tools whose prompt is itself the answer; the CLI ignores a hook's allow for them */
const PROMPT_IS_ANSWER = new Set(['AskUserQuestion', 'ExitPlanMode'])

/**
 * One `PermissionRequest` payload, as far as the window may offer it to a person. Null means
 * «leave it to the terminal», and main withdraws the ask so that the hook stops waiting.
 *
 * Refused besides what every payload is checked for: a subagent's request (`agent_id`), a tool
 * whose prompt is the answer, and a payload without a tool name or input — there would be
 * nothing to show the person, and a card that says nothing must not be clickable.
 *
 * The detail is the tool's own input, verbatim but with whitespace folded and clipped: it is what
 * the person is deciding about, and the terminal prompt shows the same text.
 */
export function parsePermissionRequest(raw: string): Omit<PermissionAsk, 'id'> | null {
  const payload = payloadOf(raw, 'PermissionRequest')
  if (!payload) return null
  if (payload.agent_id !== undefined) return null
  const tool = payload.tool_name
  if (typeof tool !== 'string' || tool === '' || PROMPT_IS_ANSWER.has(tool)) return null
  const input = payload.tool_input
  if (typeof input !== 'object' || input === null) return null
  const fields = input as Record<string, unknown>
  let detail: string | null = null
  for (const field of DETAIL_FIELDS) {
    const value = fields[field]
    if (typeof value === 'string' && value.trim() !== '') {
      const folded = value.replace(/\s+/g, ' ').trim()
      detail = folded.length > DETAIL_MAX ? folded.slice(0, DETAIL_MAX - 1) + '…' : folded
      break
    }
  }
  return { tool, detail }
}

/** what the hook prints for an answer: the CLI's own `PermissionRequest` output shape */
export function permissionOutput(answer: PermissionAnswer): string {
  const decision =
    answer === 'allow'
      ? { behavior: 'allow' }
      : // read by the agent, not by a person: it is told why the call did not run
        { behavior: 'deny', message: 'The user denied this permission request from the Claude Studio window.' }
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } })
}

/**
 * The paths of both, or null when they could not be written. Prepared once: neither file changes
 * while the app runs, and the renderer asks for the paths on every start of a tab.
 */
let prepared: Promise<AgentHookPaths | null> | null = null

export function hookPaths(): Promise<AgentHookPaths | null> {
  prepared ??= prepare()
  return prepared
}

async function prepare(): Promise<AgentHookPaths | null> {
  try {
    await fs.mkdir(reportsDir(), { recursive: true })
    await sweep()
    // run as `sh <path>`, so it needs no bit; written before the overlay that names it
    await fs.writeFile(permissionPath(), PERMISSION_PROGRAM, 'utf8')
    await fs.writeFile(settingsPath(), JSON.stringify(overlay(permissionPath()), null, 2), 'utf8')
    // codex runs this one, so it has to carry the bit that says it may be run
    await fs.writeFile(notifyPath(), NOTIFY_PROGRAM, { encoding: 'utf8', mode: 0o755 })
    await fs.chmod(notifyPath(), 0o755) // an existing file keeps its own mode: the write above does not set it
    // the other half of what a claude tab is started with: the tool it opens a session through
    // (`agentTools`). It is prepared separately and may fail separately — a tab without the tool
    // still reports, and a tab whose hooks are missing is not deprived of the tool as well
    const mcp = await toolConfigPath()
    return { settings: settingsPath(), notify: notifyPath(), ...(mcp ? { mcp } : {}) }
  } catch {
    // an unwritable userData: no overlay, no notify program, and every tab behaves as before
    return null
  }
}

/** every entry of the reports directory whose name begins with `prefix` */
async function matching(prefix: string): Promise<string[]> {
  try {
    return (await fs.readdir(reportsDir())).filter((name) => name.startsWith(prefix))
  } catch {
    return [] // the directory was never created, or has gone away under us
  }
}

async function remove(names: string[]): Promise<void> {
  await Promise.all(names.map((name) => fs.rm(join(reportsDir(), name), { force: true }).catch(() => undefined)))
}

/**
 * At startup no tab has a process yet, so every report still on disk was left by one that is
 * gone. Without this the directory would keep a file per terminal id ever used — and terminal
 * ids survive restarts, so a stale one could be read as if it had just been written, and every
 * unconsumed event of the previous run would ring.
 */
async function sweep(): Promise<void> {
  await remove(await matching(''))
}

/**
 * What the tab has said since the last time it was asked.
 *
 * **The read consumes the events**: each file is deleted as it is counted, which is what makes
 * one of them ring exactly once however long the interval between two polls turns out to be.
 * The caller has to act on what it gets — a discarded answer is a lost bell.
 *
 * For a claude tab `session` doubles as the answer to «are this tab's hooks running at all»:
 * SessionStart fires for every tab at startup, so a live tab that has never reported one is a
 * tab nothing will ever ring for. Since the transcript fallback is gone, the interface has to say
 * so. A codex tab says nothing until its first turn ends, and it has no bell to lose either way,
 * so its silence answers no such question — see `useWaitingPoll`.
 */
export async function takeHookReport(terminalId: string): Promise<AgentHookReport> {
  if (!isTerminalId(terminalId)) return { session: null, stops: 0, notifications: 0, permission: null }
  const session = await readSession(terminalId)
  const stops = await takeEvents(terminalId, 'Stop')
  const notifications = await takeEvents(terminalId, 'Notification')
  // a finished turn has no prompt left open: whatever ask is still on disk was answered in the
  // terminal, and its hook is told to stop waiting
  const permission = stops > 0 ? await withdrawAsks(terminalId) : await readAsk(terminalId)
  return { session, stops, notifications, permission }
}

/** the asks of one tab, oldest first: the name sorts by seconds, then by pid */
async function askNames(terminalId: string): Promise<{ name: string; id: string }[]> {
  const prefix = askPrefix(terminalId)
  const order = (id: string): [number, number] => {
    const [sec = 0, pid = 0] = id.split('.').map(Number)
    return [sec, pid]
  }
  return (await matching(prefix))
    .map((name) => ({ name, id: name.slice(prefix.length) }))
    .filter((a) => ASK_ID.test(a.id))
    .sort((a, b) => {
      const [as, ap] = order(a.id)
      const [bs, bp] = order(b.id)
      return as - bs || ap - bp
    })
}

async function withdrawAsks(terminalId: string): Promise<null> {
  await remove((await askNames(terminalId)).map((a) => a.name))
  return null
}

/**
 * The prompt this tab is holding open, if it offered one.
 *
 * **Only the newest is kept.** The terminal shows one prompt at a time, and a prompt answered
 * there leaves its hook waiting — nothing tells the hook — so an older ask is, almost always, one
 * the person has already answered. Offering it would be a button that does nothing: the CLI drops
 * an answer to a prompt that is already settled. So an older one is withdrawn, and its hook ends.
 * An ask the window must not offer (`parsePermissionRequest` says null) is withdrawn the same way.
 */
async function readAsk(terminalId: string): Promise<PermissionAsk | null> {
  const asks = await askNames(terminalId)
  const newest = asks.pop()
  await remove(asks.map((a) => a.name))
  if (!newest) return null
  let raw: string
  try {
    raw = await fs.readFile(join(reportsDir(), newest.name), 'utf8')
  } catch {
    return null // answered, withdrawn or timed out between the listing and the read
  }
  const parsed = parsePermissionRequest(raw)
  if (!parsed) {
    await remove([newest.name])
    return null
  }
  return { id: newest.id, ...parsed }
}

/**
 * The person's answer to one ask. True when it was delivered to a hook still waiting for it;
 * false when there was nothing to deliver it to — the ask is gone, or it was answered already.
 *
 * **One answer per ask, whoever clicks.** The answer is published with `link`, which refuses to
 * replace an existing file, so a second click cannot change the first one. Whether the CLI takes
 * it is the CLI's call: if the person answered in the terminal first, the hook's answer is
 * dropped there, and nothing runs twice.
 */
export async function answerPermission(terminalId: string, askId: string, answer: PermissionAnswer): Promise<boolean> {
  if (!isTerminalId(terminalId) || !ASK_ID.test(askId)) return false
  if (answer !== 'allow' && answer !== 'deny') return false
  try {
    await fs.access(join(reportsDir(), `${askPrefix(terminalId)}${askId}`))
  } catch {
    return false
  }
  const target = answerPath(terminalId, askId)
  const temp = `${target}.${process.pid}.tmp`
  try {
    await fs.writeFile(temp, permissionOutput(answer), 'utf8')
    await fs.link(temp, target)
    return true
  } catch {
    return false // already answered, or the directory went away under us
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined)
  }
}

/**
 * Whichever CLI wrote the state file, the answer is the same shape. Which one wrote it is not
 * worth knowing: the file is named after the tab, and a tab runs one CLI.
 *
 * A codex tab rewrites this file at the end of every turn, including the turns of its subagents
 * — the program cannot tell them apart, and teaching a line of `sh` to parse JSON to find out
 * would be a second, worse parser. So a subagent's payload can sit here, and it reads as null,
 * exactly as a half-written or corrupt one does. Null is the right answer to it: the tab keeps
 * the id it already has instead of following a subagent, and the next turn of the main agent
 * overwrites the file.
 */
async function readSession(terminalId: string): Promise<AgentSessionReport | null> {
  let raw: string
  try {
    raw = await fs.readFile(sessionPath(terminalId), 'utf8')
  } catch {
    return null // nothing has reported for this tab: reporting is off, or no turn has ended yet
  }
  return parseSessionReport(raw) ?? parseNotifyReport(raw)
}

async function takeEvents(terminalId: string, event: EventName): Promise<number> {
  let count = 0
  for (const name of await matching(eventPrefix(terminalId, event))) {
    const full = join(reportsDir(), name)
    let raw: string
    try {
      raw = await fs.readFile(full, 'utf8')
    } catch {
      continue
    }
    // deleted whatever it turned out to contain: a file left behind would be read again on every
    // poll from now on, and a file that made no sense is not going to start making sense
    await fs.rm(full, { force: true }).catch(() => undefined)
    if (isEventReport(raw, event)) count += 1
  }
  return count
}

/**
 * The tab's process is gone, so nothing it said is about anything any more. Called from
 * `kill()`, which is every path that retires a pty — closing a tab, putting it to sleep, quitting.
 */
export function clearReports(terminalId: string): void {
  if (!isTerminalId(terminalId)) return
  // `<id>.` covers the session report, every unconsumed event and any temp file a hook died over
  void matching(`${terminalId}.`).then(remove)
}
