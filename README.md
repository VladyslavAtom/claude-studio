# Claude Studio

Desktop UI for running Claude Code and Codex sessions in parallel: projects in tabs, sessions in isolated git worktrees, diffs and terminals in one window.

![A session with a Claude agent at work](docs/img/screenshot-agent.png)

An agent in its own session, with the task it was started with. The same session, showing the diff of what changed:

![The diff of a changed file next to the changes panel](docs/img/screenshot.png)

## What it does

- **Projects are the top tabs.** Open a local folder or clone a repository; a folder inside a repository binds to its root.
- **Sessions are git worktrees.** A session gets a branch `claude/<slug>` off a chosen base in `<repo>/.worktrees/<slug>`, added to `.git/info/exclude`. Optional: a session can share the project directory.
- **Tabs inside a session.** As many agents, shells, files, diffs and merge views as needed, all in one worktree.
- **A conversation per tab.** Claude gets its own `--session-id`; Codex reports the thread it picked. Two agents in one directory never resume each other.
- **Agents are presets.** Command, arguments (`{session}`, `{name}`), environment, colour and order — editable in the settings; add your own.
- **Statuses and attention.** Working / waiting / idle / asleep, from Claude Code's and Codex's own hooks rather than from a transcript, with a notification and a sound. "Waiting" means a real block: a permission prompt or a question. A tab that cannot report says so.
- **Answer a permission prompt from the list.** A background tab blocked on a permission shows an Allow / Deny card under its session row; answering in the terminal still works, and the first answer wins.
- **A lead agent runs child sessions.** A Claude tab gets five MCP tools: `open_session` (a visible session with a worktree, a branch forked from the lead's and a first task), `list_sessions`, `read_session` (what a child said and did since a cursor), `send_to_session` and `close_session`. Up to 3 levels deep, 8 open children per session.
- **New worktrees ready to work in.** Ignored files listed in `.worktreeinclude` (`.env` and the like) are copied into a new worktree; a `setup` script from `.claude-studio.json` runs in its own tab after a one-time approval, `teardown` before removal. Each worktree gets a block of ports in `CLAUDE_STUDIO_PORT`, and Claude does not ask to trust the new folder again.
- **Sleeping tabs.** After N idle minutes the process is killed and the id kept; a click resumes the same conversation. Sleep by hand from the tab menu. After a restart, start every agent at once or leave them asleep.
- **One history for all agents.** Every Claude and Codex conversation recorded for the project's directories, including those started outside the application.
- **Changes and commits.** Uncommitted files with checkboxes, a side-by-side diff with per-change revert, commit from the panel, a generated commit message, revert to HEAD with a confirmation.
- **Review comments to the agent.** Comment lines in the diff and send them all to the session's agent as one prompt.
- **Branch work.** Push (`-u` on the first), `gh pr create`, rebase onto the base, merge of the base in, pull with a choice of strategy; conflicts are resolved in a three-way merge tab. The PR of a session's branch and its CI checks show on the session row.
- **Files and editor.** A file tree and CodeMirror 6 with Darcula-style highlighting; saves on a pause, atomically. Paths printed in a terminal are links.
- **Terminals.** xterm.js with WebGL, scrollback replayed on tab switch, search (Ctrl+F), Shift+Enter for a newline in an agent composer.
- **Themes and languages.** Dark and light, English / Ukrainian / Russian, both following the system until chosen. git terms are never translated.
- **State survives.** Projects, sessions and tabs are written to `~/.config/claude-studio/state.json` atomically, with backups and no silent overwrite of a newer version.

## Requirements

- Linux, X11 or Wayland. Developed on Ubuntu 24.04 / KDE Plasma. macOS: the code carries no Linux-only calls and `npm run dist` has dmg/zip targets, but nothing there has ever been run — treat it as untested. No Windows build.
- Node.js 22.5+ (`node:sqlite` reads Codex's index), git, and `gh` for the PR button.
- Claude Code and/or Codex CLI on PATH. The application starts them; it does not bundle them.

## Running

Download the Linux x64 build from [the latest release](https://github.com/VladyslavAtom/claude-studio/releases/latest): an AppImage, or a .deb for Ubuntu 22.04 / Debian 12 and newer. There are no macOS or Windows builds.

```bash
chmod +x Claude-Studio-*.AppImage && ./Claude-Studio-*.AppImage
# or
sudo apt install ./claude-studio_*.deb
```

The .deb installs an AppArmor profile so the Chromium sandbox works on Ubuntu 24.04+; the AppImage starts without the sandbox where AppArmor blocks it. The app does not update itself: download a newer release to update. `SHA256SUMS` sits next to the files.

From source, one command on Linux: clones into `~/.local/share/claude-studio`, builds, adds `claude-studio` to `~/.local/bin` and the application menu, starts the app. Run it again to update.

```bash
curl -fsSL https://raw.githubusercontent.com/VladyslavAtom/claude-studio/main/install.sh | bash
```

By hand, from a clone:

```bash
npm install
npm run rebuild              # node-pty against the Electron ABI
npm run dev                  # development, renderer HMR
npm run build && npm start   # production build
npm run dist                 # AppImage and .deb (Linux) or dmg/zip (macOS) in release/
./claude-studio.sh           # build if needed, start in the background, --help for the rest

npm run typecheck            # tsc -b: main and renderer are separate projects
npm run lint                 # eslint: react-hooks and the process boundary
npm test                     # vitest
npm run smoke                # worktrees, pty, IPC, painting — on a throwaway repository
node tools/shot.mjs [agent]  # the screenshots above, on a throwaway repository
```

Ubuntu 24.04+ restricts unprivileged user namespaces through AppArmor, so the scripts set `ELECTRON_DISABLE_SANDBOX=1`. An AppArmor profile on the Electron binary is the alternative.

## How it works

```
src/main/       Electron main: window, IPC, git (execFile), node-pty, state, agent hooks and tools
src/preload/    contextBridge → window.api (typed)
src/renderer/   React + xterm.js, diffs, editor, modals
src/shared/     types and channel names, i.e. the IPC contract
```

PTYs live in main and are addressed by `terminalId`; `pty:start` is idempotent, so switching tabs never duplicates output. git is called through one spawn point with a cleaned environment, and every user-supplied path goes through `literal()` at a pathspec position. Main writes no interface copy: a message travels to the renderer as a code and becomes a sentence there.

[docs/architecture.md](docs/architecture.md) — how it works · [docs/decisions.md](docs/decisions.md) — why · [docs/performance.md](docs/performance.md) — measurements · [docs/open-questions.md](docs/open-questions.md) — what is open · [CONTRIBUTING.md](CONTRIBUTING.md) — patches.

## Status

A personal tool, published in case it is useful: 0.1.0, one developer, one Linux desktop. The parts that have never run anywhere else — the AppArmor workaround, the Codex index, the node-pty rebuild — are the ones most likely to break for you.

MIT.
