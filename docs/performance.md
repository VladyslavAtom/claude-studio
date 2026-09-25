# Performance and the machine policy

## The policy: what may be run, and how

This project was built on one loaded desktop machine, and the rules below come from that. They
are a working agreement with the agents editing this repository, not a requirement for anyone
building it: on a machine with memory to spare, run whatever you like.

1. **Builds, smoke runs and screenshot runs are started by the person, not by an agent** — only
   on request. An extra Electron is the expensive part, not the compiler.
2. If a build is needed anyway: `npm run build:light` — cores 0–3, `nice -n 15`, `GOMAXPROCS=2`.
3. `npm run smoke` does not rebuild the project and runs on cores 0–2.
4. Everything else that may take a noticeable amount of time (`npm install`, `tsc`, `eslint`,
   `vitest`) is run under `taskset -c 0-3 nice -n 15`.
5. `pkill -f "<path>"` is dangerous: the pattern matches the command line of the script running
   it, and it kills itself (observed several times, exit code 144). Use `pgrep` + `kill` by pid.
6. `timeout` kills the wrapper but not always the child: after measurements, check with `pgrep`
   (a leftover `llama-cli` was spinning at 10 % of a core and holding a deleted model file).

Neither the pre-commit hook nor CI runs the build or the smoke: there it is only typecheck, lint
and tests.

## Why a loaded machine freezes

The cause was never the CPU but memory: with 29 of 30 GiB taken and no swap, PSI memory avg300
sat at 34.6 %. Any spike — a build, a second Electron — triggers reclaim, the page cache is
flushed out, and the whole system stalls rather than just the culprit. That is where the policy
above comes from: doing without the extra process helps more than limiting its cores.

## The load recorder

`tools/cpuwatch.sh` → `/tmp/claude-studio-cpu.log`. It polls once every 2 seconds, and only
processes above the threshold make it into the log; every line carries PSI and the available
memory. This is the only way to take a spike apart after the fact — in the moment of a freeze
there is no longer anything to be done interactively.

## Measurements: generating a commit message

The same diff, by different means:

| means                                       | time   | memory                                          |
| ------------------------------------------- | ------ | ----------------------------------------------- |
| service session (warmed up, second request) | ~0.8 s | the process stays up, put out after 15 min idle |
| `codex exec` + `--output-last-message`      | 3.0 s  | none                                            |
| `claude -p --model haiku --effort low`      | 8–9 s  | none                                            |
| `claude -p` as it was                       | 9–23 s | none                                            |

The time floor for the Claude CLI is about 5 s even on an empty request: that is the startup of
the CLI itself. The rest is eaten by the length of the answer, which is why the prompt asks for
the text of the message only, with no preamble and no reasoning.

The warmed-up service session was chosen: 4 seconds after the application starts, a trivial
request is sent into it, so that by the first press of «✨ Message» the process is already
ready.

## A local micro-model: tried and rejected

- **Qwen2.5-Coder-0.5B Q4** (469 MB) did not manage even to load within 15 s: with a gigabyte of
  memory available the page cache is flushed out and the file is read again on every call.
- A resident `llama-server` would have given ~1 s, but would have held 600–700 MB permanently —
  see the section on memory above.
- **SmolLM2 135M/360M** are out for a different reason: they have no Russian in them.

## Measurements: an unlimited scrollback in xterm

Measured here with node (same V8 as the renderer), for the choice of what «no limit» is spelled
as when it reaches xterm — its line list is a plain `new Array(maxLength)`:

| `new Array(n)`  | allocation | 100k element writes | what V8 does           |
| --------------- | ---------- | ------------------- | ---------------------- |
| 1 000 000       | 6 ms       | 22.7 ms             | fast, really allocated  |
| 33 554 432      | 223 ms     | 0.7 ms              | fast, ~256 MB of holes  |
| 33 554 433      | 0.0 ms     | 77.6 ms             | dictionary mode         |
| 4 294 967 295   | 0.0 ms     | 73.2 ms             | dictionary mode         |

The boundary is exactly 2^25. Below it the array is allocated for real — 8 bytes per slot, paid
up front, empty. Above it nothing is allocated and each element costs a hash lookup: ~0.7 µs per
line stored instead of ~0.04. That is why unlimited is xterm's own maximum and not a large finite
number: the per-line cost is far below what parsing and painting that line costs anyway, and it is
paid only for lines that actually arrive.

## What has already been optimised

- the path to the conversation file is **cached**: all the `~/.claude*` profiles used to be
  rescanned for every tab every 4 seconds;
- the pty scrollback is kept as **an array of chunks**: it used to be rewritten whole on every
  chunk;
- «start all» wakes only the agents, not the shells.
