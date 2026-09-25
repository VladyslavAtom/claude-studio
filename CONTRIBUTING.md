# Contributing

This is a one-person tool that was published because it might be useful to somebody else. Issues
and pull requests are welcome; nothing here is a process, it is what makes a patch easy to accept.

## Before a pull request

```bash
npm install
npm run rebuild     # node-pty against the Electron ABI
npm run typecheck   # tsc -b: main and renderer are separate projects
npm run lint        # eslint: react-hooks and the process boundary
npm test            # vitest
```

CI runs the last three. The build and the smoke run are not in CI and are not expected of a
contributor: they need a real Electron and a display.

## What the code expects

[CLAUDE.md](CLAUDE.md) is the whole of the conventions, and nearly every rule in it stands on a
bug that has already happened here. The three that catch people first:

- **Interface strings live in locale dictionaries**, never in components: English is the source of
  truth (`src/renderer/src/i18n/locales/en/`), and the same key has to exist in `ru` and `uk` or
  `tsc` fails. git terms — push, pull, rebase, worktree, PR — are not translated in any locale.
- **The main process writes no interface copy.** A message travels to the renderer as an
  `AppMessageCode` with parameters; a tool's own stderr passes through verbatim as detail.
- **Channel names come only from `src/shared/channels.ts`**, and every user-supplied path goes
  through `literal()` at a git pathspec position.

Pure logic belongs in a module that can be imported and covered by a test — that is a reason to
export a function, not a reason to skip the test.

## Documentation

A change of behaviour is an edit to [docs/architecture.md](docs/architecture.md) (present tense,
how it works now) and, when there was a decision to record, a dated entry appended to
[docs/decisions.md](docs/decisions.md). Not a new file in the repository root.

## Language

The project writes about itself in English: code, comments, docs, tests, issues, pull requests.
The commit messages in the history are Russian — they address one author; an English commit
message in a pull request is fine and will not be rewritten.

## Scope

The application starts the agent CLIs, it does not bundle them and does not wrap their protocols.
A feature that needs Claude Code or Codex to behave differently belongs in those projects; what
belongs here is what a window around them can do — tabs, worktrees, diffs, the state on disk.
