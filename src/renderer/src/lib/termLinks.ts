import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import { findPaths, resolvePath } from './termPaths'

/**
 * Turning the paths that `termPaths` finds into xterm links.
 *
 * Two things are done here and nowhere else. The first is the buffer arithmetic: a link is a
 * range of cells, output wraps, and the string a line translates to is not 1:1 with its cells,
 * so a string index has to be walked back into a (row, column). The second is the existence
 * check, which is what decides whether a candidate becomes a link at all — output is full of
 * things shaped like paths, and underlining `and/or` would make every line look clickable.
 *
 * The check is answered by the main process, so it is asynchronous, and xterm asks for links on
 * every hover and every repaint. Hence the cache: one per terminal, bounded, and with answers
 * that expire — a file an agent is about to write must not stay "missing" for the life of the
 * window.
 */

/** a file that is there stays there for a minute before we ask again */
const FOUND_TTL = 60_000
/** a file that is not there is asked about again far sooner: agents create files as they work */
const MISSING_TTL = 5_000
/** entries kept per terminal; the oldest goes when a new answer arrives over the limit */
const MAX_CACHED = 500
/** how far the wrapped-line walk goes before giving up, as in xterm's own web links addon */
const MAX_WRAPPED = 2048

export interface PathLinkOptions {
  /** the tab's working directory: what a relative path in its output is relative to */
  cwd: () => string
  /** the user's home directory for `~`, or null while main has not answered yet */
  home: () => string | null
  /** is there a regular file at this absolute path — a directory answers false */
  isFile: (path: string) => Promise<boolean>
  /** the click: open this file, at this line when the output named one */
  open: (path: string, line: number | undefined) => void
  /** the pointer entered a link; the wording of the hint is the component's business */
  hover: (event: MouseEvent, path: string, line: number | undefined) => void
  leave: () => void
}

export interface PathLinks {
  provider: ILinkProvider
  /** stop answering: a reply that arrives after the terminal is gone must not be delivered */
  dispose: () => void
}

export function createPathLinks(term: Terminal, opts: PathLinkOptions): PathLinks {
  const cache = new Map<string, { isFile: boolean; at: number }>()
  const inFlight = new Map<string, Promise<boolean>>()
  let disposed = false

  /** cached answer, or one round trip to main; concurrent askers about one path share it */
  const isFile = (path: string): Promise<boolean> => {
    const known = cache.get(path)
    if (known && Date.now() - known.at < (known.isFile ? FOUND_TTL : MISSING_TTL)) {
      // re-inserted so that the bound below drops what has not been asked about recently
      cache.delete(path)
      cache.set(path, known)
      return Promise.resolve(known.isFile)
    }
    const pending = inFlight.get(path)
    if (pending) return pending
    const query = opts
      .isFile(path)
      .catch(() => false)
      .then((answer) => {
        inFlight.delete(path)
        cache.delete(path)
        cache.set(path, { isFile: answer, at: Date.now() })
        while (cache.size > MAX_CACHED) {
          const oldest = cache.keys().next()
          if (oldest.done) break
          cache.delete(oldest.value)
        }
        return answer
      })
    inFlight.set(path, query)
    return query
  }

  const provider: ILinkProvider = {
    provideLinks(y, callback) {
      const [lines, topIndex] = wrappedLines(term, y - 1)
      const text = lines.join('')
      const candidates = findPaths(text)
      if (candidates.length === 0) {
        callback(undefined)
        return
      }
      const home = opts.home()
      const cwd = opts.cwd()
      void Promise.all(
        candidates.map(async (candidate) => {
          const path = resolvePath(candidate.path, cwd, home)
          if (!path) return null
          // The cells are located before the wait, not after it. A buffer index is absolute, and
          // output arriving while the answer about the file is in flight scrolls lines out of the
          // scrollback — the same index would then name a different row.
          const [startY, startX] = mapStringIndex(term, topIndex, 0, candidate.start)
          if (startY < 0) return null
          const [endY, endX] = mapStringIndex(term, startY, startX, candidate.text.length)
          if (endY < 0) return null
          if (!(await isFile(path))) return null
          const line = candidate.line
          // the range is 1-based and includes its right-hand side, so every value gains one
          // except the end column, which is already the cell after the last
          const link: ILink = {
            range: { start: { x: startX + 1, y: startY + 1 }, end: { x: endX, y: endY + 1 } },
            text: candidate.text,
            activate: () => opts.open(path, line),
            hover: (event) => opts.hover(event, path, line),
            leave: () => opts.leave(),
          }
          return link
        }),
      ).then((links) => {
        if (disposed) return
        const found = links.filter((link): link is ILink => link !== null)
        callback(found.length > 0 ? found : undefined)
      })
    },
  }

  return {
    provider,
    dispose: () => {
      disposed = true
      cache.clear()
      inFlight.clear()
    },
  }
}

/**
 * The whole logical line the given row belongs to, as strings, plus the buffer index of its
 * first row. Ported from xterm's own `WebLinksAddon`, which is the reference implementation of
 * this walk: output wraps, and a path that crosses a row boundary is still one path.
 *
 * The strings come from `translateToString(true)`, which trims the padding on the right. That is
 * what makes a link ending in a wide character match, and it is also why the joined string
 * cannot be indexed straight into the cells — `mapStringIndex` below does that walk instead.
 */
function wrappedLines(term: Terminal, rowIndex: number): [string[], number] {
  const buffer = term.buffer.active
  const first = buffer.getLine(rowIndex)
  if (!first) return [[], rowIndex]

  const current = first.translateToString(true)
  const lines: string[] = []
  let topIndex = rowIndex

  // upwards, while this row is a continuation of the one above it. The index moves only for a
  // row that is actually taken, so the returned top index always names `lines[0]` — xterm's
  // own version decrements first and is one out when the chain reaches the top of the buffer
  if (first.isWrapped && current.charAt(0) !== ' ') {
    let length = 0
    while (length < MAX_WRAPPED) {
      const line = buffer.getLine(topIndex - 1)
      if (!line) break
      topIndex--
      const content = line.translateToString(true)
      length += content.length
      lines.push(content)
      if (!line.isWrapped || content.includes(' ')) break
    }
    lines.reverse()
  }
  lines.push(current)

  // downwards, while the next row is a continuation of this one
  let bottomIndex = rowIndex
  let below = 0
  while (below < MAX_WRAPPED) {
    const line = buffer.getLine(bottomIndex + 1)
    if (!line || !line.isWrapped) break
    bottomIndex++
    const content = line.translateToString(true)
    below += content.length
    lines.push(content)
    if (content.includes(' ')) break
  }

  return [lines, topIndex]
}

/**
 * An index into the joined string, back to a buffer position as `[rowIndex, column]`, both
 * 0-based; `[-1, -1]` when the walk runs past the end of the buffer.
 *
 * Also ported from `WebLinksAddon`, correction included: a wide character that did not fit at
 * the end of a row leaves an empty cell behind and is printed on the next one, so the joined
 * string is one character shorter there than the cells suggest.
 */
function mapStringIndex(term: Terminal, rowIndex: number, column: number, stringIndex: number): [number, number] {
  const buffer = term.buffer.active
  const cell = buffer.getNullCell()
  let row = rowIndex
  let start = column
  let remaining = stringIndex
  while (remaining > 0) {
    const line = buffer.getLine(row)
    if (!line) return [-1, -1]
    for (let i = start; i < line.length; i++) {
      line.getCell(i, cell)
      const chars = cell.getChars()
      if (cell.getWidth()) {
        remaining -= chars.length || 1
        if (i === line.length - 1 && chars === '') {
          const next = buffer.getLine(row + 1)
          if (next && next.isWrapped) {
            next.getCell(0, cell)
            if (cell.getWidth() === 2) remaining += 1
          }
        }
      }
      if (remaining < 0) return [row, i]
    }
    row++
    start = 0
  }
  return [row, start]
}
