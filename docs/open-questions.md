# Open questions

A live list: whatever is closed is deleted from here, and the decision moves into
[decisions.md](decisions.md) as its own entry.

## The application

- **Closing a project asks nothing.** It no longer loses anything — the project is set aside whole
  and comes back with the folder — but a project with running agents closes on one click, and the
  ptys are killed without a word.
- **An existing branch in the new-session window** silently ignores the chosen base — there is no
  warning.
- **A minimized window queues its bells.** The poll does not run while `document.hidden`, and the
  events wait on disk, so they all ring at once when the window comes back. That follows from
  "an event must not be lost"; the older transcript read silently collapsed them instead.
- **`sandbox: false`** on the window remains. Turning it on requires checking node-pty and
  preload.
- **Two writers race for the clipboard.** `clipboard:write` writes through Chromium *and* then
  through `wl-copy`. Under Wayland the first was measured to never reach the compositor, so it is
  at best useless and at worst an ownership fight with the second. Not removed while an
  intermittent fault is being chased — one change at a time, or the next observation cannot be
  read.
- **`wl-copy` inherits main's whole descriptor table.** Measured on a live daemon: the GPU
  device, the Chromium caches, `Session`/`Local`, inotify handles and — the part that matters —
  `/dev/ptmx`, the master side of pseudo-terminals. Chromium's descriptors are not marked
  close-on-exec and Node offers no way to close them in the child, so a clipboard helper that
  outlives a tab keeps that tab's pty device alive. No cheap fix is known; a helper that closes
  its own descriptors before `exec` would be one.
- **The terminal scrollback is not written to disk.** How much is kept is now a setting
  (`settings.terminal.scrollbackLines`, unlimited by default — see
  [decisions.md](decisions.md)), but it is memory only, in both copies: closing a tab or quitting
  the application drops the lot, however long the limit was. Nothing offers to save a session's
  output anywhere.
- **The first request to the service session** once failed to fit into the timeout (the second
  took 0.8 s). The likely cause has been removed (the model was repeating the template verbatim
  between the markers and the parser was catching the echo), but the check has not been repeated.
  Warming up at startup takes the edge off, yet does not prove that the cause is gone.

## The multilingual interface

Decided: English by default, plus Ukrainian and Russian. Not done. The rule "git terms are not
translated" must be applied to each locale separately, and "the same action is named the same
way" — within a locale.

## Tooling

- **The prettier run** was not done: it would rewrite ~13 thousand lines. A separate commit.
- **`noUncheckedIndexedAccess` (67 errors) and `exactOptionalPropertyTypes` (23)** have been
  measured and switched off — see [decisions.md](decisions.md). The edits are mechanical, but
  there are many of them.
- **59 linter findings, all lowered to warning**, otherwise pre-commit and CI would have been red
  from day one. The breakdown: `react-hooks/refs` — 38 in 11 files (access to `.current` during
  the render, worst of all in `ui/Menu.tsx`, `ui/overlay.ts`, `TerminalPane.tsx`,
  `FileEditor.tsx`); `react-hooks/set-state-in-effect` — 10 in 8 files;
  `react-refresh/only-export-components` — 8 across four providers in
  `src/renderer/src/state/`; `exhaustive-deps` — 1 (`state/selectors.ts`, `state` missing). The
  rules are to be returned to `error` as the files are cleaned up.
- **The `exhaustive-deps` suppression in `TerminalPane.tsx:300`** hides a real violation: the
  effect is missing `command`, `cwd`, `env`, `kind`, `onExit`, `sleepable`. This is exactly the
  class of errors (a stale closure around the pty lifecycle) the linter was brought in for — to
  be taken apart on its merits, not suppressed again.
- **There is no type-aware linting** — typescript-eslint does not work with TypeScript 7. To be
  revisited once
  [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)
  is closed. For now nothing checks `no-floating-promises` and `no-misused-promises`.
- **The tests cover only pure logic.** IPC, pty, git calls and React components are not covered:
  they need either a temporary repository, or Electron, or jsdom.
- **The pre-commit hook lives in `.git/hooks/`** and is therefore not cloned. For it to travel
  with the repository it has to be moved to `.githooks/` with `core.hooksPath` set.

## The machine it is developed on

- **Memory, not CPU, is what a build costs here** — see [performance.md](performance.md). Until
  the development machine has swap or zram, a build and a running application together risk a
  freeze, which is why builds are started by hand.
- **The agents' MCP servers** are brought up through `npx …@latest`: several hundred megabytes
  per session and noticeable CPU at startup. Installing them globally and naming the command
  directly in the config would remove the spike.
