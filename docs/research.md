# Research — what other projects do

Notes on prior art: someone else's code, read to see how they answered a question we also have.
Appended to, not rewritten. Each claim says where it comes from — read in their source, taken
from their docs, or measured here — because the three are worth very different amounts.

---

## Nimbalyst — running coding-agent CLIs in parallel

Read 2026-07-26. `github.com/nimbalyst/nimbalyst`, MIT, active (last push the day it was read).
The identity was confirmed rather than assumed: it is the rename of `stravu/crystal` — crystal's
own description says so, and `crystal-run.sh` is still in the repository root. Everything below
marked **[code]** was read at commit `59ab7eaf8c995840a37766c65a09307506b87a2b`; **[measured]** is
something checked on this machine; anything else is theirs to claim, not ours.

It is the closest thing to this project we have found: a desktop app running Claude Code and Codex
for the same purpose. It answers three of our four questions differently, and the fourth it avoids.

### They run agents two ways, and only one is comparable

**[code]** Claude runs either in-process through the Agent SDK — no pty, every event available
programmatically — or as a real interactive CLI in a pty. Only the second is comparable to us.
**Codex is never given a pty**: it is driven headless over JSON-RPC (`codex app-server --listen
stdio://`), so the conversation id arrives in the `thread/start` response and the end of a turn
is a `turn/completed` notification.

That is worth stating plainly: for Codex they did not solve the problems below, they arranged not
to have them. The price is the thing this project exists for — a real TUI the person types into.

### Which conversation a tab is in

**[code]** Same start as ours: `claude --session-id <uuid>`, the app choosing the id. On relaunch
they recompute the transcript path deterministically (`<configDir>/projects/<cwd with non-alphanumerics
replaced by `-`>/<sessionId>.jsonl`) and switch to `--resume` if that file exists — because the CLI
refuses to reuse a `--session-id` whose transcript already exists.

**[code] `/clear` is not handled at all.** The command is classified as "output only — the result
is already in the transcript", and there is no conversation-id-changed path anywhere in their
watcher stack. Their model assumes the pinned id stays valid for the life of the process.

So the defect that started our hook work exists there too, unfixed. An absence is a finding: it
means the case has not been considered rather than considered and dismissed.

### When the agent has finished — their mechanism is better than what we had

**[code]** They do not use `Stop`/`SubagentStop` hooks. Two layers:

1. **A per-process state file** — `~/.claude/sessions/<pid>.json`, undocumented, written by the CLI
   itself, carrying `status: busy | idle | waiting`. They poll it. This is immune to the
   subagent-ambiguity problem _by construction_: the question is not "was the last `end_turn`
   ours" but "has the process actually gone idle", and an in-process Task subagent never makes the
   process idle.
2. **A subagent tracker** over the API traffic they tee (see below), reconstructing Task boundaries
   from the only signal raw traffic gives: a parent turn ending in a `tool_use` block named `Task`
   opens an in-flight window keyed by tool-use id; the matching `tool_result` closes it.

**[code]** The notification, the sound and the analytics fire only on the state file's transition
to idle. Their comment says why, in as many words: so that sub-agent turn ends do not notify.

That is categorically stronger than reading `stop_reason: end_turn` out of a transcript, which is
what this project did before the hooks and which produced exactly the false ring their comment
describes.

**[measured] The file is real, and it holds more than they use.** On this machine, for a live
session: `sessionId`, `status`, `name`, `nameSource`, `cwd`, `pid`, `entrypoint`, `kind`,
`peerProtocol`, `bridgeSessionId`, `statusUpdatedAt`, `version`. One file would answer the
conversation, the turn state and the title at once.

**[measured 2026-07-27] A plain CLI does write it — the earlier entry here said the opposite, and
was wrong.** What it recorded ("we could not make it appear for a plain CLI in a pty", from a
single example carrying `bridgeSessionId`) was three failed reproductions, not a property of the
CLI. Read again on the same machine: three of the user's own tabs had a file each, at the same
moment, all `"entrypoint": "cli"`, `"kind": "interactive"`, and **none** with a `bridgeSessionId`.
The full shape, 2.1.220: `pid`, `sessionId`, `cwd`, `startedAt`, `procStart`, `version`,
`peerProtocol`, `kind`, `entrypoint`, `name`, `nameSource`, `status`, `updatedAt`,
`statusUpdatedAt`. `status` flips busy→idle within a second of a turn ending, and the file goes
away with the process.

**[measured] What is still not known is why some sessions have no file.** A `claude` driven by
hand in a throwaway pty produced none while the user's three real tabs all had one, under the same
profile, at the same moment. Nothing was found that distinguishes them. So the absence of a file
is an ordinary case, not a fault — which is how we read it (see `docs/architecture.md`).

**[code, from the shipped 2.1.220 binary] The status set is `busy | shell | idle | waiting`**, and
each has a definite meaning in the CLI's own code, not just in Nimbalyst's expectations:

- `waiting` is set whenever the CLI is blocked on a person, and it writes alongside it a
  `waitingFor` naming which — `"sandbox request"`, `"input needed"`, `"dialog open"`,
  `"worker request"`;
- `busy` is "a turn is being worked on", `idle` is neither of those;
- `shell` is a command of the CLI's own, and **the CLI's own session list counts `busy` and
  `shell` alike as "working"**, and `waiting` as "blocked". That is what our mapping follows.

This is read out of a minified single-file bundle, so it is `[code]` of a weaker kind than reading
a repository — but it is the shipped artefact, which is the thing that actually writes the file.

Also unverified: their comment that `claude ps` reads the same file. There is no `ps` subcommand
in 2.1.220 — the invocation is taken as a prompt.

### The title

**[code]** Not from the transcript. They inject an instruction via `--append-system-prompt` telling
the model to call their own MCP tool early in the first turn. The fallback, when no model call is
available, is a host-side heuristic over the first user prompt: strip leading `/`-commands and
`#`-notes, cap at 8 words or 48 characters.

### How they see the conversation at all

**[code]** A loopback HTTPS proxy: they point the CLI at it with `ANTHROPIC_BASE_URL` and tee the
CLI's own `/v1/messages` SSE traffic, reassembling it into a rich transcript. That gives them far
more than a transcript file does — and it is a much heavier mechanism than reading a JSON object
on stdin, with correspondingly more to break. It works only because they control the environment
of the child process they start.

### Attribution across concurrent tabs

**[code]** Everything is keyed by their own session id — maps in the file watcher, the subagent
tracker, the turn accumulator; the state-file watcher closures are each bound to one pid at
construction. Nothing is inferred from which terminal is focused. Same conclusion we reached: the
tab must be named by the launcher, never guessed afterwards.

### What we took, and what we did not

- **Taken, for one question only: the per-process state file** (2026-07-27, after the correction
  above). It answers "what is this agent doing right now", which the hooks cannot: they report
  events, and between two of them the tab had nothing but its own output to judge by — which is
  how an agent thinking in silence looked idle and an agent drawing a spinner looked busy. It is
  still undocumented and its schema still floats with the CLI version, so it is read as somebody
  else's file: a shape or a status word we do not recognise is "no answer", and the tab falls back
  on its output. It is **not** used for the bell or for the conversation id — the hooks answer
  both, and one signal cannot be trusted while a second is allowed to disagree with it.
- **Not taken: the API proxy.** We need the end of a turn and an id, not a reconstructed
  transcript. Redirecting a CLI's API traffic through our own process to obtain them would be a
  large mechanism, and a lot of surface, for something the CLI will tell us if asked.
- **Confirmed by their absence: `/clear`.** Two independent projects pinning `--session-id` and
  neither following the id afterwards suggests the failure is easy to miss rather than obvious,
  which is an argument for the regression tests around it rather than against the fix.
- **Their framing is worth keeping**: ask the process what state it is in, rather than infer state
  from what it wrote. Our `Stop` hook is the same idea served by a documented channel.

See `docs/decisions.md` for what we chose and `docs/architecture.md` for how it works here.
