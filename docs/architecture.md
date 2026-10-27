# Architecture

How the application is built right now. Why it is built this way — in [decisions.md](decisions.md);
what is still undecided — in [open-questions.md](open-questions.md).

## What this is

A desktop application for working with several agents (Claude Code, Codex) in parallel
in one repository. The levels of nesting: **project** (a top-level tab) → **session**
(lives in its own git worktree) → **tab** (an agent, a shell, a file, a diff, a merge).

Stack: Electron 43, React 19, TypeScript 7, electron-vite. Terminals are xterm.js with the
WebGL renderer, the PTY is node-pty, the editor is CodeMirror 6, git is direct `execFile`
calls without wrapper libraries.

## Source layout

```
src/main/       window, IPC, git, pty, files, agent stores, service session
src/main/git/   the git layer by module; the single import point is src/main/git.ts
src/preload/    contextBridge → window.api
src/renderer/   React: tabs, panels, editor, diffs, merge, settings
src/shared/     shared types, which are also the IPC contract
tests/          unit tests (vitest): parsers and state.json
tools/          cpuwatch.sh — a recorder of load spikes
```

Startup: `./claude-studio.sh` (it will build if needed), flags `--dev`, `--stop`, `--logs`.

## The process boundary

Three processes — three separate TypeScript projects, and the boundary between them is
enforced, not merely observed:

| project              | what it covers                                                  | `lib`        | `types`       |
| -------------------- | --------------------------------------------------------------- | ------------ | ------------- |
| `tsconfig.node.json` | `src/main`, `src/preload`, `src/shared`, `tests`, build configs | ES2022       | `node`        |
| `tsconfig.web.json`  | `src/renderer`, `src/shared`                                    | ES2022 + DOM | `vite/client` |

The root `tsconfig.json` is a solution file, it only references those two; the shared flags
live in `tsconfig.base.json`. `npm run typecheck` is `tsc -b`.

What this buys in practice: `document` in main does not compile, `node:fs` in a component does
not compile. Both used to pass, because a single tsconfig handed main, preload and the
renderer the same `lib` and `types`.

The second line of defence is eslint: DOM global names are forbidden in `src/main`, and
`node:*` and `electron` imports in `src/renderer`. Preload deliberately sees both sides: it is the seam.

Path aliases are declared **twice** — in `tsconfig.base.json` (`paths`) and in
`electron.vite.config.ts` (`resolve.alias`). One is not enough: the first only teaches the
compiler, the second only the bundler.

| alias         | where                | available from          |
| ------------- | -------------------- | ----------------------- |
| `@shared/*`   | `src/shared/*`       | main, preload, renderer |
| `@main/*`     | `src/main/*`         | main, preload           |
| `@renderer/*` | `src/renderer/src/*` | renderer                |

## Terminals and PTY

PTYs are addressed by `terminalId` and live in main. `pty:start` is idempotent: it returns the
accumulated buffer and `seq`, and the renderer drops the events it has already replayed. That
is why switching tabs and reloading the window do not double the output.

The scrollback is kept as an array of chunks (it is not rewritten whole on every chunk), and
for finished tabs it is trimmed down to the tail. The buffer itself is `src/main/scrollback.ts`
— appending with its length limit, the tail trim, and dropping the lot.

How much is kept is one setting, `settings.terminal.scrollbackLines`: a number of lines, or
`null` for no limit, which is the default. It drives both halves of the history. The pane passes
it to xterm as it stands (`null` becomes xterm's own maximum, 4 294 967 295) and pushes a change
into the live instance through `term.options.scrollback`, without touching the pty. Main's buffer
counts characters, so `pty:scrollbackLimit` carries the same number of lines and
`charLimitForLines` converts it at a stated, generous 200 characters per line — the two limits
count different things and no exact rate exists. Lowering the limit trims what is already
buffered; raising it applies from that moment on. The whole history lives in memory only, in
those two copies, and is not written to disk.

«Clear the history» in the tab's right-click menu wipes both copies of the text: the pane clears
its own xterm instance with `term.clear()` (the line the cursor is on stays, what is above goes),
and `pty:clearScrollback` drops main's replay buffer, without which the next attach would paint
it all back. `seq` and the output already in flight are left alone. The command travels into the
pane as `clearSeq`, a counter the pane watches; a sleeping tab has neither a pane nor a buffer
and is not offered the item.

Pasting goes through `term.paste`: xterm wraps the text in a bracketed paste itself when the
mode has been turned on by the application. The browser's own paste path (`Ctrl+Shift+V`,
`Shift+Insert`, middle button) is suppressed, otherwise the text arrives twice.

## Conversation identity

A conversation belongs to a **tab**, not to a directory: two tabs in one worktree do not hook
onto the same conversation.

|        | start                 | continuation      | picker     |
| ------ | --------------------- | ----------------- | ---------- |
| Claude | `--session-id <uuid>` | `--resume <uuid>` | `--resume` |
| Codex  | assigns the id itself | `resume <id>`     | `resume`   |

For Claude the application issues the UUID. Codex is never told one and reports the thread it
picked when its first turn ends — so a codex tab has no id until it has answered once, and a tab
restarted before that starts a new thread. Codex's own index
(`$CODEX_HOME/state_<n>.sqlite`, table `threads`, strictly `readOnly`) is still read, but only
for what a conversation is called and whether it exists — never to guess which one a tab is in.

Substituting `{session}` and `{name}` into the arguments — `src/renderer/src/lib/agents.ts`;
reading other tools' stores — `src/main/agentSessions.ts`.

Whether to resume or to start over is decided by the **agent's store**, not by a "has been
launched already" flag: before a launch the presence of the conversation is checked — if it is
there, `--resume`, if it is not, a clean start with the same id. The tab additionally
recognises `No conversation found` and `Session ID is already in use` in the first seconds of
output and restarts in the correct mode.

The tab name is taken from `ai-title` in the conversation file, then from the user's first
message, then from the manual name. The terminal title (OSC 0/2) is the source of last resort:
the real Claude does not set it, and product captions like «Claude Code» are discarded.

The conversation file is looked up **by name across all profiles** `~/.claude*` rather than
assembled from the path: the directory slug is irreversible (`/` and `.` both collapse into
`-`). A tab remembers the `configDir` of its conversation and launches with that
`CLAUDE_CONFIG_DIR`.

### What the CLI reports about itself

Three things cannot be worked out from the outside, and each CLI is asked through the one channel
it has — `src/main/agentHooks.ts`. Both answer in the same shape, so the renderer has one code
path. Codex answers the first question only; the other two are claude's, and a codex tab has
never rung here.

**Which conversation the tab is in.** The UUID is ours only until the user types `/clear`: the
CLI abandons that conversation and opens one with an id of its own. A tab that kept the old id
shows a stale name and, on the next start, resumes an abandoned, nearly empty conversation. The
new id can only come from the CLI — nothing inside a conversation file records which pty wrote
it, so two tabs in one directory are indistinguishable in the store.

**Whether it has finished, or one of its subagents has.** Claude only. The conversation file
cannot tell them apart: a Task subagent writes into the same file and its turn ends with the same
`stop_reason: end_turn`. `Stop` fires for the main agent alone. There is no second way to find
this out — the transcript read is gone, not kept as a fallback.

**Whether it wants a person mid-turn.** Claude only, again. A permission prompt, or an agent left
idle, is not the end of a turn: `Stop` never fires, and the record shows nothing. `Notification` is
what the CLI raises for it. Codex has nothing of the kind a tab of ours can hear — its
`permission_request` is a hook, and hooks there sit behind a trust gate we do not open — and
**a codex tab rings no more than it ever did, which is not at all**.

The mechanism is one directory, `<userData>/agent-hooks/`, and two ways in:

| agent   | started with              | how the payload arrives         | what it reports         |
| ------- | ------------------------- | ------------------------------- | ----------------------- |
| `uuid`  | `--settings <overlay>`    | hooks, on stdin                 | conversation and events |
| `codex` | `-c notify=["<program>"]` | one JSON object, as argument #1 | the conversation, only  |

Both write into `<userData>/agent-hooks/reports/`, addressed by `CLAUDE_STUDIO_SESSION` and
`CLAUDE_STUDIO_HOOK_DIR` — put into the pty's environment by `src/main/pty.ts` and inherited by
the hook or notify process. Neither is ever merged into the user's own configuration
(`settings.json`, `~/.codex/config.toml`): they must apply to the CLIs this application starts and
to nothing else, or a `claude` or `codex` run by hand in the same directory would be taken for a
tab. The `-c` value is TOML inside a shell word, so the path is escaped for both.

| file                          | what it is                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `<terminal id>.json`          | state: the conversation — claude rewrites it at every start, codex at every turn end. All a codex tab ever leaves |
| `<terminal id>.stop.<unique>` | a claude event: a finished turn, one file each, deleted as it is read                                             |
| `<terminal id>.note.<unique>` | a claude event: the CLI asking for a person, one file each, likewise                                              |

Only `SessionStart`, `Stop` and `Notification` are registered. **`SubagentStop` deliberately is
not** — it is the event this exists to be rid of, and asking for it only to ignore it is a way to
get it wrong later. The two kinds of event stay apart on disk and in the report: only the renderer
knows that one of them ends a turn and the other interrupts it. The notify program writes no event
at all: codex's one call says a turn has ended, and turning that into a bell is a change of its
own, not part of learning the id.

`useWaitingPoll` takes the report on the pass it already makes over every live tab:

- a reported id that differs from the tab's dispatches `agentSessionCaptured` — `compact` fires
  `SessionStart` too, so what counts is the id changing, not the source;
- every event rings once. Events are separate files precisely so that two of them inside one poll
  interval cannot collapse into one bell, and the read deletes them, so none rings twice;
- only a finished turn re-reads the conversation's name; a call for attention does not end a turn.

A claude report is accepted only if it is the event it claims to be and `session_id` is a UUID; a
`SessionStart` must additionally point at that id's own transcript. A codex report is accepted only
if `type` is `agent-turn-complete`, `thread-id` is a UUID and **`client` is a non-empty string** —
that last one is the subagent filter, and it is about the id, not about a bell: codex calls the
program for a finished subagent too, that payload names the subagent's own thread, and the last
writer wins the state file. Without the check a tab would rebind to a subagent's thread and resume
a conversation that is not its own. Filtering by thread instead is impossible — the tab learns its
thread from the first call it accepts, and the first call to arrive can be a subagent's.
`last-assistant-message` and a `Notification`'s `message` are never read — they are the CLI's own
wording, and main writes no interface copy. Everything a tab
left is removed with its pty (`kill()`), and the whole directory is swept at startup.

### A tab that cannot report says so

With nothing to fall back on, a CLI whose hooks are off would simply stop ringing and nothing
would explain why. `SessionStart` fires for every tab at startup, so its absence is the signal:
a tab awake for 20 s that has still returned no report is marked in
`TerminalRuntimeState.silent`, and the tab strip draws a faint `⊘` whose tooltip names the likely
causes (`--bare`, hooks disabled in the CLI's own settings).

The measure is **time awake**, not "has produced output": output reaches the renderer only
through a mounted pane, and a pane exists only for the session on screen, so a tab in a
background session would never qualify. Twenty seconds because the shell, the rc files and the
CLI's own start all fit inside it, and a badge that flashes at every start is one people learn to
ignore. Only `uuid` agents are marked: codex says nothing until its first turn ends, so silence
there means «has not answered yet» at least as often as «cannot report»; the badge would sit on
every codex tab for as long as it was thinking, and its sentence — «nothing will tell you when it
finishes» — is about a bell a codex tab has never had.

### What the agent says it is doing

The hooks report **events**; the dot on a tab is a **state**, and it comes from a different place.
A running claude keeps a file about itself, `<profile>/sessions/<pid>.json`, rewritten whenever its
state changes and removed when the process exits, carrying `status: busy | shell | idle | waiting`.
`agentSessions.agentActivity(sessionId, configDir?)` reads it in main; `useWaitingPoll` asks for it
on the pass it already makes over every live tab, so there is one more call per tab every 4 s and
no second timer.

**The match is by conversation id, never by pid** — our pty runs `$SHELL -i` and the agent is a
grandchild of it — so this works only because the tab already follows its id through `/clear`. Every
`~/.claude*` profile is searched, the tab's own first, exactly as `findClaudeConversation` does and
for the same reason. A profile's listing is kept for 1.5 s and a file that has not been rewritten is
not re-read (keyed by path, mtime and size).

`renderer/lib/status.ts` turns it into the dot, and is shared by the tab strip and the session
pulse:

| in order        | why it outranks what follows                                                         |
| --------------- | ------------------------------------------------------------------------------------ |
| `dead`,`asleep` | there is no process, so nothing it said about itself is about anything any more      |
| `attention`     | not about the process: this tab rang and nobody has looked yet                       |
| the state file  | the process's own answer; where it answers, it decides                               |
| `busyIds`       | output in the last few seconds — a shell tab's only answer, and the fallback for all |

`busy` and `shell` are «running» (the CLI's own session list counts both as working), `waiting` is
«waiting» — it is set while the CLI is blocked on a person, and it draws the dot without ringing,
covering the stretch `attention` cannot: that is cleared as soon as the person looks at the tab.

**A tab nothing answers for behaves exactly as it did before.** No file, an unreadable or
half-written one, a status word no version we know writes, a session that simply keeps no file —
all of them are «no answer», and the tab is judged by its output. A file whose process is no longer
alive is ignored: only an orderly exit removes it, and a crashed CLI's frozen `busy` would pin the
tab to «running» for ever. Where one conversation has two files, the newest process wins.

### The same statuses, one and two levels up

The session pulse in the sidebar shows every status its tabs are in, with counts. The project tab
shows the same statuses combined — `projectPulse` in the same file — but only as presence: at most
two dots, in the same colours, no numerals, because several tabs sit side by side in the strip.

Everything active is shown at once and in order, `waiting` before `running`: a project that holds
something calling _and_ something working is two errands, not one. `idle` and `asleep` are not
events, so they get a dot only when nothing is active — the liveliest of them speaks for the rest,
and a project with forty idle tabs and one calling is one amber dot. A project with no tabs at all
gets the sleeping tab's hollow ring: nothing in there is running either.

The words are the pulse's own dictionary keys (`sessions.pulse.*`, one table, `PULSE_LOOK`), they
are what the tooltip says, and they are the tab's `aria-label` — the dots themselves are
`aria-hidden`, or a screen reader would hear the project twice. The dot on a project tab used to
mean «this folder is a git repository»; that has moved to the tooltip, since every project is one
and a light that never changes reads as a status that is always good.

### Project colour

`Project.color` (`PROJECT_COLORS` in `shared/types.ts`) names a token, `--project-<name>`, declared
in both themes. `.app` carries the active project's as `--project`, and each project tab its own as
`--tab-color`; the stylesheets mix them into the top line of the window, the tab caps and a 6 %
tint of the session list and the terminal tab strip. `lib/projectColor` derives a colour from the
path when none was chosen and picks the first free one for a new project.

### A tab's agent can open a session, and owns it

The hooks are the CLI talking about itself; this is the CLI **asking for something**. A claude tab
is started with an MCP server of ours as well — `--mcp-config <userData>/agent-tools/mcp.json`,
written next to the settings overlay by `src/main/agentTools.ts`. `open_session` (`task`, `name`,
`isolate`) becomes an ordinary session in the window: a worktree, a tab, an agent already holding
the task, and the answer names its session id.

That session is the asker's **child**: `Session.parentId`. Three more tools act on the asker's
descendants and nothing else — `list_sessions` (id, branch, conversation id, tab state,
uncommitted files), `send_to_session` (typed into the child's agent tab and submitted; multi-line
text as a bracketed paste) and `close_session`. Closing removes the worktree only when it is clean
and the branch only when it has no commits outside the parent's branch; otherwise it is refused,
and `force` closes the session but keeps both on disk. A child with open children of its own is
refused. The child forks from the parent's branch, and its first prompt opens with a line naming
the parent and its conversation id. Limits: depth 3, 8 open children per session
(`lib/sessionTree`).

The list stays flat in the state; `lib/sessionTree` reads the tree off `parentId`, and an unknown
parent means top level. Rows are indented with a guide line, a parent folds, and a folded parent's
pulse counts its descendants' tabs. Closing a session moves its open children up to its own parent
(`sessionClosed` in the reducer); the closing dialog lists the descendants, ticks the ones with no
uncommitted changes, and closes the ticked ones first.

Only the opening is ours. Claude Code sessions on one machine already reach each other, so nothing
here carries messages between them; what an agent cannot do by itself is make a session visible,
and a subagent has no tab, no branch and no bell.

The path in is the hooks' path: files in one directory, `<userData>/agent-tools/requests/`.

| file              | written by | what it is                                               |
| ----------------- | ---------- | -------------------------------------------------------- |
| `<id>.req.json`   | the server | one request, **taken** by main — read and deleted at once |
| `<id>.reply.json` | main       | the answer, taken by the server and handed to the agent   |

Main watches that directory (`fs.watch`, unreferenced) and sends each request to the renderer as
`agent:toolRequest`; the renderer answers through `agent:toolReply` and main writes the reply file.
The tool call is blocked the whole time, up to 90 s, and a request is deleted as it is emitted —
one call cannot become two sessions, and the call that made it could not tell them apart anyway.

The server is generated CommonJS with nothing but node's own modules, run through our own binary
with `ELECTRON_RUN_AS_NODE=1`: the user's `node` may be absent or be a version manager's shim.
Nothing but protocol messages may reach its stdout — that stream is the transport. It is not
compiled or linted with the rest of the project, so `tests/agentTools.test.ts` starts it as a
process and speaks the protocol to it.

`useAgentToolRequests` is what carries a request out. It decides three things the agent does not:
the project (the tab that asked, or the one on screen when the server could not name its tab — the
environment does not always reach an MCP server), the name and the branch (the new-session window's
own helpers, `lib/sessionDefaults`, so an agent's session is named like a person's), and the agent
to run (claude). The tools that act on a child find the asker by its tab and check the target is
its descendant there, against the state; the request is never trusted with that. The reply is English on purpose: it is read by another CLI, not by a person, so it
is not an `AppMessageCode` and it is not translated.

A tab's pty normally starts when its pane is first mounted, and panes exist only for the session
on screen. A session an agent opened is started by `useAgentToolRequests` itself, with the command
and env the pane would pass (`commandFor`, `envFor`) and no size; the pane that mounts later
re-attaches to the live pty, replays its output and applies the measured size. `started: false` in
the reply means that start failed.

Codex is given none of this: the two CLIs do not share an MCP configuration format on the command
line. Everything degrades to silence as the hooks do — no config, no tool, and the tab starts
exactly as it did before.

## The environment of tabs

`src/main/env.ts` strips out the markers of an agent session (`CLAUDECODE`,
`CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID` and the rest) and `CLAUDE_CONFIG_DIR`:
the profile is set by the agent's settings, not by the shell the application happened to be
started from. Separately, `cleanGitEnv` removes `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` —
they override `-C` and can silently substitute the repository.

## Sleeping tabs

An agent with no activity for N minutes is put out: the pty is killed, the tab greys over, the
id is kept. A click brings the agent back with the continuation arguments. The policy comes
from the settings, the timer lives in main. At application startup you are asked whether to
bring up all of them; the choice is remembered.

A tab can also be sent to sleep by hand, from the right-click menu of its tab — offered for an
agent or a shell tab that is awake. It goes through `pty:sleep`, which kills the process and
emits `pty:slept`, the same two steps in the same order as the timer's own sweep; the renderer
has one event to react to and cannot tell the two apart afterwards.

While a tab sleeps, its pane shows the screen it had when the process was killed, under a bar
that says it is asleep and carries the wake button. The screen is serialised by the pane itself
(`@xterm/addon-serialize`, viewport only) in the cleanup of the effect that owns the terminal —
the last moment it exists, since `kill()` frees main's copy of the scrollback. It is shown in a
second terminal that is attached to nothing, takes no input and hides its cursor. The snapshots
are runtime state next to `awake` (`lib/snapshots.ts`), bounded and never persisted: after a
restart the process is gone and the conversation comes back from the agent's own store.

## The changes panel

The list holds only what **can be committed**: the section «To commit · N» with checkboxes.
There is no comparison mode — one and the same list must not mean "this can be committed" one
moment and "this is already done" the next.

Commits that are already made are looked at in the push window: commits on the left, the files
of the selected one on the right. There is one window and two ways in — the green ↑ arrow in
the header and «Push the current branch» in the branch menu.

The exchange with the server, in the header: **↑N** in green (not pushed), **↓N** in blue (not
pulled), both out of a single `rev-list --left-right --count upstream...HEAD`.

The header is one row: the branch button (which is also the menu), the push state, ↻, collapse.
The worktree path is in the tooltip of the branch button. During an unfinished rebase/merge the
bottom of the panel is taken by the block for that operation («Continue / Skip the commit /
Abort») instead of the commit field.

The list can be shown as a tree grouped by folder (the switch in the «To commit» head,
`layout.changesView`, default `list`). `lib/changesTree.ts` builds it: single-child folder chains
are one row (`src/renderer/src`), folders before files, a rename under its new path. A folder's
checkbox is all / some / none of the files under it (`aria-checked="mixed"` for some) and is
derived from the same `checked` set; clicking it checks them all unless all were checked. File
rows are the same `ChangedFileRow`, showing only the name. Keys on a folder row: Left/Right fold
and unfold (Left on a folded row goes to its parent), Space checks, Enter folds; Up/Down walk
all rows. Folded folders are component state.

### When the panel re-reads

There is no fixed poll. The panel and a visible diff tab re-read on events, through
`hooks/useChangesRefresh` and the bus in `lib/changesRefresh.ts`:

| trigger                                           | where it comes from                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| a claude turn ends, or the CLI calls for a person | `useWaitingPoll`, on the pass it already makes: `changesInvalidated(session.cwd)`                                                     |
| the window gains focus or becomes visible         | `focus` / `visibilitychange`                                                                                                          |
| the app writes                                    | `changesInvalidated(path)` from commit, revert, pull/push, resolve, merge-tab save, and every `useCheckedFile` save (editor and diff) |

An invalidation reaches every view whose directory overlaps the path, either way round. A trigger
that lands during a read asks for one more read after it, never a second one beside it.

What remains is a fallback poll, decided by `fallbackPollMs` from the session's tabs: 10 s while
any awake agent or shell tab is running (to show edits arriving mid-turn), 30 s while an awake tab
cannot report its turn end (codex, a plain shell, a claude tab marked silent), none otherwise.
Sleeping tabs and the app's own editor/diff/merge tabs never keep it alive. An identical status or
repository state keeps the previous object, so an unchanged list is not re-rendered, and the file
tree is handed the change map only when it differs.

A rebase/merge/pull stopping on a conflict is a normal outcome, not an error: git returns a
non-zero code, the panel catches it and writes «Rebase stopped on a conflict…». Red output stays
for real failures.

## The git layer

Every call goes through a single spawn point (`src/main/git/exec.ts`): it sets the buffer
policy, the timeout and the cleaned environment. A neighbouring home-made `execFile` would
inherit `GIT_DIR` from the environment of an agent tab and would redirect the command into
another repository.

The status is parsed in the `-z` format: the fields are separated by NUL, and for renames one
record occupies three fields (code, old path, new path). This is what lets paths contain spaces
and newlines. The functions `mapStatusCode`, `parseNameStatus`, `renameSources` are covered by
tests.

The old paths of staged renames are added to the pathspec separately: `git mv` is a pair of
records in the index, while the panel shows only the new path.

## Files, diffs and merges

These are ordinary session tabs, not overlays: the content takes up the whole terminal area
(`inset: 0` inside `.center-stack`). There is no hand-written offset arithmetic (sidebar width +
tree + changes panel) — in a narrow window it collapsed the block.

A picture is shown rather than read as text. `files:read` answers with `image` — a data URL — for
`png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `bmp` and `ico`, decided by the extension, and the tab
paints it on a chequerboard instead of building CodeMirror at all; there is no save button,
because there is nothing to save. `svg` is deliberately not in that list: it is source, and
showing it would take editing away. The limit is its own, 16 MB against the editable 2 MB — a
screenshot an agent has just taken is the usual case, and a megabyte of PNG is not a megabyte of
text. Before this, a `files:read` of any picture came back `file-binary` and the tab said so.

The editor saves on a pause and when the tab is closed, not only on Ctrl+S. Writing a file is
atomic: a temporary file plus a rename. File operations are limited to the registered roots,
and `openExternal` lets through only http/https.

The editor and the diff's right side share `useCheckedFile`. A visible editor re-reads on the
`useChangesRefresh` triggers: a clean buffer takes the disk's text, a dirty one shows the
conflict, a missing file is marked gone and is never recreated by a keystroke (Overwrite does
that). Every text from disk goes in through `replaceFromDisk`, which drops the undo history, so
Ctrl+Z cannot bring back a buffer the disk replaced. The buffer is compared in LF and written
with the file's own line ending (`lib/lineEndings.ts`). Closing a tab goes through
`TerminalArea.requestClose`: unsaved edits with autosave off, a conflict, or edits to a deleted
file ask Save / Don't save / Cancel. Escape closes the tab only from inside it, and only when
nothing inside (the search panel, a multi-selection) took the key first. A rename or move by the
app is announced with `pathsMoved` (`lib/pathEvents.ts`) and editor tabs on it follow to the new
path, keeping their buffer.

### The file tree's menu

Right click on a row or on the space below the rows, Shift+F10 or the menu key on the focused
row opens the shared `ContextMenu`, modelled on PyCharm's project view: New ▸, Cut / Copy /
Paste / Duplicate, Copy Path ▸, Rename… (F2), Delete… (Del), Open in ▸, Git ▸. `ContextMenu`
draws a submenu as a sibling of the menu inside one wrapper — the wrapper is the outside-click
boundary, the sibling keeps the menu's arrow keys on its own rows — and a submenu sits one
overlay level deeper, so Escape closes it first.

Ctrl+click and Shift+click gather rows; Delete, Cut, Copy, Copy Path, Revert and Add to
.gitignore act on all of them, the rest on one row. Cut and Copy fill an in-app clipboard of
paths, never the system one. Rename and New use the shared `InlineRename` in the row itself.

Every operation is checked in main (`main/fileOps.ts`, `main/git/ignore.ts`) against the
registered roots: the entry operated on by `entryWithin` — its directory resolved through
`realpath`, the entry itself not, because a symlink is renamed or trashed as the link — and the
directory something lands in by `realWithin`, links followed. A root itself is never a source.
Nothing overwrites: create, rename and move refuse a taken name, a copy takes ` copy`,
` copy 2`… (`shared/fileNames.ts`), and copies keep symlinks as links. Delete is
`shell.trashItem`. After its own operations the tree bumps its refresh counter; the changes
panel sees the result on its next poll.

Git ▸ Show diff and Compare with branch… open the ordinary diff tab — the latter with
`mode: 'base'` and the picked ref (a local branch as `refs/heads/<name>`, or the base resolution
would turn `main` into `origin/main`). Show history lists `git log -- :(literal)<path>`; a click
compares that revision with the working file, because the diff tab's right side is always the
working file. Revert is `git:revertFiles` behind the same `RevertConfirmModal` as the changes
panel. Open in ▸ Terminal is a shell tab with its own `shellCwd`.

### The diff tab

`DiffView` is `@codemirror/merge`: a `MergeView` side by side by default (left = the file at
HEAD or at the resolved session base, read from `oldPath` for a rename; right = the working
file), `unifiedMergeView` as the other layout. Both sides are the editor's own CodeMirror with
`languageFor` and `EDITOR_THEMES`, recoloured through the shared `themeSlot`. The change colours
are PyCharm's by kind — modified, inserted, deleted, with word-level marks inside a modified
block — as `--diff-*` tokens painted by `diffTheme` (`lib/editor.ts`). The divider carries
IntelliJ's curved bands (an SVG over the merge view's revert column, geometry in
`lib/diffBands.ts`, ported from `DiffDividerDrawUtil`/`DiffDrawUtil`) and a `»` per change that
replaces the right side's text with the left's, as an ordinary undoable edit.

Before any content is read, `git:fileDiffStat` returns numstat against the same ref, the larger
side's size and the resolved ref; `lib/diffGate.ts` decides: binary → a message, over 2 MB → a
message, lockfile/generated, over 500 changed lines or over 512 KB → a "Load diff" button.

The right side is editable when it is an existing text file, and it saves through
`useCheckedFile` — the same checked write, autosave and conflict UI as the file editor. The
re-read (on the triggers above, not a timer of its own) swaps texts into the live view while the ref stays the same and never
overwrites unsaved edits: a disk that moved under them is shown as the editor's conflict. A
hidden diff tab stays mounted only while it has unsaved edits.

### Shift+Enter is a newline

A terminal cannot say «Shift was held» on Return — the classic encoding has no room for a
modifier there, and both arrive as CR. The convention around that is to send **ESC CR**, which is
what Alt+Enter sends and what the agent CLIs read as «insert a line»; it is what Claude Code's
`/terminal-setup` writes into the terminals it supports. Our pane sends it itself
(`TerminalPane`, the key handler), because xterm would emit a plain CR and the composer would
send the message.

### Links in terminal output

A path printed in a terminal is a link and opens as an editor tab of the same session. Three
xterm link sources are in play per pane, and xterm asks them in this order: its own OSC 8
provider (text the program marked up as a link), `WebLinksAddon` for http(s) in plain text, then
the path provider from `lib/termLinks.ts`. The matcher (`lib/termPaths.ts`) is pure and tested: absolute,
`~`, and cwd-relative paths with an optional `:line[:col]`, trailing sentence punctuation and
surrounding quotes or brackets excluded from the link. Nothing is linked without `fs:isFile`
saying there is a regular file there, and those answers are cached per terminal — bounded, and
with a short expiry for "missing" so a file an agent is about to write becomes a link when it
appears. Directories are not links.

The click widens the sandbox by exactly one file: `files:openFromTerminal` registers the clicked
file itself as a root, which is what makes an agent's `/tmp/…/scratchpad` file readable without
opening its directory. See [decisions.md](decisions.md).

A link that is not a path opens through one handler in `TerminalPane`, given both to
`WebLinksAddon` and to xterm's `linkHandler` (which is also what makes OSC 8 work at all, and
what `allowNonHttpProtocols` lets a `file:` link through to). It splits on the scheme: `file:`
goes to the editor like any other path, everything else to `shell:openExternal`, where main
checks the scheme before the desktop sees it. **Nothing opens a link through `window.open()`** —
xterm's own handlers do, and the window-open policy denies the blank window they ask for, so the
click goes nowhere. See [decisions.md](decisions.md).

## State

`state.json` in `userData`, mode 0600 — it holds the env values of agents. The env values are
encrypted through Electron `safeStorage`; values without the `safeStorage:v1:` prefix are read
as plain text (the old format).

The write is atomic: temporary file → `rename`, and the previous generations are kept as `.bak`
and `.bak2`. Writes are serialised through a queue (`src/main/serialize.ts`), otherwise
parallel saves race each other.

Reading is protected from three sides:

- an unreadable or nonsensical `state.json` → fall back to `.bak`, then to `.bak2`;
- an unusable file is **not deleted** but set aside as `state.json.corrupt-<ts>`: the projects
  in it may still be of use by hand;
- a file with a version **newer** than the current build is not parsed and blocks saving —
  otherwise an older build would silently overwrite the state of a newer one.

How the load went is visible from `lastLoadOutcome()`; the UI is obliged to say so out loud,
otherwise the person will decide that the projects are gone.

## Checks

| command             | what it does                                       |
| ------------------- | -------------------------------------------------- |
| `npm run typecheck` | `tsc -b` over both projects                        |
| `npm run lint`      | eslint: the react-hooks rules and process boundary |
| `npm test`          | vitest, unit tests of the parsers and state.json   |

The build and the smoke run are started by the user — see [performance.md](performance.md).
Neither the pre-commit hook nor CI calls them.
