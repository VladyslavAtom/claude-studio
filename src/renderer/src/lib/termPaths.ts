/**
 * File paths in terminal output.
 *
 * Agents name files constantly — `/tmp/claude-1000/…/scratchpad/fe-message-14076.md`,
 * `src/main/git.ts:42`, `@src/lib/jwt.ts` — and every one of them is a place the user wants to
 * go. This module is the half of that which can be reasoned about on its own: given one line of
 * text it says which stretches of it are shaped like a path, and given a candidate it says which
 * absolute path that would be. Whether the file is actually there is decided elsewhere, against
 * the real filesystem, and that check is the one that keeps the noise out — see `termLinks.ts`.
 *
 * The split matters: the shape test below is deliberately generous. `and/or`, `n/a` and
 * `/usr/bin/env` all pass it, because a matcher strict enough to reject them by spelling alone
 * would also reject half the real paths. What it refuses is what could never be opened anyway
 * (an option, a URL, a bare number) — everything else is left to `stat`.
 */

/** a stretch of a line that is shaped like a path, and where it sits in that line */
export interface PathCandidate {
  /** what becomes the link: the path with its `:line[:col]` suffix, as it appears in the line */
  text: string
  /** index of the first character of `text` in the line */
  start: number
  /** index one past its last character */
  end: number
  /** the path alone, still written the way the output wrote it — relative, `~`, or absolute */
  path: string
  /** the `:42` an agent appends when it means a place in the file */
  line?: number
  column?: number
}

/**
 * A run of characters that could be one path.
 *
 * Everything excluded here is a character that ends a path far more often than it belongs to
 * one: whitespace, the three quote marks, every kind of bracket, and the shell's own
 * punctuation. That is what makes `(src/main/git.ts)`, `"src/main/git.ts",` and
 * `--out=build/app.js` yield the path and not the bracket, the quote or the flag. The price is
 * that a file whose name contains a space or a bracket is not linked — deliberate: guessing
 * where such a name ends is how a link swallows the rest of the sentence.
 */
const TOKEN = /[^\s'"`<>()[\]{}|*?=,;]+/g

/** punctuation that ends the sentence rather than the name: `see src/main/git.ts.` */
const TRAILING = /[.:!?]/

/** `path:42` and `path:42:7` — the suffix is lazy on the left so `a:1:2` splits as a, 1, 2 */
const LINE_SUFFIX = /^(.*?):(\d{1,9})(?::(\d{1,9}))?$/

/** a scheme with an authority: the web links addon owns those, and it was loaded first */
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i

/** `git.ts`, `package.json` — an extension is what makes a bare name worth a stat */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9_]{0,9}$/

/** every path found in one line of output, in the order they appear */
export function findPaths(text: string): PathCandidate[] {
  const out: PathCandidate[] = []
  // a fresh regex per call: a `g` regex carries `lastIndex`, and a shared one would resume
  // halfway through the next line
  const token = new RegExp(TOKEN.source, 'g')
  for (let m = token.exec(text); m !== null; m = token.exec(text)) {
    let start = m.index
    let end = start + m[0].length
    // `@src/lib/jwt.ts` is how both CLIs write a file reference; the marker is not the name
    if (text[start] === '@') start++
    while (end > start && TRAILING.test(text.charAt(end - 1))) end--
    if (end <= start) continue

    const candidate = text.slice(start, end)
    const suffix = LINE_SUFFIX.exec(candidate)
    const path = suffix ? suffix[1] : candidate
    if (!looksLikePath(path)) continue

    const line = suffix ? Number(suffix[2]) : undefined
    const column = suffix && suffix[3] ? Number(suffix[3]) : undefined
    out.push({ text: candidate, start, end, path, line, column })
  }
  return out
}

/**
 * Could this be the name of a file we can open?
 *
 * Four refusals, all of things that are never a path: an option (`-v`, `--force`), a URL, a
 * string with nothing nameable in it (`/`, `..`), and a path with a colon left in it after the
 * `:line` suffix was taken off — `git@github.com:user/repo.git` and `ext::sh -c` are both that
 * shape, and a POSIX file name with a colon in it is rare enough to lose.
 *
 * Then one requirement: a slash, or an extension. `src/main/git.ts` and `package.json` qualify;
 * a bare `Makefile` does not, and neither does `1.5` — an extension has to start with a letter.
 * Without this every word in every sentence would cost a round trip to the filesystem.
 */
function looksLikePath(path: string): boolean {
  if (!path || path.startsWith('-')) return false
  if (URL_LIKE.test(path)) return false
  if (path.includes(':')) return false
  if (!/[A-Za-z0-9_]/.test(path)) return false
  return path.includes('/') || EXTENSION.test(path)
}

/**
 * The candidate as one absolute path, or null when it cannot be resolved yet.
 *
 * `home` is null until the main process has answered with it, and a `~` path resolved against
 * nothing would point at a file that exists — `/Documents` is not the user's home directory.
 */
export function resolvePath(path: string, cwd: string, home: string | null): string | null {
  if (path.startsWith('/')) return normalizePath(path)
  if (path === '~' || path.startsWith('~/')) return home ? normalizePath(home + path.slice(1)) : null
  if (!cwd.startsWith('/')) return null
  return normalizePath(cwd + '/' + path)
}

/**
 * `.`, `..` and repeated slashes, resolved textually. Symlinks are not followed — that would
 * need the filesystem, and the answer is only used to name a file, never to decide whether it
 * may be read. `..` at the root stays at the root, as it does in a shell.
 */
export function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return '/' + parts.join('/')
}

/**
 * The path inside a `file://` URI, or null for anything else.
 *
 * Agents mark files up as OSC 8 hyperlinks, and those are not opened as web addresses: the path
 * goes to the application's own editor, which is what a file link is for here. Only a local link
 * qualifies — `file://host/path` names somebody else's machine.
 */
export function fileUrlToPath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'file:') return null
  if (parsed.hostname && parsed.hostname !== 'localhost') return null
  try {
    return normalizePath(decodeURIComponent(parsed.pathname))
  } catch {
    // a stray `%` in the path is not an escape and `decodeURIComponent` throws on it
    return null
  }
}
