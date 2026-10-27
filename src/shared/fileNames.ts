/**
 * Pure name work for the file tree's operations. Shared because both sides need the same answer:
 * the renderer refuses a bad name before the round trip, main refuses it again because the IPC
 * payload is unvalidated input.
 */

/**
 * A name that is one entry inside one directory. `/` would make it a path (and a way out of the
 * directory), `.` and `..` name the directory itself or its parent, NUL ends the string early in
 * every syscall. Surrounding blanks are not trimmed here — the inline field already trims.
 */
export function isValidName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false
  return !name.includes('/') && !name.includes('\0')
}

/**
 * The name a copy lands under when its own is taken: `a.ts` → `a copy.ts` → `a copy 2.ts`, the
 * way PyCharm's Copy dialog proposes it. The suffix goes before the extension of a file so the
 * copy keeps its type; a directory and a dotfile without a second dot take it at the end.
 */
export function copyName(name: string, isDir: boolean, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  const dot = isDir ? -1 : name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 1; ; i++) {
    const candidate = `${stem} copy${i === 1 ? '' : ` ${i}`}${ext}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * The `.gitignore` line for one repo-relative path: anchored with a leading `/` so it ignores
 * exactly this entry and not every same-named one below, `/` at the end for a directory.
 * Glob characters and a leading `#`/`!` are escaped, or the line would mean something else.
 */
export function ignoreLine(relPath: string, isDir: boolean): string {
  const escaped = relPath.replace(/[\\*?[\]]/g, (c) => `\\${c}`).replace(/ $/, '\\ ')
  return `/${escaped}${isDir ? '/' : ''}`
}

/**
 * `.gitignore` with the line appended, or null when it is already there — with or without the
 * leading slash, and with or without the trailing one, all of which name the same entry.
 */
export function withIgnoreLine(existing: string, line: string): string | null {
  const bare = (l: string): string => l.trim().replace(/^\//, '').replace(/\/$/, '')
  const wanted = bare(line)
  if (existing.split('\n').some((l) => bare(l) === wanted)) return null
  const sep = existing === '' || existing.endsWith('\n') ? '' : '\n'
  return `${existing}${sep}${line}\n`
}
