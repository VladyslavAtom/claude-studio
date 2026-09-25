# i18n

English is the source of truth. `locales/en/*` defines what keys exist and what they mean;
`locales/ru/*` and `locales/uk/*` must define the same keys and nothing else. There is no
runtime framework and no key discovery: a key is a type, so a typo, a key one locale forgot
and a value nobody passed are all `tsc` errors.

## Using a string

```tsx
import { useT } from '../i18n'

const t = useT()
t('settings.title') // → 'Settings'
t('sessions.defaultName', { n: 3 }) // → 'Session 3'
t.plural('projects.sessionCount', n) // → '5 сессий'
```

`t.plural` always makes `{count}` available; extra values go in the third argument.
`t.locale` is the locale in force, for the rare formatting that has to know.

## Adding a string

1. Put it in the English area file it belongs to — `locales/en/<area>.ts`.
2. Add the same key to `locales/ru/<area>.ts` and `locales/uk/<area>.ts`. Both files are typed
   against the English one, so a forgotten key fails the build in that file.
3. Use it through `useT()`.

Areas are the split that lets several people work at once: `common`, `projects`, `sessions`,
`terminal`, `changes`, `git`, `files`, `editor`, `settings`, `modals`. Take the area of the
screen you are converting and you will not meet anybody else in the same file.

Conventions:

- A key may contain dots of its own (`settings.tab.agents`): only the **first** dot separates
  the area, the rest is the key.
- Values interpolate `{name}`, and the English wording is what decides the names: `t()` demands
  exactly the values the English string spells out.
- Long strings are assembled with `+`. That is fine — a wording built that way is no longer a
  literal type, so its placeholders cannot be checked; keep placeholders in single-piece strings.
- A string split around an inline `<code>` is two keys, `…before` and `…after`, and **each
  segment carries the spaces it needs**. Punctuation sits where the language wants it, so a
  locale is free to start its second half with a comma.
- CLI text is not language: command examples, flags, placeholders like `{session}` and
  `{outfile}` stay in the component, outside the catalogue.

## Plurals

A plural entry is an object, not a string:

```ts
sessionCount: { zero: 'no sessions', one: '{count} session', other: '{count} sessions' }
```

English fills `one` and `other`. Russian and Ukrainian share one three-form rule and must fill
`one`, `few` and `many` as well — 1 сессия / 2 сессии / 5 сессий, with every teen taking `many`
(11 сессий, not 11 сессия). `zero` is optional and is not a grammatical form: it is the wording
for "none at all" («без сессий»), used in place of the rule when the locale supplies it.
Fractions take `other` in every locale.

The rule itself is in `plural.ts` and is covered by `tests/i18n.test.ts`, together with the
"every locale defines every key" property.

## The language of the wording

The rules in `CLAUDE.md` hold per locale, and the catalogue is where they are enforced:

- The names of git operations stay English in every locale — push, pull, fetch, merge, rebase,
  cherry-pick, commit, stash, upstream, remote, HEAD, worktree, PR. A gloss in the language of
  the locale may stand next to them, in brackets: `Кнопка Pull («обновить проект»)` — the term stays, the gloss is the locale's own.
- The same action is worded the same everywhere it appears. The project branch menu and the
  session branch menu name the same operations, so they take the **same key**, not two keys
  that happen to agree today.

## Switching

The locale is a setting (`Settings.locale` in `src/shared/types.ts`). It is optional: no field
means nobody has chosen, and then the system language decides — English when the system speaks
none of ours. `I18nProvider` sits inside `AppStateProvider` (see `App.tsx`), so a change to the
setting re-renders everything below with the new wording. No restart, no reload.
