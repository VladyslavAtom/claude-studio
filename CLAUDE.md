# Claude Studio — conventions

The rules below were derived from reading this code, not decided in advance: nearly every one
of them stands on a mistake that has already been made here. Where that is so, the reason is
given — a rule without a reason gets repealed within a month.

## Working language

**Everything the project writes about itself is in English:** code comments, JSDoc, this file,
`docs/`, `README.md`, test names, and the reasoning inside a changelog. One language for the
record means a reader never has to know two, and a comment never has to be translated before it
can be trusted.

Two deliberate exceptions:

- **The interface is multilingual** — that is a product decision, not a documentation one. UI
  strings live in locale dictionaries (§1).
- **Commit messages are Russian.** They address one author, not the record.

A comment may quote a Russian UI label verbatim inside «…» — that is a citation of what is on
screen, not prose. Translate the sentence, keep the label: `«запустить всех» is about agents`.

## Where to read next

- `docs/architecture.md` — how it works now (present tense, no history).
- `docs/decisions.md` — what was decided and why, as dated entries; appended to, never rewritten.
- `docs/performance.md` — measurements and the rules for loading this machine.
- `docs/open-questions.md` — what is still open.
- `docs/research.md` — how other projects answered a question we also have, and what we took from
  them. Each claim says whether it was read in their source or measured here.

A new decision is an entry in `docs/decisions.md` plus an edit to `docs/architecture.md` — not a
new file in the repository root. A filename with a date in it is stale the next day, and the
truth ends up split across two places.

## Machine policy

The first two rules are local to the machine this is developed on — one desktop with no memory to
spare (see `docs/performance.md`); they are an agreement with the agents working in this
repository, not a requirement for building the project elsewhere.

- **Builds, screenshots and smoke runs are started by the user, not by an agent** — they load the
  machine. Anything heavy goes through `taskset -c 0-3 nice -n 15`.
- Before a commit: `npm run typecheck`, `npm run lint`, `npm test`. The pre-commit hook runs the
  same three.

---

# 1. Interface language

The interface is multilingual: **English is the default**, plus Ukrainian and Russian. Strings
live in locale dictionaries, never in components.

### git terms are never translated

**push, pull, fetch, merge, rebase, cherry-pick, commit, stash, upstream, remote, HEAD,
worktree, PR** stay English in every locale.

Why: these are the names of operations, not descriptions of actions. Translating them («влить»,
«перенос коммитов») breaks recognition — someone who knows git looks for the familiar word and
gets a paraphrase. Worse, the paraphrase is inexact: Russian «отправить» fits both push and PR.

Right:

- en: `Push branch`, `Pull — update the project`, `Merge "feature" into current`
- ru: `Push ветки`, `Pull — обновить проект`, `Merge «feature» в текущую`
- uk: `Push гілки`, `Pull — оновити проєкт`
- a gloss in the locale's own language may sit beside the term, in brackets or in a tooltip

Wrong: translating the operation itself, or rendering `remote` as Russian «удалённая», which
also reads as "deleted".

Exception: when the subject is a directory or a file rather than an operation, name the thing in
the locale's own words — the user is choosing a place, not issuing a command.

### The same action is named the same way

The project menu and the session branch menu are about the same operations. An item that does
the same thing must use **the same dictionary key** and sit in the same position. Two keys for
one operation is a defect: the wordings drift apart at the first edit.

Dialogs shared by both menus live in one component (`PullChoiceModal`, `RenameBranchModal`)
rather than being copied.

### Adding a string

1. `i18n/locales/en/<area>.ts` — English is the source of truth; the file is `as const`.
2. The same key in `ru` and `uk`; both are annotated against the English type, so a missing key
   fails `tsc` inside the file that is missing it.
3. A key is `area.key`, and **only the first dot splits**: `settings.tab.agents` is the key
   `tab.agents` in the area `settings`.
4. Plurals are an object `{ zero?, one, few?, many?, other }`. ru and uk fill
   `one/few/many/other`, and every teen goes to `many`. `zero` is not grammar — it is the "none
   at all" wording, and it wins over the rule.

**A sentence is never assembled with `+`.** Concatenation loses the literal type and takes the
placeholder checking with it. Text around an inline `<code>` becomes two keys, `…before` and
`…after`, and **each segment carries its own spaces** — punctuation goes where each language
wants it.

**Not localised:** LLM prompts (`serviceAgent.ts`, `defaultCommitMessage.prompt`) — they steer
the text of commits, not the interface; the transliteration table in `lib/util.ts` — that is
data; git's own output — those are git's words.

---

# 2. Process boundaries

`src/main` (Node) · `src/preload` (the bridge) · `src/renderer` (browser) · `src/shared`.
The boundary is enforced by the compiler: `tsconfig.node.json` and `tsconfig.web.json` hand out
different `lib` and `types`. If a test or a module suddenly drags DOM types into the node
project, that is the signal that a pure function is living in the wrong file — which is how
`moveItem` moved from `lib/dnd.ts` to `lib/util.ts`.

### IPC

- Channel names come **only** from `src/shared/channels.ts`. Both sides index one table, so a
  rename cannot typecheck on one side only.
- Preload owns no structural types: anything shared lives in `src/shared/types.ts` and is
  imported by main _and_ preload. Otherwise the two shapes drift and both still compile.
- A handler is one line. Side effects — registering a root after a worktree is created — belong
  to the function they are part of, not to the handler.

### Main writes no interface copy

The main process does not know the locale. A message we authored comes back as a **code**
(`AppMessageCode`) with parameters, and the renderer turns the code into a sentence. A tool's
raw stderr passes through as detail — it is untranslatable and useful verbatim.

Exhaustiveness of the mapping rests on `Record<AppMessageCode, …>`. **A `switch` with a
`default` is banned here**: it compiles and silently shows the user a code instead of a sentence.

---

# 3. Operation results

```ts
{ ok: false, code, params?, error? }    // error is what the tool said
{ ok: true,  output?, warning?, code? } // warning is success with a caveat
```

**`error` means it failed.** "The worktree is gone but the branch survived" is `ok: true` with a
`warning`; it used to travel in `error`, and the user was told about a failure that never
happened.

The full move to a discriminated `Op<T>` has not been made — it rewrites every call site in the
renderer. That is an entry in `docs/open-questions.md`, not a licence to invent more shapes.

---

# 4. git

Two invariants, both standing on a reproduced loss of data:

1. **Every user-supplied path goes through `literal()`** at every pathspec position. git treats a
   pathspec as a glob: reverting `case[2].json` also wiped `case2.json`.
2. **Every process launch goes through the shared `run()`/`git()` wrapper**, never through a
   fresh `execFile`. The wrapper carries the buffer policy, the timeout and the cleaned
   environment. A hand-rolled copy for `gh` bypassed `cleanGitEnv()`, and a PR could be opened
   against the wrong repository.

Branches and refs are not positional arguments to be passed unchecked: a name beginning with `-`
parses as an option. A clone address is validated before the spawn (`ext::sh -c …` makes git run
a command).

---

# 5. State on disk

`~/.config/claude-studio/state.json`, mode `0600` — it holds agent env values, i.e. tokens.

- A corrupt file is **never replaced with an empty one**: `.bak` first, then `.bak2`, then the
  file is moved aside as `state.json.corrupt-<ts>` and never deleted. Otherwise the 400 ms
  autosave overwrote both the file and its backup — two saves and the projects were gone.
- A version **newer than ours** blocks writing entirely. If we cannot understand it, we do not
  destroy it.
- The schema changes by adding a step to `MIGRATIONS`; `CURRENT_VERSION` must equal
  `STATE_VERSION` in `shared/types.ts`, and that is asserted at startup.
- `migrate()` lists settings fields **by name**, so a new optional setting that is not named
  there is silently dropped on every load. Added a field? Add the line.
- Absent is not the same as default. `locale: undefined` means "the user has never chosen, follow
  the system"; writing `'en'` there loses that distinction forever. `theme` works the same way.

Atomic write is tmp + rename within the same directory. Permissions and a symlinked target are
preserved: editing `claude-studio.sh` through the editor used to strip its `+x` bit, and the
script stopped running.

---

# 6. Processes and lifecycle

- `kill()` returns when the signal is sent, not when the process dies. That is why a pty carries a
  generation and a killed one is marked discarded: otherwise a late `exit` from the old process
  puts out a freshly started terminal holding the same id.
- **A timeout must cancel the work, not merely stop listening.** A timed-out turn of the service
  agent stayed alive and its answer was delivered to the next request — the commit message
  described a different diff. Tag the request _and_ `stop()` it, both.
- A hidden pane reports no size. `FitAddon` on a `display:none` parent returns 80×24, and that
  went to a live pty as a SIGWINCH, mangling the TUI of background agents. "Size unknown" is an
  absent field, not a guessed value.

---

# 7. Renderer

State is one reducer (`state/appReducer.ts`) plus providers; actions are hooks under `hooks/`.
`App.tsx` is providers and layout, not logic.

- **Actions carry ids, never objects.** A modal or a long poll holds a snapshot from the moment it
  started; applying it verbatim resurrects whatever changed in between.
- **Do not add a timer where an event already exists.** A tab's name was polled 240 times at 20 s
  intervals, after which tracking died for good — which is why a stale name hung around. The read
  now hangs off the turn-end detection that already runs for every live tab.
  Note the trap: a pane is mounted only for the active session, so "an event from the tab" cannot
  be taken from its output — background sessions emit nothing.
- **Racing responses.** Any async work in an effect needs cancellation (an `alive` flag), or a
  request token when the call does not come from an effect. The answer for the previous project
  arrives after the new one.
- **A busy flag belongs in `try/finally`**, or one rejected IPC call disables the button forever.
- **"Loading" is not "empty".** Give loading its own state; a `null` that means both lies to the
  user about an empty folder that is in fact unreadable.
- **`eslint-disable react-hooks/exhaustive-deps` is banned.** All three suppressions that existed
  were covering a real cycle between callbacks; the cure is breaking the cycle, not silencing the
  rule. The one that survived longest was hiding a stale closure around the pty lifecycle — the
  exact bug class the linter was installed for.
- Assigning to a ref during render belongs in an effect. That ref feeds the save path, and an
  abandoned concurrent render would write discarded state to disk.

### Shared primitives

Modal, menu, inline rename, click-outside, the git-action wrapper — one of each, in `ui/`. There
were 12 copies of the modal backdrop and 5 of click-outside; behaviour drifted along with the
copies. A new dialog goes through `ui/Modal`, which is also where the roles, the focus trap, the
focus restore and the Escape stack live (the innermost overlay closes first and swallows the key).

---

# 8. Styles and themes

- `styles.css` is nothing but an `@import` list; rules live per area under `styles/`.
  **Import order is behaviour**: there is no `!important` in this project, and specificity
  conflicts are resolved by source order.
- **A colour is a role-named token**, declared for every theme in `styles/tokens.css`. No literal
  belongs anywhere else: a name like `--grey-dark` becomes a lie in a light theme, so names
  describe roles — surface, text, line, accent, state.
- Themes are `dark` and `light`; the choice is `system | dark | light`, resolved in the provider
  (`theme/index.tsx`) and applied as `data-theme` on `<html>`. A component receives the already
  resolved theme; calling `matchMedia` or reading `data-theme` back out of the DOM is banned —
  there is one source.
- Two palettes cannot live in CSS and are kept in JS: xterm and CodeMirror. Switching the theme
  **recolours the live instance** (`term.options.theme`, a CodeMirror `Compartment`) rather than
  recreating it: recreating tears down the pty attachment and loses the document with its undo
  history.
- A light theme is not an inverted dark one. Body text clears WCAG AA (4.5:1); large text and the
  borders of operable controls clear 3:1. Semantic colours (added / removed / warning) stay
  recognisable.

---

# 9. Types and strictness

`strict`, `noUnusedLocals`, `noUnusedParameters` and `noFallthroughCasesInSwitch` are on.

- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are a target, not dogma: they go on
  as the code is cleared, and the remaining counts are recorded in `tsconfig.base.json`.
- **`!` and `as` do not count as fixes.** They silence exactly the signal the flag was turned on
  for: `parts[++i]` after `split('\0')` types as `string` and is `undefined` on truncated git
  output.
- Invariants are modelled in the type. A discriminated union instead of a bag of optional fields;
  six independent booleans for modals made "two modals at once" a representable state.

---

# 10. Tests

- Pure logic must be exported and covered: the `-z` git output parsers, the diff parser, the
  store, `slugify`, the plural rule. A function that cannot be imported is not tested — that is a
  reason to export it, not a reason to skip the test.
- `smoke.ts` is for what cannot be checked without the real world: worktrees, pty, IPC, painting.
  It **must fail**, not merely print: a run that prints `false` and exits zero is not a check.
- The screenshot harness finds elements by `data-testid`, never by their label — a label changes
  with the locale and the lookup silently stops matching.

---

# 11. Working with agents

- **One file, one owner per wave.** Parallel agents do not edit the same file; overlaps are
  assigned to owners in advance.
- If you change a shape another agent is waiting on, **state the contract up front and verbatim**
  — channel name, type name, signature — and let them code against it behind a temporary adapter.
- Large refactors and surgical fixes belong to different waves, or the diffs become unreadable.
- Formatting (`npm run format`) is its own change: it touches thousands of lines and buries
  everything else underneath.
