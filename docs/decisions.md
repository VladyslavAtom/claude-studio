# Decisions

A log: what was decided, why, and what the alternative was. Appended top to bottom, and old
entries are not rewritten — if a decision is reversed, a new entry is added with a reference to
the old one. How it all works right now — in [architecture.md](architecture.md).

---

## 2026-07-26 — Tests: vitest, pure logic only

There were no tests at all. vitest was set up (`environment: 'node'`, `npm test`), and the
parsers and `state.json` are covered: `mapStatusCode` / `parseNameStatus` / `renameSources`,
`parseUnifiedDiff`, `slugify` / `join` / `splitPath` / `basename`, the substitution of
`{session}`/`{name}` and POSIX quoting in `agents.ts`, and the loading / migration / atomic
write of the store.

None of this brings up Electron, spawns a pty or touches a real repository: the machine is
limited, and builds and smoke runs are the user's work. In the store tests `safeStorage` is
replaced by a stub and `app.getPath` by a temporary directory.

## 2026-07-26 — One tsconfig split by process

A single `tsconfig.json` handed main, preload and the renderer the same `lib`
(`ES2022 + DOM + DOM.Iterable`) and `types` (`node + vite/client`). Because of that, `document`
in main and `node:fs` in a component were, as far as the compiler was concerned, legitimate
code. In Electron this is a security boundary, and it was held up by discipline alone.

Now there are two projects and a solution file at the root (`tsc -b`). Checked: the split did
not turn up a single real violation of the boundary — the discipline really was holding. Now
the compiler holds it.

## 2026-07-26 — Strictness: what is on, what was measured and deferred

Enabled: `noFallthroughCasesInSwitch` (there are two `switch` statements in the repository, both
clean).

Measured and **deferred** — turning them on requires edits in `src/`, and that is a separate
commit:

| flag                         | errors         | worst places                                                                           |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `exactOptionalPropertyTypes` | 23 in 14 files | `hooks/useSessionActions.ts`, `hooks/useTerminalActions.ts`, `ChangesPanel.tsx`        |
| `noUncheckedIndexedAccess`   | 67 in 21 files | `lib/highlight.ts` (11), `MergeTab.tsx` (9), `agentSessions.ts` (7), `main/git/*` (10) |

Both figures are in the comments in `tsconfig.base.json`, next to the commented-out flags.

`exactOptionalPropertyTypes` produces errors of a single shape: an object is assembled as
`x: maybeUndefined` while the type declares `x?: T`. The cure is either `?? …` at the point of
assembly or `x?: T | undefined` in the type.

`noUncheckedIndexedAccess` is worth turning on first: it catches exactly the class of errors
that lives in `src/main/git` — `parts[++i]` after `split('\0')` has the type `string`, while on
truncated git output there is `undefined` there.

`noImplicitOverride` was skipped: there are no classes in `src/`.

## 2026-07-26 — There is a linter, but the parser is not typescript-eslint

The code already carried four `react-hooks/exhaustive-deps` suppressions even though neither
eslint nor the plugin was in the project. There was nothing to check them with — in an
application whose main class of errors is stale closures around pty and IPC.

typescript-eslint could not be installed: version 8.65 **throws on import** against
TypeScript 7, and not only in the type-aware rules — `parser`, `eslint-plugin` and
`typescript-estree` all fall over. What was tried:

- `--legacy-peer-deps` — it installs, but dies on the very first run;
- `overrides` in package.json, to nest TS 6.0.3 under `@typescript-eslint/*` only — npm
  refuses: `typescript` is a peer dependency there and is resolved from the root;
- a canary build (`8.65.1-alpha.7`) — the same peer range.

`@babel/eslint-parser` with `@babel/preset-typescript` was taken instead. The price of that
decision:

- **there are no type-aware rules at all** — no `no-floating-promises`, no `no-misused-promises`;
- `no-unused-vars` and `no-undef` are off: babel erases the types, so type-only imports look
  unused and interface members look undeclared. tsc does both checks more honestly
  (`noUnusedLocals`, `noUnusedParameters`);
- the process boundary is checked by name (`no-restricted-globals`, `no-restricted-imports`),
  and by type — through the split tsconfig.

eslint is pinned to 9.x: in 10.x the scope manager gained `addGlobals`, which the babel parser
does not have, and the run fails. Coming back to typescript-eslint is worth it once
[typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)
is closed.

The React Compiler rules from `eslint-plugin-react-hooks` 6/7 have been lowered to warning: as
errors they fire 59 times in code written before those rules existed, and pre-commit and CI
would have been red from day one. A check that is always red stops being read. The findings
have not gone anywhere — they are printed; raise them back to `error` as the cleanup proceeds.
`rules-of-hooks` stays an error: breaking it is a bug, not debt.

## 2026-07-26 — Prettier is configured, but the run is deferred

The configuration (`.prettierrc`, `.editorconfig`) describes the style that had already formed:
2 spaces, no semicolons, single quotes, 120 columns. The `npm run format` run itself was not
done: it would rewrite ~13 thousand lines and bury every other edit underneath. That is a
separate commit, better made in a quiet moment.

## 2026-07-26 — Code comments are in English

The rule used to require Russian comments. Repealed by the user. The interface, meanwhile,
becomes multilingual: **English by default**, plus Ukrainian and Russian. The rule "git terms
are not translated" stays in force and now applies to each locale separately.

---

## 2026-07-25 — Conversation identity belongs to the tab

Tabs were continuing their work through `claude --continue`, and two tabs in one worktree hooked
onto the same conversation. Checking the CLI showed: with Claude the id can be set in advance
(`--session-id`), with Codex it cannot (openai/codex#8923 was closed without an
implementation), which is why its id is read after start from the SQLite index.

## 2026-07-25 — Whether to resume or start over is decided by the agent's store

The "this tab has been launched already" flag lied in both directions: `No conversation found
with session ID` and `Session ID is already in use`. The source of truth was moved into the
agent's store — if the conversation is there, then `--resume`; if it is not, a clean start with
the same id. The check stands on every path: a click on a sleeping tab, «start all» from
the modal, and the "launch all" policy that asks nothing.

## 2026-07-25 — The tab name comes from the store, not from the terminal title

At first the name was pulled from the OSC title. The real Claude does not set the title, and the
tabs stayed «Claude».

A separate trap: the application itself was passing `-n {name}`, which put a `custom-title`
record into the conversation and **stopped Claude from coming up with its own title**. The
argument was removed, and the migration strips it out of saved settings.

## 2026-07-25 — The environment of tabs is cleaned

An application started from an agent session inherited that session's markers, and the nested
agent considered itself a child session: it turned off transcript recording, which broke
`--resume` as well.

## 2026-07-25 — There is no mode switch in the changes panel

The «vs HEAD / vs base» toggle was renamed three times («the whole branch's work», «since the session
started») — and every time it stayed incomprehensible. Analysis by two external models (fable and
codex, independently) gave one and the same diagnosis: **the problem is not the name, it is the
existence of a hidden mode**. One and the same list meant "this can be committed" one moment and
"this is already done" the next, and the only way to work out its current meaning was to recall
the position of the toggle.

A trial version showed the commits as a section of the same list — it read badly: a commit and
an uncommitted edit stand in different relations to the work. So the commits moved off into the
push window.

The directory switch (session / project root) was taken out of the permanent row and into the
branch menu: the action is rare, while the space in a panel about 400 px wide is permanent.

The words `worktree`, `upstream`, «vs base» and «since the session started» were removed from the UI.

## 2026-07-25 — The person chooses how to pull

The button always did `pull --rebase`. rebase and merge are not interchangeable: rebase rewrites
your own commits (a branch that has been pushed will then have to be force-pushed), while merge
adds a merge commit. There is nothing here to choose silently on the user's behalf: the default
is `pullStrategy: 'ask'`, the dialog has a «remember the choice» checkbox, and it can be changed on
the **Git** settings tab.

Remote branches were removed from the branch menu: they duplicate the local ones, and the
upstream column was cutting off the names of the branches themselves. For the base of a new
worktree, `origin/*` remains as suggestions in the field.

## 2026-07-25 — Conversations are collected from all `~/.claude*` profiles

The list showed only the default profile, because the store directory was taken from the agent's
`env`, while a wrapper such as `claude-1` sets `CLAUDE_CONFIG_DIR` **inside itself**.

The CLI itself cannot be asked: it has no "list your conversations" command, and `claude doctor`
does not print the directory. So main reads every `~/.claude*` directory that has a `projects/`
in it. A conversation is bound to an agent by a matching `CLAUDE_CONFIG_DIR`; the rest go to the
first claude agent, but are labelled with the name of their profile (`.claude-1`).

## 2026-07-25 — The new-session window is collapsed down to one question

A person was faced with four git entities at once: the worktree checkbox, the branch field, the
base field, the full path of the directory, plus a paragraph of explanation. Analysis by fable
and codex (independently) came to the same thing: what overloads is not the complexity of git
but that four things are presented as four mandatory decisions, when the intent is a single one
— "work in isolation".

What is left is one question, «Where the agent works», and a summary line under it; the branch,
base and directory fields moved under «Set up…». Hiding where exactly the agent will work is
not allowed — which is why the summary line stayed in plain sight.

## 2026-07-25 — The call for attention comes from the conversation record, not from the terminal bell

Verified experimentally: in interactive mode Claude Code **does not send BEL** — the only such
byte in the stream turned out to be the terminator of a window-title sequence
(`ESC ] 0 ; … BEL`). There are no OSC notifications (9, 777, 99) either.

The signal was taken from the store instead: the last response is marked `stop_reason: end_turn`
when the turn is over, and `tool_use` when the agent is still working. Only live tabs are
polled, and at startup a baseline is recorded — otherwise the application would ring about old
responses. The second reason for the silence was in the browser: WebAudio stays mute until there
has been at least one keypress in the window.

## 2026-07-25 — The clipboard under Wayland

Copying looked broken for three independent reasons:

- **there was nothing to copy**: in an agent tab the TUI turns on mouse mode and takes the drag
  for itself. Now, with no selection, the whole output of the tab is copied;
- **the write was not reaching the compositor**: under Wayland Chromium does not always hand the
  content over. Main checks that our text really ended up in the clipboard and duplicates it
  through `wl-copy`;
- **pasting fired twice**: Chromium itself reads `Ctrl+Shift+V` and `Shift+Insert` as the
  "paste" command. The browser path is suppressed.

The surprise: the middle mouse button **anywhere in the window** makes Chromium paste the
primary selection into the focused element — closing a neighbouring tab with the wheel was
pasting text into the terminal along the way. This cannot be cancelled on the tab itself, so
closing marks the moment and the terminal suppresses the paste that arrives right after it.

## 2026-07-25 — Files, diffs and merges became tabs

They used to be overlays with hand-written offset arithmetic (sidebar width + tree + changes
panel), and in a narrow window the block collapsed.

## 2026-07-25 — Results of the external review

The project was handed to two external models (fable and codex, independently). The findings
they agreed on turned out to be real and were fixed first: the tab lifecycle did not begin in
`createSession`; the service session confused responses on timeout; `removeWorktree` reported
success off `prune`; state was lost on a fast close; polling was expensive; `openExternal`
opened any scheme; env values were written into `state.json` as plain text.

## 2026-07-26 — A tab follows its conversation through `/clear`

The application starts each agent tab as `claude --session-id <uuid>` and remembered that uuid
forever. `/clear` abandons it: the CLI opens a new conversation with an id of its own. Confirmed
on real data — the tab's own file held 3 records and no title, while a sibling in the same
directory held 199 records and 45 titles. The tab showed the stale name and, on a restart,
resumed the abandoned conversation.

Guessing the replacement out of the store was rejected: nothing in a conversation file says
which pty created it, so two tabs in one directory cannot be told apart there. Two independent
reviews reached the same conclusion.

The CLI names the id itself, and the only thing it names it to is a hook. Driving a real
interactive session through `/clear` in a pty produced, in order: `SessionStart source=startup`,
`SessionEnd reason=clear`, `SessionStart source=clear` with a **new** id. Each hook gets one
JSON object on stdin — `{session_id, transcript_path, cwd, hook_event_name, source}`; the
sources the shipped 2.1.220 binary has are `startup | resume | clear | compact`.

So: a settings overlay in `userData`, passed as `--settings` on the command line of `uuid`
agents only — never written into the user's `settings.json`, or a `claude` run by hand in the
same directory would be mistaken for a tab. Its `SessionStart` hook writes stdin to
`reports/<terminal id>.json` (temp name, then rename), addressed by `CLAUDE_STUDIO_SESSION` and
`CLAUDE_STUDIO_HOOK_DIR` from the pty's environment. The hook prints nothing: a `SessionStart`
hook's stdout is fed to the agent as context.

Only `SessionStart` is registered, and the id being different is what triggers a rebind —
`compact` reports as well, with the id unchanged, so branching on `source` would be one more
thing to keep right. Rebinding is a dispatch of the existing `agentSessionCaptured` from the
poll that already walks every live tab; the title refresh and `--resume` follow on their own,
because both read `agentSessionId`.

Everything about it fails to silence rather than to an error: the CLI never reports a broken
hook, so a missing overlay, a disabled hook (`--bare`) or an unreadable report all mean the tab
behaves exactly as it did before.

## 2026-07-26 — The bell comes from `Stop`, not from the transcript

Reported with a screenshot: a subagent finished ("Teammate @plan-B finished"), the application
rang and raised a desktop notification, and the main agent was still working and waiting for
nobody.

`waitingSince` decided "waiting for you" by finding the last assistant record with
`stop_reason: end_turn`. A Task subagent is written into the same conversation file and its turn
ends exactly the same way, so the two are indistinguishable there — every parallel-agent run
rang falsely, and repeatedly.

The shipped 2.1.220 binary has `Stop` (the **main** agent has finished responding) and
`SubagentStop` (a Task subagent has). So the bell moved onto the `Stop` hook of the overlay that
was already being generated, delivered down the same per-tab channel. `SubagentStop` is **not**
registered: asking for the event this change exists to be rid of, and then remembering to ignore
it, is only a way to get it wrong later.

The one design point worth writing down: **a report is state, an event is not.** The conversation
id is one file, rewritten. A finished turn is a file of its own, `<terminal id>.stop.<seconds>.<pid>`,
and the read deletes it. A single overwritten file would have collapsed two turns that fell
inside one 4-second poll into one bell; a file each cannot, whatever the interval turns out to
be, and deleting on read is what stops one turn ringing twice.

The captured `Stop` payload also carries `prompt_id`, `stop_hook_active` and
`last_assistant_message`. None of them is read: the existence of the file is the whole message.

`Notification` — what the CLI raises for a permission prompt or an idle agent — was left alone
for now; it is in [open-questions.md](open-questions.md) with the reason.

## 2026-07-26 — One source for «your turn», and it says when it is deaf

Two follow-ups to the entry above, both from the user.

**The transcript read is gone, not demoted.** `waitingSince` was going to stay as a fallback for
tabs whose hooks do not report. It is deleted instead — the function, the `agent:waitingSince`
channel, its handler and its preload method. A signal cannot be trusted while a second one is
allowed to disagree with it: the fallback was precisely the imprecise path, and keeping it meant
keeping a rule about which of the two is allowed to speak. Deleting it removes the double-ring
question by construction.

That leaves nothing to be quiet with. A CLI whose hooks are off would simply never ring again,
and the application would look like it was working. `SessionStart` fires for every tab at
startup, so its absence is a reliable signal: a tab awake for 20 s that has still reported
nothing gets a faint `⊘` in the tab strip, with a tooltip naming the likely causes.

The measure is time awake rather than "has produced output", which was the first attempt: output
reaches the renderer only through a mounted pane, and a pane exists only for the session on
screen — a tab in a background session would never have qualified. A tab strip marker rather than
a toast: it is a standing condition of one tab, not an event, and it must not interrupt anything.

**`Notification` is wired.** It is what the CLI raises when it wants a person mid-turn — a
permission prompt, or an agent left idle — and `Stop` cannot cover it: an agent blocked on a
prompt has not stopped. Measured on a real session: the idle notification arrives 60 s after the
wait begins, exactly once, with `notification_type: "idle_prompt"`. It is counted apart from
`Stop` all the way to the renderer, because only one of the two ends a turn — a `Notification`
rings but does not re-read the conversation's name. Its `message` is the CLI's own wording and is
never read: main writes no interface copy.

`SubagentStop` is still not registered.

## 2026-07-27 — A codex tab is told its own id, and does not ring

The codex half of the two entries above, and **only the id half**. A codex tab has never rung in
this application — the old `waitingSince` returned null for it — so giving it a bell would be new
functionality inside a bugfix. It may well be worth having; it is a change of its own, after
somebody has decided what a codex turn should do.

The two real defects are both about the id. A codex tab used to learn it by guessing:
`discoverCodexSession` polled codex's SQLite index up to twelve times at 2.5 s intervals for «the
newest `threads` row with this cwd», and two codex tabs in one worktree write rows that differ
only in their timestamps. And a conversation the tab left was never noticed at all. That heuristic
is deleted, along with the `rollout-*.jsonl` fallback beneath it, its IPC channel, and the
`useCodexCapture` hook that drove it from two places in the renderer.

Codex has hooks, but they sit behind a trust gate (`--dangerously-bypass-hook-trust` exists
precisely because an unvetted `hooks.json` is refused), and its event list has neither a `Stop` nor
a `Notification`. What it does have is `notify`: a program, given one JSON object **as its first
argument**, set per invocation with `-c notify='["…"]'` so the user's `~/.codex/config.toml` is
never touched and a hand-run `codex` in the same directory is never mistaken for a tab. The value
is TOML inside a shell word, so the path is escaped for both grammars — there are tests that run
the produced command line through `/bin/sh` and check the argv codex would receive.

```
{ "type": "agent-turn-complete", "thread-id": "…", "turn-id": "…", "cwd": "…",
  "client": "codex-tui", "input-messages": [...], "last-assistant-message": "MAINDONE" }
```

The program writes one file: `<terminal id>.json`, temp-then-rename, silent, exit 0. It leaves no
event, so a codex tab's counts are zero on every poll and the renderer needs no branch for it —
`thread-id` differing from the tab's is what rebinds, exactly as a claude `SessionStart` does, and
the title refresh and the next resume follow because both read `agentSessionId`.

**A payload without a `client` is refused, and that is not about bells.** Measured live, twice, in
real sessions driven through a pty: codex calls the notify program for a finished **subagent** as
well, and with two subagents their calls arrived four and two seconds _before_ the tab's own. Those
payloads name the subagent's own thread and carry no `client` (the tab's carries
`client: "codex-tui"`). The state file is rewritten by every call, so the last writer wins — without
the check a tab would rebind to a subagent's thread and go on to resume and name itself from a
conversation that is not its own. Filtering by thread cannot replace it: the tab learns its thread
from the first call it accepts, and the first to arrive can be a subagent's. Any non-empty `client`
is accepted rather than `codex-tui` alone: what matters is that some front-end owns the
conversation.

The program stays dumb — it writes what it was handed, and the parser in main decides — for the
same reason the claude hooks do: a line of `sh` that parses JSON would be a second, worse parser.
So a subagent's payload can sit in the state file, where it reads as null, and the tab keeps the id
it already has until the next turn of the main agent overwrites it.

Two consequences, both accepted:

- **The id now appears after the first completed turn, not during it.** A tab restarted before it
  has ever answered has no id to resume and starts a new thread, leaving the unanswered one behind.
  The old polling was no better: codex writes the `threads` row when the first turn completes, so
  there was never anything to find earlier — only 30 s of polling that found nothing.
- **A codex tab is never marked `⊘`.** The marker means «this tab will never ring»; claude earns it
  because `SessionStart` fires for every tab at startup, so its absence is evidence. Codex says
  nothing until a turn ends, the marker's sentence is about a bell a codex tab has never had, and
  the badge would sit on every codex tab for as long as it was thinking.

Noted for whoever does add a codex bell: the subagent behaviour above is the thing to design
around, and `client` is what tells the two apart today.

## 2026-07-27 — A clicked path in terminal output widens the sandbox by one file

`src/main/files.ts` reads and writes only inside a set of allowed roots — the projects and
worktrees the user has opened. Agents print paths that are outside every one of them: the common
case is an agent's own scratchpad, `/tmp/claude-1000/…/scratchpad/fe-message-14076.md`. Making
those paths clickable therefore had to answer what a click is allowed to reach, and the answer
is: **exactly the file that was clicked, and nothing else.**

`isAllowed` already matches `target === root` as well as `target` under `root + sep`, so a file
works as a root of its own. `files:openFromTerminal` `stat`s the path and adds that one resolved
file to `allowedRoots`. Registering its directory would have been one character shorter and would
have handed over the whole tree — every sibling, every subdirectory — in exchange for one clicked
line of output.

The grant is its own channel rather than the renderer calling the existing `files:registerRoot`.
The two are not the same act: `registerRoot` is «this directory is a project», said when a project
is opened, while this is «the user clicked this», said about one file. Two names mean the channel
table shows what can be granted and from where, instead of one channel that means whatever its
caller meant.

The click is treated as consent for the same reason the open dialog is: the person named the file.
It is not a blanket grant — the sandbox does not widen on hover, on output, or on a path merely
being printed; only the click does it, and only for what was clicked. A directory is refused
rather than registered, because this change opens files in an editor and a directory has nothing
to open; so is anything that is not a regular file, a fifo or a device would block the read.

Two consequences worth having in writing:

- The grant lasts for the life of the window. `allowedRoots` is a set in memory with no removal,
  and clicked files accumulate in it — one entry per file, never a subtree.
- The renderer never asks for a grant it did not get a click for. `openPathFromTerminal` is the
  only caller, and it opens the tab only after the channel answers `ok`.

**What is not linked.** Only regular files: `fs:isFile` is the gate, so a directory does not
underline and cannot be clicked. Not linked either: a path containing a space, a quote or a
bracket — the matcher stops at those characters, because guessing where such a name ends is how a
link swallows the rest of the sentence — and a path with a colon in it, which is what keeps
`git@github.com:user/repo.git` and `ext::sh -c` out. A URL stays the web links addon's, which is
registered first and asked first.

## 2026-07-27 — A sleeping tab keeps its last screen, and can be sent to sleep by hand

Sleep used to replace the pane with a card: a large «z», one sentence and a wake button.
Everything the tab was about — the answer half-read, the question the agent asked, the error it
stopped on — was gone the moment the timer fired, and the only way to find out what had happened
was to wake the process and ask again. The tab now shows the last screen it had.

**Captured on the way out, not on demand.** `kill()` frees the buffered scrollback in main
deliberately, so after a tab is asleep there is nothing left to serialise. The capture therefore
sits in the cleanup of the effect in `TerminalPane` that owns the terminal — the last moment the
instance exists — and it is taken whatever the reason for the unmount: slept, closed, or left
behind on a session switch. Storing a screen for a tab that then closes costs one string, which
its own bookkeeping drops; not having one for a tab that sleeps costs the whole screen. Being on
a cleanup path, it cannot throw: an exception there abandons the rest of the teardown, so
everything it can go wrong about answers with an empty string and the card is what is shown.

**With the colours.** `@xterm/addon-serialize` (the official addon, the family of the four
already used) writes the viewport back as escapes. Plain text was the alternative and it turns an
agent's coloured output into a grey wall, which reads as breakage rather than as sleep.
`excludeModes` is the one departure from a faithful copy: the modes include mouse tracking, and
replaying it would have the frozen screen grab the pointer and refuse a selection — on a terminal
that can no longer answer a mouse report.

**Shown in a terminal that cannot be mistaken for a live one.** Only the visible sleeping tab
gets one, so at most one exists at a time. It is never handed to `pty.start`; `disableStdin`
drops keystrokes instead of sending them into the void; the cursor is hidden with `\x1b[?25l`
after the screen is written, because a blinking cursor is the one thing that says «this terminal
is waiting for you»; the textarea leaves the tab order. Selection is left working — a person who
comes back to read the last screen usually wants a line out of it.

**The way back is a bar above the screen**, not a button floating over it. An overlay covers the
output it is explaining and a small button goes unnoticed on a busy screen; the bar is in the
same place whatever is underneath, states that the tab is asleep, and costs the top row or two of
an old screen — the right end to lose. The existing vocabulary is untouched: the strip still says
`asleep` and still shows its `z`.

**The snapshots are runtime state**, next to `awake` in `useTerminalRuntime`, not in
`state.json`: after a restart the process is gone and the conversation is resumed from the
agent's own store, so a screen from the previous run would be a lie about a session that no
longer exists. The store is bounded (`lib/snapshots.ts`) — a dozen screens, and a capture larger
than a screen plausibly is is dropped rather than truncated, because cutting a string of escapes
in half produces visible garbage. Waking removes the snapshot in the same update that raises the
live pane, or the running terminal would be painted over by its own ghost.

**Sleep by hand goes through `pty:sleep`**, a channel that kills and emits `slept` exactly as the
idle sweep does — the sweep now calls the same function. The renderer could have killed the pty
and dropped the tab from `awake` itself; that is a second, shorter path to the same state, and
the two would have drifted at the first change to either. Two deliberate differences from the
sweep's own tests: `sleepable` is not consulted, because it says which tabs the timer may take by
itself (shells are left alone) and has no business overruling a person who asked; and an id with
no record still gets its `slept`, because the renderer believes that tab is awake and this is
what corrects it.

---

## 2026-07-27 — Clearing a tab's history, in both places it is kept

Measured on three real pty captures: Claude Code never enters the alternate screen
(`\e[?1049h` zero times), never clears the screen and sets no scroll region. It paints inline and
repaints only the visible rows, so when it switches the view — to a subagent, say — everything
printed before stays above in the scrollback and scrolling up shows the old output mixed with the
new view. That is the CLI's design. What we can give is a way to wipe the record and start clean.

**«Clear the history» in the tab strip's right-click menu**, next to the sleep item. It is
offered for tabs that have a terminal — agent and shell — and not for editor, diff or merge tabs.

**Both copies, or it comes back.** The text has two owners: the xterm instance in the renderer,
and the chunked buffer main keeps for replay (`start()` hands it back on every attach). Clearing
only the pane postpones the history to the next session switch; clearing only main leaves the
screen as it was. The renderer uses `term.clear()` and not `reset()`: `clear` keeps the line the
cursor is on and drops what is above, which leaves an agent looking at the screen it was drawing
on, whereas `reset` would take the current screen and the modes the TUI has set with it.

**Main's side is `pty:clearScrollback`**, and it touches nothing but the chunks. `seq` keeps
counting, because an attaching pane drops the events it has already been given by comparing
against it and a restarted count would have it write them twice. `pending` — at most 25 ms of
output already on its way — is delivered as it is: it is a repaint in flight, and cutting one in
half leaves escape sequences without their ends. So that much output is dropped from the replay
copy while still reaching the screen; a screen and its record differing by one frame is the
smaller fault.

**The command reaches the pane as a counter it watches**, `clearSeq`, and not through an
imperative handle. The xterm instance is born and dies inside the pane's effect and is never
handed out; every other traffic between strip and pane is a callback going _out_, held in
`latest`. A handle would be a second channel running the other way, whereas a prop the pane
observes stays inside the one data flow the component already has. The pane remembers the value
it was mounted with, so a remount — a restart, a return to this session — does not re-run a
request already served. The counter deliberately does not feed the pane's remount key: rebuilding
the pane re-attaches it, and main would paint the buffer back.

**A sleeping tab is not offered the item** rather than shown a disabled one. There is nothing to
clear on either side: main killed the process and dropped its buffer, and there is no pane. Its
frozen screen (`lib/snapshots.ts`) is a third copy of the text and is left alone — waking a tab
drops the snapshot in the same update that raises the live pane, so an awake tab never has one,
and the pane captures a fresh screen on its way out. Waking is a click such a tab needs anyway
before its history means anything.

**The chunk buffer moved to `src/main/scrollback.ts`** as `appendChunk` / `joinChunks` /
`clearChunks` / `trimToTail` over a `Scrollback` shape that `Term` extends. It is the one part of
`pty.ts` with no pty in it, and the part whose mistakes are invisible: `chunksLen` is kept beside
the chunks instead of being counted, so an operation that edits one and not the other makes the
limit lie, and the lie surfaces a session switch later as output missing or doubled. Now it is
imported by `tests/scrollback.test.ts`, which checks that invariant after every operation —
including that a clear leaves a shape a later append and a later replay both handle.

## 2026-07-27 — The dot on a claude tab says what the agent says it is doing

The indicator was computed from the pty's output stream: a pane reported activity at most once
every 1.5 s, and a tab stopped counting as busy 6 s after its last byte. That answers "has this
terminal printed anything lately", which is not the question anyone is asking of an agent tab. An
agent thinking without printing looked idle; an agent drawing a spinner looked busy for as long as
it drew one; and neither could be told from the other by looking at bytes.

A running claude keeps a file about itself — `<profile>/sessions/<pid>.json`, rewritten whenever
its state changes, removed when the process exits — carrying `status: busy | shell | idle |
waiting`. It is the process's own answer to "what am I doing", so it is immune to both failures by
construction. It is read in main (`agentSessions.agentActivity`) and reaches the renderer on the
pass `useWaitingPoll` already makes over every live tab, every 4 s: one more call per tab, no
second timer, and nothing under `~/.claude*` read outside main.

**Matched by session id, never by pid.** Our pty runs `$SHELL -i` and the agent is a grandchild of
it, so the pid is not ours to know. The file names the conversation, and the tab already follows
that id through `/clear` — which is what makes this work at all, and why it landed after the hook
rebinding and not before.

**Precedence in `terminalStatus` (`renderer/lib/status.ts`), in this order:** `dead`, `asleep`,
`attention`, the state file, output. `attention` stays on top of everything the process says
because it is not about the process: it means "this tab called you and you have not looked", and
the CLI goes on working the moment a prompt is answered while the tab that rang is still unread.
The state file comes next and, where it answers, it decides — falling through to `busyIds` after
an `idle` would put the spinner bug straight back. Output is what is left for a shell tab and for
a claude session with no file, so a tab nothing answers for behaves exactly as every tab did
before this existed. `busyIds` is not removed; it is the fallback, and for shell tabs it is the
only answer there is.

**`shell` counts as running.** It means the CLI is running a command of its own, and the CLI's own
session list counts `busy` and `shell` alike as "working" — read in the shipped binary, not
guessed. **`waiting` counts as waiting.** The brief said to treat it as unobserved; it was then
found in the binary, set whenever the CLI is blocked on a person and paired with a `waitingFor`
naming which ("sandbox request", "input needed", "dialog open"). It draws the dot and never rings
— bells stay with the hooks — and it covers precisely the stretch `attention` cannot: `attention`
is cleared the moment the person looks at the tab, while the prompt is still up.

**A status word we have never seen is "no opinion", not a guess.** A later CLI may add one; the
file still identifies the session correctly, and inventing a meaning for the word would put a
wrong dot on the tab, which is the defect being fixed. Same for an unreadable file, a half-written
one and a session that writes none — measured: a `claude` driven by hand in a throwaway pty
produced no file while three real tabs all had one, and what distinguishes them is not known.

**A file whose process is gone is dropped.** Only an orderly exit removes it, so a crashed CLI
leaves its last status frozen on disk, and a frozen `busy` would pin the tab to "running" for the
rest of the day. Of the files that remain for one conversation the newest process wins, by
`startedAt` and not by `statusUpdatedAt` — that one moves only on transitions, and would rank a
session that has sat idle for an hour below one that changed state a second ago.

**Cost.** Every live tab asks every 4 s, so the listing of a profile's `sessions/` is kept for
1.5 s — shorter than one pass, so a pass sees one listing and the next pass a fresh one — and a
file that has not been rewritten is not read again, keyed by (path, mtime, size), the same way the
conversation lookups in that file already work.

The session pulse in the sidebar now classifies its tabs through the same `terminalStatus`. It had
its own chain of `if`s over the same inputs, which is two chances to disagree about tabs both are
looking at.

See also `docs/research.md`: this is the mechanism Nimbalyst uses and we did not take. The reason
recorded then — "we could not make it appear for a plain CLI in a pty" — turned out to be three
failed reproductions rather than a property of the CLI, and that entry has been corrected.

## 2026-07-27 — A project tab says what is happening inside it

The dot on a project tab was `p.isGit`, painted green. Every project we can open is a git
repository, so it was green always — and it sat where a status light sits, beside a count badge, so
it was read as one. A light that cannot change is worse than no light: it reports «all well» for a
project with three agents blocked on a permission prompt.

**Git-ness moves to the tooltip.** Not to a second dot beside the first: adding a status indicator
next to a green dot meaning something else leaves the confusion exactly where it was. The tooltip is
enough — the active project's branch is already in the top bar, and nothing in this application can
open a folder that is not a repository, so the fact is close to constant anyway. The dot slot is now
the status, which is what a reader was already taking it for.

**Combined, not reduced to a winner.** `waiting` and `running` are both drawn when both are present,
`waiting` first. They are two different errands: something wants a person, and something else is
working. Collapsing them to the more urgent one would hide the second until the first is cleared,
and «is anything still running in there» is the question a background project is glanced at for.

**Presence, not counts.** The session pulse carries numerals because it has one row per session and
the whole sidebar width. The strip has several tabs in a row, each already carrying a name that must
ellipsize and a badge; two numerals per tab is a ledger. The counts are one level down in the pulse,
and here in the tooltip and the accessible name, which is where a person goes when the dot has told
them there is something to go for.

**Idle and asleep only when nothing is active.** Otherwise a project with forty idle tabs and one
calling draws two dots and the amber one is a detail of the picture rather than the picture. They
are not events — nothing about them is worth interrupting a glance — so they are the answer only
when there is no other answer, and the liveliest one speaks for the rest: idle over asleep, because
a live silent process is more than no process.

**The waiting badge is folded in.** It counted the calling tabs and turned amber — the same fact the
amber dot now states, in a second shape a reader had to work out agreed with the first. The badge
goes back to one meaning: how many sessions the project holds. Its count is not lost; it is in the
words the tooltip and the label carry.

**An empty project gets the sleeping tab's hollow ring**, and no tooltip. It is the same statement —
nothing in here is running — and it keeps the dot slot occupied, so a tab's label does not shift by
ten pixels the moment its first session appears.

**The vocabulary is the pulse's, in one table.** `PULSE_LOOK` maps each status to its CSS class and
its `sessions.pulse.*` plural key, so amber means the same thing in the sidebar and in the strip and
cannot drift. The classification itself is `terminalStatus`, unchanged and not re-derived —
`projectPulse` takes statuses, it does not compute them. That is the mistake the session pulse had
until yesterday.

**Accessibility.** The dots are `aria-hidden`; the tab's `aria-label` carries the same sentence the
tooltip does, through a second key (`projects.tab.aria.status`) rather than assembled with `+`. One
string feeds both, so what is hovered and what is heard cannot diverge.

**Cost.** `ProjectTabs` already walked every project, session and tab once per render of the strip
to count the calling ones. It still makes exactly one walk; it now tallies instead of counting. What
changed is how often: the memo used to depend on `attention` alone and now depends on `awake`,
`busyIds` and `agentActivity` as well, all of which move on the 4-second poll. Each of those comes
back as the same object when nothing in it changed — `useTerminalRuntime` is careful about that for
this exact reason — so the extra passes are the ones where something really did change, over a tree
of tens of tabs.

## 2026-07-28 — The scrollback limit is a setting, and it defaults to unlimited

A terminal kept 5000 lines in the pane and 250 000 characters in main. Neither number was ever
chosen for a reason that survives inspection, and the smaller one wins: what a person can scroll
back through was 250 000 characters, because that is all a pane is given when it re-attaches after
a switch to another session and back. Scrolling up in a long agent run reached the top of the
history long before it reached the beginning of the run.

**One setting, in lines, in `settings.terminal.scrollbackLines`.** Lines are the unit a person
scrolls in and the unit xterm counts in; characters are an implementation detail of main's replay
buffer, and a setting stated in them would be a setting nobody can predict the effect of.

**`null` means «no limit», and it is the default.** Not `0`: one layer down, `scrollback: 0` is
xterm's way of saying «keep the viewport and nothing else», and that value is deliberately used
for the sleeping-tab snapshot — the same number meaning opposite things in files that call each
other is how the next reader gets it wrong. Not an absent field either: absence is reserved here
for «the user has never chosen, follow something else» (`locale`, `theme`), and there is nothing
to follow — the system has no opinion about scrollback.

**`migrate()` names it**, like every other settings field, and takes anything that is not a
positive number — absent, `null`, junk from a hand-edited file — as «no limit», which is also the
default. Three ways of saying the same thing land in one place instead of being told apart.

**One number drives two limits, and the conversion is stated rather than pretended.** xterm gets
the number of lines as it stands. Main's buffer counts characters and gets `lines × 200`
(`CHARS_PER_LINE`). There is no exact rate: the buffer holds the raw stream, escape sequences and
repaints included, while xterm's limit counts the lines that survive that stream. 200 characters
for a line typically 60-80 wide is deliberately generous, because the two errors are not equal —
too high spends memory the unlimited default was ready to spend anyway, too low means a re-attached
pane is painted a shorter history than the one it was just scrolling through, which is the defect
this setting exists to remove.

**Unlimited reaches xterm as 4 294 967 295**, its own `MAX_BUFFER_SIZE`. Established by reading
the installed @xterm/xterm rather than assumed: the option is put through
`Math.min(value, 4294967295)` and throws below zero, so `Infinity` would in fact have survived —
it is not passed anyway, because a value silently rewritten on the way in is one nobody can read
back. At that size V8 hands back the line array in dictionary mode instead of allocating it
(measured here: 0.03 ms, against 223 ms and 256 MB of empty slots for a fast-mode 2^25 array). The
price is ~0.7 µs per line stored instead of ~0.04 µs — nothing beside the parsing and painting of
that same line, and paid only for lines that arrive. Main's side is `Infinity`, which never leaves
the process and never reaches JSON.

**It applies to live terminals.** The pane assigns `term.options.scrollback` and remembers what it
applied, the same discipline the theme switch uses and for the same reason: the mount effect owns
the pty attachment, so a limit in its dependency list would flush every open tab to change a
number. xterm's buffer set listens for that option and resizes its line list in place. Main is
pushed the new value from `useTerminalRuntime` — one number for every pty, so it cannot come from
a pane, since a background tab has none — and a lowered limit trims what is already buffered
rather than waiting for the next chunk, because freeing the memory is the point of lowering it.

**What unlimited costs is in the interface, not left to be discovered.** The hint says the history
is held in memory in two copies, that nothing is written to disk, that nothing is freed until the
tab closes or the app quits, and that a tab nobody is watching costs the same as one they are.

**`copyAll` is left as it is.** It walks the whole buffer, so its cost now follows the setting —
at the old 5000 lines a few hundred kilobytes, unlimited as much as the tab has printed. Capping it
would hand back less than «copy everything» promises; it is a keystroke made on purpose, once, and
not on the output path.

Untouched by this on purpose: the sleeping-tab snapshot (`serialize({ scrollback: 0 })` is the
viewport and only the viewport), and the 200 lines `SleepScreen` gives the frozen screen it paints.

## 2026-07-28 — A link opens through the IPC, never through `window.open()`

Every http(s) link in the terminal was dead. Not intermittently — always, since links were
added. The reason is in xterm and its web-links addon, which both open a link like this:

```js
const newWindow = window.open()          // deliberately with no address
if (newWindow) newWindow.location.href = uri
else console.warn('Opening link blocked as opener could not be cleared')
```

The blank window comes first so that `opener` can be cleared before the address is assigned.
Our window-open policy (`src/main/index.ts`) is shown `about:blank`, which is not a web link, so
it denies it — `window.open()` returns null, the addon logs a warning nobody reads, and the
click does nothing. The address never reached the policy at all: it was going to arrive one step
later, and that step no longer exists.

So the renderer no longer relies on that route. `shell:openExternal` takes the address directly,
main checks the scheme (`isSafeExternalUrl`, now shared by both the IPC and the window policy
rather than copied) and answers whether it opened. `WebLinksAddon` is constructed with our
handler instead of its default. The window-open policy stays as a backstop for anything else in
the page, with a comment saying why it cannot serve the terminal.

The same click also had a second, quieter failure: text marked up as a link. Agent CLIs use
**OSC 8**, the terminal standard for hyperlinks, and xterm surfaces those only through
`options.linkHandler`. Without one it offers a `confirm()` and then the same dead
`window.open()`; and it drops every non-web scheme before that, so a `file:` link produced no
link at all. `linkHandler` is now set with `allowNonHttpProtocols: true`, and the handler splits
the two cases: `file:` opens in the application's own editor — the same place a bare path in the
output goes — and everything else goes out, where main has the last word on the scheme.

Considered and rejected: relaxing the window-open policy to allow `about:blank` and read the
address off the navigation afterwards. That trades a checked call for an unchecked one, and it
would have to hold for every window the page can open, not just the terminal's.

`isSafeExternalUrl` and `fileUrlToPath` are covered by tests — the first decides what is handed
to the desktop, the second decides which of the two routes a click takes.

## 2026-07-28 — Nothing selected copies nothing

`Ctrl+Shift+C` with no selection used to copy the whole scrollback. The reasoning at the time
was that a key which leaves the clipboard untouched reads as a broken key, and in an agent tab
there is usually no selection anyway — the TUI takes the mouse.

It was wrong, and it is what «copying stopped working» turned out to be. Not a key that did
nothing: a key that put an entire session's history into the clipboard over what was wanted.
Every symptom follows from that. It «worked and then stopped» because the scrollback grows all
session. A restart cured it because a restart empties the scrollback. It hit every tab at once
because every tab had grown. And it became far worse the day the scrollback limit went to
unlimited by default — the fallback then had no ceiling at all.

Now the chord copies the selection or does nothing, which is what every terminal does. The whole
output keeps a chord of its own, `Ctrl+Shift+A`, and the context-menu item that copies
everything says so in its own label — there the action is asked for rather than guessed at.

The general rule this stands on: **a key must not do a bigger thing than it was asked for when
the small thing is unavailable.** Silence is a legible answer; a substituted, larger action is
not, and it is discovered only by the damage it does somewhere else.

The trace added while hunting this (`[copy] 1` … `5` in the log, see
[architecture.md](architecture.md)) stays for now. It records how much was copied, so a copy
that is somehow still enormous says so in one line instead of being pieced together again.

## 2026-07-28 — A shortcut belongs to a key, not to a letter

`Ctrl+Shift+C` stopped copying, came back, stopped again, and survived every explanation offered
for it. It was the keyboard layout. `KeyboardEvent.key` is the character the layout prints: in a
Russian layout the key marked `C` reports `С` — Cyrillic es, U+0421, a different character that
merely looks the same. Every shortcut in the application was compared against a Latin letter, so
switching the layout removed all of them at once: copy, paste, Ctrl+F, Ctrl+B, Ctrl+T, Ctrl+W.

Everything the fault did follows from that, including how well it hid. It broke «after an hour»
because that is when Russian was needed. It came back «by itself» on a switch back. It was
cured by a restart because a restart is something a person does in English. The log then made it
plain in one line: `[copy] 1 before-input-event: Ctrl+Shift+С`, next to the `Ctrl+Shift+V` that
worked.

`isKey()` (`lib/keys.ts`) now asks `code`, which names the physical key and does not move with
the layout; the character is kept only as a fallback for a synthesised event that carries no
code. Every letter shortcut goes through it, and the cases from the log are in the tests.

Recorded also because of the wrong turn it caused. The trace built to catch this filtered on the
Latin letter itself, so a Cyrillic press logged nothing — and «no line at all» was read as «the
keystroke never reaches the process», a conclusion about compositors and window focus with a
measurement behind it that could not have said anything else. **An instrument that shares an
assumption with the code it is watching confirms the assumption.** The filter was widened to
every Ctrl+Shift chord for an unrelated reason, and that is what produced the answer.

## 2026-07-28 — The copy trace is removed, and the read-back with it

The trace did its work (see the entry above) and is gone: the chords, the window focus and blur,
the IPC line, the renderer's two. What it was watching for turned out to be a comparison against
the wrong letter, and there is nothing left to watch.

The read-back after a copy goes too, and that one was doing harm rather than nothing. On this
desktop `wl-copy` cannot own the clipboard without keyboard focus: KWin offers
`ext_data_control_manager_v1`, which grants ownership without it, but wl-clipboard 2.2.1 knows
only the older wlroots `zwlr_data_control_manager_v1` and so falls back to creating a surface and
taking the focus. The log showed it plainly — two blur/focus pairs around every copy, one for
`wl-copy` and one for the `wl-paste` the check spawned behind it. Half of that is now gone; the
other half is the price of the clipboard working at all here, and it goes away by itself when
wl-clipboard learns `ext-data-control`.

What stays is not a trace: a failed `spawn` and a non-zero exit are logged, because both leave
the caller with `null`, and `null` also means «there was nothing in the buffer». And the
renderer's warnings and errors keep going to the same log as main's — devtools are not open when
a fault appears an hour into a session.

## 2026-07-30 — Shift+Enter sends ESC CR

In a composer — Claude Code's, Codex's — Shift+Enter is expected to add a line rather than send
the message. A terminal cannot express it: the classic encoding has no room for a modifier on
Return, so Shift+Enter and Enter both arrive as CR and no program can tell them apart. Terminals
that appear to support it are the ones sending something else for that chord.

The something else is **ESC CR** — what Alt+Enter has always sent, and what the agent CLIs take
as «insert a line». Claude Code's `/terminal-setup` writes exactly that binding into the
terminals it knows; it refuses Konsole, where the shipped table sends `\EOM` (the keypad Enter
sequence) instead, which is distinguishable but means nothing to the CLI.

So the pane sends ESC CR itself, and does not leave the chord to xterm, which emits a plain CR.

Not made configurable. It is a convention, not a preference, and a terminal that behaves
differently from every other terminal on this key is a bug report waiting to be written.

## 2026-08-03 — The pidfile has to name our process, not just a live pid

The launcher kept the pid of the running app in `app.pid` and treated the file as authoritative
if `kill -0` succeeded. Pids are recycled: the app of the previous session exited, the kernel
handed 5037 to a Chrome renderer, and from then on every launch answered «already running (pid
5037); the window should be open» and exited 0. Started from the desktop shortcut that is no
window, no error dialog and not a line in `app.log` — the shortcut looked broken, and the
diagnosis went to the icon, the `.desktop` file and the trust flag before the log of the plasma
session showed the script had run and refused.

`running_pid()` now also asks `ps -p … -o args=` and requires the line to _begin_ with
`$APP_DIR/node_modules/electron/dist/electron`. Matched at the start, i.e. against argv[0]: a
substring match hits every shell that merely mentions the path — this script, an editor, an
agent — which the first version of the check did, and it silently reported the wrong answer in
exactly the direction that hurts.

A pidfile that fails the check is stale and is removed instead of blocking the next start; the
guard used to need a manual `rm`, and nothing told the user that.

Not used: a lock via `flock` on the pidfile, which is the correct answer to this class of
problem. It would move the guard into the started process, and the guard is also what makes
`--stop` and «already running» work from a shell that holds no lock. Electron already keeps its own
single-instance lock inside the profile (`src/main/index.ts`) — the script's job is only to not
lie about a pid.

## 2026-09-17 — An agent opens a session through a tool, not through the app's own channel

An agent working in a tab can already talk to other claude sessions on this machine: that
mechanism is Claude Code's own and nothing here has to carry the messages. What it cannot do is
make a session **visible** — a subagent has no tab, no worktree, no branch, no bell, and nobody
can look at it or type into it while it works.

So the only thing the application adds is the opening. A claude tab is started with an MCP server
of ours (`--mcp-config`, next to the `--settings` overlay it already gets), the server exposes one
tool, `open_session`, and a call becomes an ordinary session in the window — worktree, tab, agent,
first task. The answer names the new session and its conversation id, and from there the agents
talk to each other themselves.

**Why an MCP server and not a helper command on PATH.** A command has to be found, spelled
correctly and explained in a prompt; a tool is offered to the agent by the CLI, with its schema,
and the CLI's own permission prompt is what asks the person the first time. Nothing is added to
the user's own configuration, exactly as with the hooks: the config we pass is merged with the
user's MCP servers (no `--strict-mcp-config`) and applies to the CLIs this app starts.

**Why files and not a socket.** The same path the hooks already use, for the same reason: a
request is a file written and renamed, a reply is a file written and renamed, and a process that
dies mid-way leaves nothing that has to be cleaned up by hand. Main **takes** a request as it
emits it, so one call cannot become two sessions.

**Why the renderer carries it out.** A session is a project, a worktree, a tab and state that is
written to disk — all of it lives in the renderer. Main only moves the two files. The answer is
the one text in the renderer written in English on purpose: it is read by another CLI, not by a
person, so it is not a message code and it is not translated.

**Claude only.** Codex gets no config: the two CLIs do not share an MCP configuration format on
the command line, and none of this has been tried against it.

Not done: a setting to refuse the tool, and any per-request confirmation in our own window. The
CLI asks about an unfamiliar tool itself, and a second gate of ours would ask about the same
thing in a different place. If a tab ever opens sessions nobody asked for, that is the moment to
add one.

## 2026-10-27 — The diff is PyCharm's, on `@codemirror/merge`, and it edits

The hand-rolled read-only unified table (`DiffView` + `lib/highlight.ts`) is replaced by
`@codemirror/merge`: the same CodeMirror, lezer grammars and palette the editor already ships,
about 10 KB of its own code, no workers. The user asked for "almost a full copy of PyCharm", view
plus edit: side by side by default, PyCharm's colours by kind with word-level marks, IntelliJ's
curved bands between the panes, `»` per change, F7/Shift+F7, folded unchanged lines, and an
editable right side.

**What stays the library's.** `MergeView` aligns the two sides with spacer widgets, so unchanged
lines always sit level and a band only curves where one side of a change is taller. IntelliJ
scrolls the two editors separately and the bands slant; that is not possible without forking the
library, and the library is kept.

**A large diff waits for a click** — numstat, rename-aware, against the same ref as the file
list, before any content is read (lockfiles, generated files, over 500 changed lines, over
512 KB). Peers learned this one the hard way.

**The save is the editor's save.** The checked write, autosave and conflict UI moved out of
`FileEditor` into `useCheckedFile` and both use it, rather than a copy that drifts. The
five-second re-read never writes over unsaved edits; a hidden diff tab with unsaved edits stays
mounted until they are on disk.

Rejected: `@pierre/diffs` (a second highlighter, a worker pool, reported leaks), Monaco.

## 2026-10-27 — The changes panel can show a tree, and it starts as a list

A list/tree switch in the «To commit» head, remembered as `layout.changesView`. **The default
stays `list`**: nobody's panel changes under them until they press the switch. The tree is
hand-rolled — `lib/changesTree.ts` groups, compresses single-child folder chains, sorts (folders
first, then files, case-insensitive with a raw tie-break) and derives a folder's all / some / none
from the same `checked` set the list uses, so commit and revert do not know which view picked the
files. No tree library: the candidates either had no checkboxes or brought a second rendering
engine.

Folded folders live in component state, not in settings: they describe this look at these
changes, and the paths stop existing once the files are committed.

## 2026-10-27 — Changes refresh on events, with a fallback poll only where nothing reports

The panel polled git every 4 s and a diff tab re-read every 5 s, for every session, while the app
already hears most of what moves a working tree: a claude turn ends (`Stop`, read by
`useWaitingPoll`), the window comes back, the app writes a file itself. Those now refresh at once
through one renderer bus, `changesInvalidated(path)`; any later writer (the file tree's own
operations) calls the same function.

**The poll stays only where it is the sole signal.** 30 s for an awake tab that cannot report a
turn end — codex reports its thread but no event per turn, a shell reports nothing, a claude tab
with its hooks off is already marked silent. 10 s while a tab is running, since edits land
mid-turn and the turn end only tells about the last of them. Nothing at all while every awake tab
is a reporting claude tab sitting idle. A codex turn end could be read from its notify call later;
it is not, because that call is about the thread today.

A Notification also refreshes: the person is about to look, and an agent stopped on a permission
prompt has usually written something already.

## 2026-10-27 — The file tree gets PyCharm's menu; main checks every path, links included

The tree had no context menu and main had no file operations beyond read, write and readDir.
The menu follows PyCharm's project view (issue 1). Decided along the way:

- **Paths are checked where they really are.** `isAllowed` compares resolved strings, which stops
  `..` but not a symlinked directory inside a project. The new operations resolve the parent of
  the entry (`entryWithin`) or the destination directory itself (`realWithin`) through
  `realpath` before comparing with the roots, and refuse a root as the thing operated on.
- **Nothing overwrites.** A taken name is a refusal; a copy takes PyCharm's ` copy` suffix. A
  move that collides is refused rather than renamed: a cut file that reappears as `x copy` would
  be a surprise.
- **Revert keeps its name.** The menu item is the changes panel's `changes.revert`, not
  PyCharm's «Rollback»: one operation, one key.
- **Show history compares with the working file.** The diff tab's right side is always the file
  on disk, so a commit's own patch (`hash^` against `hash`) is not something it can show yet.

## 2026-10-27 — A session opened by an agent is that agent's child, and the parent closes it

`open_session` made sessions nobody owned: when the work was done, the tabs stayed until the person
closed them by hand, and the list did not show which session had opened which.

Now the opened session records its parent, and the parent's agent gets the means and the duty:
`list_sessions`, `send_to_session`, `close_session`. The tool descriptions say when to close —
once the overall plan has nothing left for the child, not after its first answer.

**Agent closing is conservative.** Worktree removed only when clean, branch only when merged into
the parent's branch; anything else is refused, and `force` closes the tab but leaves the work on
disk. An agent that is wrong about «done» costs a stray worktree, never lost changes. The person's
own dialog keeps its free choice.

**The person closing a parent is asked.** The dialog lists the descendants with their uncommitted
files and ticks only the clean ones; the unticked ones move up a level instead of losing their
owner silently. Cascade-always was rejected: it loses a child's work. Orphaning without asking was
rejected: a child left without a parent has nobody to report to.

**`send_to_session` exists** although sessions already message each other: a child stuck on a
permission prompt in its terminal cannot read a message, only a keystroke.

**The child forks from the parent's branch,** not from the project's checkout: its work is merged
back into the parent, and that is also what «merged» is checked against when it is closed.

Limits — depth 3, 8 open children — stop a runaway loop of `open_session`; they are not tuned.

## 2026-10-27 — A project marks the window with its colour

Sessions were opened in the wrong project: every project looked the same once its tab was out of
sight. Each project now has a colour from eight muted ones, declared per theme as
`--project-<name>`.

Where it shows: a 3 px line along the top of the window, a cap on every project tab (full on the
one on screen, half on the rest), and a 6 % tint of the session list and the terminal tab strip.
Not the terminal, the diff or the accent: a project colour must never be read as added, removed or
a state. Painting the whole accent was rejected for that reason.

A new project gets the first colour no open project has; the tab's context menu changes it. A
project from before has no `color` and derives one from its path — stable, and nothing is written
on its behalf, so absent stays «never chosen».

## 2026-10-27 — A child session starts without its project on screen

A session opened through `open_session` used to wait for the person to open its project: a pty
starts when its pane mounts, and only the session on screen has panes. A parent working in the
background could not get a child running. The window now starts the child's pty itself, with what
the pane would have passed and no size — the pane re-attaches later, as it does after any switch.
Only for sessions an agent opened: a restored or a person's session still starts on first look,
which is what keeps a cold start from launching every agent at once.


## 2026-10-27 — The merge tab is a three-way editor, and its sides are named by meaning

The old tab listed each conflict as two `<pre>` blocks with Take / Keep both: no editable result, no base, so lines from both sides could not be combined (#25). It also labelled the sides with git's words, and during a rebase git's «ours» is the upstream: the person's own commit was shown as «Theirs» (#24).

**Layout.** PyCharm's: yours left, result middle, incoming right, an arrow per conflict on each side; the first arrow replaces the base with that side, the second appends. Not `@codemirror/merge`: `MergeView` has two panes, and three aligned panes with a shared conflict model did not fit it. Three plain CodeMirror views kept level by block spacers are about 300 lines and reuse the editor's theme slot and languages.

**The side panes show the merged file with that side's version of each conflict**, not stage 2/3 verbatim. Text outside conflicts is what git already merged, so the three panes align block by block with no diff of their own. The cost: a non-conflicting change from the other side also appears in «yours». Accepted — the panes exist to pick conflict content, and the result is what gets written.

**The result starts from the base**, as in PyCharm. A file written without diff3 markers has no base chunk, so main re-merges the three index stages with `git merge-file --diff3 --object-id` (no temp files) and the renderer matches its conflicts to the file's by their two sides; one that does not match starts empty.

**A half-done merge survives.** Save, and closing the tab, write unsettled conflicts back as their original markers, so the tab reopens where it was. «Settled» is an arrow or an edit inside the conflict; undo reverts that state along with the text.

**Labels come from the repository, not the markers**: `onto`/`head-name`/`REBASE_HEAD` for a rebase («Your commit <sha> <subject>», «main (upstream)»), the current branch and `MERGE_HEAD` for a merge. The whole-file buttons follow the same mapping (yours = `--theirs` during a rebase). The changes panel's own Take ours / Take theirs row buttons still use git's words; they belong to the panel and were not changed here.


## 2026-10-28 — Conversation search reads the journals on demand, without an index

Full-text search in the agents dialog scans the project's conversation files at query time. An index (SQLite FTS, a cache of extracted text) was not built: one project's conversations measured 80 MB and scan in 340 ms with a raw-line prefilter, while an index would need its own invalidation for journals that grow on every turn. Revisit if a project's store grows past what scans within a second. Scope is the conversations the dialog already lists, not every profile on the machine: a whole profile (1.4 GB) took 10 s.

## 2026-10-28 — The merge tab's base goes through temp files

The 2026-10-27 entry re-merged the stages with `git merge-file --diff3 --object-id` to avoid temp files. In a linked worktree, where every session lives, git 2.53 aborts on it with «BUG: repository.c:171: cannot reinitialize an already-initialized object directory» (exit 134), so the result pane started every conflict empty. The stages are now read with `git show :N:./path`, written to a temp directory and merged there; `tests/conflictInfo.test.ts` covers the linked worktree.

## 2026-10-29 — A lead reads its child's conversation, by byte cursor

A lead agent could open, list, type into and close its children, but could not see what they said or did except by asking them. `read_session` returns the child's conversation since a cursor as compact text, read from the conversation file the CLI already writes; prior art is Okena's `okena claude log <term> --cursor <session>:<offset>`.

**Cursor = `<conversation id>:<byte offset>`.** Both journals are append-only, so an offset makes each read O(new data); on a 63 MB conversation the first 20 KB page took 26 ms. The id is in the cursor because `/clear` moves a tab to a new file, and an old offset into it would land mid-line; such a cursor starts over and says so. Line numbers were rejected: counting them means reading from the start every time.

**Compact, not raw.** One line per event, tool results clipped to 300 chars, thinking left out; one answer at most 20 KB. A lead needs to know what the child did and where it is stuck, not the files it read — those it can read itself.

**Codex tabs are read too**, from the rollout file: the event types map one to one (`message`, `function_call`, `custom_tool_call`, their outputs), so it cost a `switch`, not a code path. Codex injects its environment and instructions as user messages; those are dropped by their leading tag.

**Same ownership rule as the other child tools**: only the asker's descendants, checked in the renderer against the state.

## 2026-10-29 — «Waiting» means a real block, and a permission prompt can be answered from the list

**Waiting.** `Notification` was registered with no matcher, so `idle_prompt` — raised a minute after every finished turn — rang a second time once the person had looked, and a `permission_prompt` that arrived after the person had already answered painted a working tab amber. The overlay now asks for `permission_prompt|elicitation_dialog|elicitation_url_dialog` only (Okena's matcher), and a notification rings only while the CLI's own state file says `waiting` or says nothing. Okena's PreToolUse/PostToolUse «back to working» hooks were not added: the state file already flips to `busy` when a prompt is answered, and PostToolUse would only arrive after the tool finished. Tabs whose CLI keeps no state file keep the old behaviour.

**Answering from the list.** Checked before designing, in the 2.1.312 binary and the hooks reference: the interactive CLI starts `PermissionRequest` hooks without awaiting them, alongside its own prompt, and the two share one claim, so the first answer wins and the other is dropped. That makes a waiting hook safe — nothing is held up, and nothing runs twice. The hook is a file-based loop (`ask` / `answer` files next to the other reports, 900 s wait), not a socket, to stay in `sh` like the other hooks. Refused at the hook: subagents (a background subagent's hooks are awaited, so waiting would stall it) and `AskUserQuestion`/`ExitPlanMode`. Only Allow and Deny; no «always allow», since a persistent rule belongs where the CLI shows what it adds. No desktop-notification buttons: Electron supports notification actions on macOS only. Known gap: nothing tells the hook that the prompt was answered in the terminal; the card hides on the CLI's state, the hook ends on `Stop`, a newer prompt or its own wait, and a click on a settled prompt is dropped by the CLI.

## 2026-10-29 — A new worktree is made ready: `.worktreeinclude`, repository scripts, a port block, trust

**`.worktreeinclude`, as ccmanager does it**, with `--directory` added so a listed `node_modules` is one copy rather than a file list past the 8 MB buffer, and heavy directories entered only when named: a broad `.env*` must not copy every `.env` under `node_modules`.

**The scripts file is `.claude-studio.json` at the root**, `scripts.setup` / `scripts.teardown`, the shape of emdash's `.emdash.json`. Superset's `config.local.json` overlay was not taken: nobody asked for per-person overrides yet, and a second file is a second thing to approve. Scripts are read from the project root, not from the new worktree — the root is what the person opened; the worktree's copy is what its agent may edit before teardown.

**Approval is by the file's sha256, kept in main** (`<userData>/worktree-scripts.json`), not in state.json: the renderer cannot mark a script approved except through the IPC that re-reads the file. Asked inside the Setup tab, not in a modal: the app has one modal slot, which the new-session window closes on success, and a session an agent opened may not be on screen at all — a tab waits until the person gets there.

**The port block is derived, not allocated** — emdash's formula. Nothing to persist or free; two worktrees can collide in 1000 slots, and that is accepted.

**Trust is carried over, not granted.** emdash (`packages/plugins/src/agents/impl/claude/trust.ts`) sets `hasTrustDialogAccepted` and `hasCompletedProjectOnboarding` for every workspace unconditionally. Here the key is written only for a worktree the app has just created, for a `claude` session, and only when the project root (or a parent) is already trusted in the same profile — the app repeats an answer the person gave about this repository, it never gives one. `hasCompletedProjectOnboarding` is not written: it is not what asks. Why it is needed at all: in Claude Code 2.1.312 (read in the installed bundle) the upward walk for trust stops at the cwd's git root, and a worktree is its own git root, so even a worktree nested in a trusted checkout asks again. The file is shared with running CLIs, so it is temp + rename, never truncated, left alone when it does not parse, and re-read when its mtime/size/inode changed under us.

## 2026-10-29 — Review comments from the diff go to the agent as one prompt, and are not saved

The person comments lines of a diff's new side and sends them all at once into the session's agent tab. Prior art: vibe-kanban's `ReviewProvider` (numbered `path:line`, code block, comment) and emdash's `<user_comments>` XML; the plain numbered form was taken — it reads the same to the model and to a person looking at the tab afterwards.

**Gutter click, not a context menu.** The diff has no context menu of its own, and a `+` beside the line number is the form GitHub, GitLab and both peers use. A selection widens it to a range.

**In memory, not in state.json.** A comment is a draft for the next prompt, usually sent within minutes. Kept across a restart it would point at line numbers of a file the agent may have rewritten meanwhile, and it would cost a schema step and a `migrate()` line for that. Revisit if comments are lost to restarts in practice.

**A sleeping agent is woken, not typed into.** Waiting for the TUI to be ready has no reliable signal for every agent (codex has no hooks); a paste typed before bracketed paste is on arrives as keystrokes and submits line by line. So the tab is woken and shown, the comments are kept, and the person sends again.

**One typing path.** The bracketed paste and the delayed Enter moved from `useAgentToolRequests` into `lib/agentInput` + `lib/agentSubmit`, used by `send_to_session` and by review comments alike.

## 2026-10-29 — PR and CI status: one GraphQL call per repository, answers held per upstream sha

Each session branch shows its pull request (number, open/draft/merged/closed) and the checks of its head commit, in the changes-panel head and as a small badge on the session row. Prior art: Okena (`okena-daemon-core/src/git_poll.rs`) polls only visible projects, skips the CI fetch while the upstream sha matches a settled one, and backs off on rate limiting.

**Data.** `gh api graphql` with one `pullRequests(headRefName:…)` alias per branch, not `gh pr list --head` per branch: one process and one API request per repository per refresh, whatever the number of sessions. The branch names go in as GraphQL variables, never into the query text. The head name is the upstream's remote name (`%(upstream:remoteref)`), which is what GitHub calls the PR head.

**When.** No new timers beside events: a write or a turn end (`changesInvalidated`), a PR opened from the app (`prStatusInvalidated`, forced, since the upstream did not move), focus and visibility, a session switch, a project switch. A 30 s interval runs only while some open PR has pending checks. Only the project on screen is asked about.

**What reaches GitHub.** Main keeps an answer per (repository, head) with the upstream sha it was taken for. A moved upstream always asks. Otherwise: pending checks are held 20 s, «no PR» 2 min (an agent may open one with its own `gh pr create`, after its push), settled checks 10 min. The strict «never re-ask a settled sha» was not taken: a merge or close on GitHub does not move the upstream, and the badge would say «open» forever.

**Failure is silence.** No `gh`, no GitHub remote, not signed in, rate-limited or any other failure: the directories are left out of the answer, the UI shows no badge, and asking pauses (30 min for a missing `gh` or remote, 10 min for sign-in, 5 min doubling to 60 for the rate limit, 2 min otherwise). `gh`'s «no GitHub remote» message also mentions `gh auth login`, so it is matched before the sign-in case. No toast: the feature is optional, and a toast per refresh would be noise.

**Not done.** GitHub Enterprise hosts (`gh api` defaults to github.com), a PR whose head is a same-named branch in someone else's fork is not told apart, re-runs of one check are listed as separate rows.

## 2026-10-29 — Linux release builds, and the sandbox left to the packages

A tag `v*` runs `.github/workflows/release.yml`: an AppImage and a .deb for x64, `SHA256SUMS`, attached to a GitHub Release; a manual run keeps the same files as workflow artifacts only. The build runs in an `ubuntu:22.04` container, because node-pty is compiled there and the glibc it links against is the oldest the packages start on; the 22.04 runner image is deprecated, the container is not. electron-builder's `npmRebuild` rebuilds node-pty against Electron's ABI, and the job requires node-pty from the packaged asar through the packaged binary and spawns a process, so a package that only works with a toolchain at hand fails the release. No arm64: node-pty is native, so it would need a cross-compiler or a second job on an arm runner, a doubled release path nobody has asked for yet. No macOS or Windows builds. No auto-updater: the site promises no network calls, and `publish: null` keeps electron-builder from writing an update feed.

**Sandbox.** The scripts set `ELECTRON_DISABLE_SANDBOX=1`; an AppImage started by a double click has no such environment, and on Ubuntu 24.04+ AppArmor denies the unprivileged user namespaces the Chromium sandbox needs. Nothing was added to the app: electron-builder 26 already covers both packages. The AppImage's `AppRun` probes `unshare -Ur true` and adds `--no-sandbox` only when that fails, and the .deb's postinst installs an AppArmor profile for the binary on Ubuntu 24.04+ (or makes `chrome-sandbox` setuid where namespaces are absent), so the .deb keeps the sandbox. Rejected: `app.commandLine.appendSwitch('no-sandbox')` in main — the zygote and its sandbox start before main's JavaScript runs, so the switch comes too late, and it would turn the sandbox off where it works; `--no-sandbox` in `executableArgs` — the same blanket loss, and a double-clicked AppImage does not read its desktop entry anyway.

## 2026-10-29 — Codex tabs get a state from codex's own hooks; no headless-terminal detector

**Codex has lifecycle hooks now (0.163).** Checked in the binary and its app-server, not taken from a report: `hooks/list` lists hooks passed as `-c hooks.<Event>=[…]` with source `sessionFlags`, next to the user's own; events include `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, `Interrupt`, `SessionEnd`; `SessionEnd`/`Interrupt` clamp a timeout to 3 s. So the hooks go in per launch, like `notify`, and `~/.codex` stays untouched. Superset/Paradev merge into `~/.codex/hooks.json` with an env guard; that was not followed — it is the user's file.

**Trust stays the person's.** Session-flag hooks are `untrusted` until reviewed; codex shows «Hooks need review» at startup and writes the trust itself (`hooks.state."<key>".trusted_hash` in the user's config — a `-c` copy of that record is ignored, measured). The alternatives were rejected: `--dangerously-bypass-hook-trust` lifts review for every hook in the run, and writing the trust record ourselves edits the user's config. Cost: one review screen on the first codex tab after this change, and again if the override text ever changes.

**No headless terminal per tab.** Measured with `@xterm/headless` 6.0.0 in node, 20 tabs, 120×40, a detector reading the screen every 100 ms: 0.9 MB RSS per tab with no scrollback, 3.6 MB with 1000 lines; 2.2 % of one core idle, 3.7 % at 20 KB/s per tab. Cheap enough, but it buys little: without per-CLI screen patterns it can only tell output from silence, which the pty stream already tells, and patterns for prompts of CLIs we do not ship break on their next release. Instead `busyIds` now listens to every pty's output in the renderer (main already sends it for background tabs too), so the output fallback works off screen. Revisit if a specific CLI with no hooks needs «waiting».

## 2026-10-29 — «Start them all» starts the agents a few at a time

Once «start them all» really started every agent (it used to start only the session on screen, the rest waited for a visit), sixteen CLIs starting in one second froze the desktop: load average 25, 12 GB in swap. Each CLI loads at full speed for its first seconds. The session on screen still starts at once; the others go two at a time with a 4 s gap (`START_AT_ONCE`, `START_GAP_MS` in `useStartupPolicy.ts`), sixteen tabs in about half a minute. A fixed gap rather than waiting for each CLI's SessionStart: that report is consumed by the status poll, and a gap needs no second reader.

## 2026-10-30 — Worktrees agents made: found, attributed to sessions, panels follow, cleanup

Measured on the owner's state: every session sat in the main checkout, so every row carried the PR badge of whatever branch the main checkout had (dagster: a merged PR on all eight). Agents had made 8 worktrees in dagster and 138 across 12 repositories of another project; the app saw none.

**Owner decisions.** (1) Studio discovers the worktrees agents make; agents keep working as they do, and Studio's own worktree creation stays. (2) A session's changes panel, file tree, diff and PR badge follow its worktree: the primary one by default, a switcher in the panel head when there are several, plus the main folder. (3) Cleanup: a bulk «remove merged» takes only safe worktrees (clean, merged, nothing unpushed) with their local branch, after showing the list; anything else one at a time, with a warning of what is lost; a live agent's folder is never removed.

**Attribution from transcripts, not `cwd`.** Agents run `cd <worktree> && …` per command and the recorded `cwd` stays the main folder, so tool-call inputs are read too. A main working copy counts only through `cwd`: its path prefixes every in-repo worktree and half of all commands. Tool results are not read: a printed `git worktree list` names every worktree.

**Primary = most mentions, not most recent.** The design said «most recent mention». On the owner's data that made a session's side worktree primary: 678 mentions of `.worktrees/mad-372` up to 10-26, then 9 of `dagster-wt-mad372-roi` on 10-29, and the owner expects `mad-372`. One look into another folder must not move the panels; the switcher covers a session that really moved. The latest mention only breaks a tie.

**Live guard has more than processes.** Live ptys and running claudes (their `sessions/<pid>.json`) catch an agent standing in a folder, but agents stand in the main folder. So the renderer adds every worktree the agent of a running session has touched (not only its primary: it may go back to any), and every session's own folder: a session's worktree is removed by «close session», which knows its teardown script, not from this view.

**Merged** is ancestry in the remote default branch or a merged PR (the existing `gh:branchPrs` lookup, by upstream). Not done: a branch squash-merged whose remote branch is gone has no upstream, so neither test sees it, and its commits are on no remote — it is not safe, and goes one at a time with the warning. `migrate()` needed no line for `Session.worktreeView`: projects and sessions pass through it whole; only settings are listed field by field.

## 2026-10-30 — The project on screen is told by colour, loudly

The owner kept mixing up project tabs: the colour was a 3 px line and a 6% tint, the active tab's tint was overridden by a later rule, and nothing read at a glance.

**Owner decision:** the current tab and the window take the current project's colour; neighbouring tabs keep their own. So each tab wears its own colour (a cap behind, filled at 50% on screen), and the tab strip stays neutral: the old line along the top of the window painted the current colour across every neighbour. The window: the sidebar tinted 12% with a 4 px bar down its left edge, its head 32% with the project's name at 16 px in place of «Sessions», the terminal tab bar 18% and a 2 px frame round the terminal.

## 2026-10-30 — A project's colour comes from its name

**Owner decision:** colours are generated from the tab name, within a sane palette. Eight fixed colours hashed from the path gave two of the owner's six projects the same blue and three more near-identical warm tones.

A derived colour is `oklch(L C hue)`: the hue from an FNV-1a hash of the name, L and C fixed per theme (`--project-l`, `--project-c`), so every derived colour is as muted as the eight that can still be picked from the tab menu. Two hues closer than 40° (or 300°/n with many projects) are pulled apart: projects are taken in id order, which no tab reorder changes, and one that lands too near a taken hue moves to the nearest free one. A picked colour counts as taken. New projects no longer get a palette colour written at open; «By name» in the tab menu drops a picked one. A rename recolours the project.

## 2026-10-30 — A session row names one worktree

**Owner decision:** one line under the session name: the primary worktree's branch, its PR badge, «+N more». Two lines of full paths plus a count made a row five lines tall: worktrees outside the repository folder show as absolute paths, and an audit session had touched 31. Paths stay in tooltips; the changes panel switcher and the ⎇ view list every worktree.

## 2026-10-30 — Session rows are not tinted

**Owner decision:** the sidebar's session rows stop taking the project's colour. The sidebar keeps its tinted head with the project name and the 4 px bar down its left edge; the list itself is the neutral surface.
