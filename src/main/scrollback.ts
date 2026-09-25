/**
 * What a terminal has printed, kept so a pane that re-attaches can be painted back.
 *
 * It sits apart from `pty.ts` because it is the one part of that file with no pty in it, and
 * because its rules are the kind that are wrong silently: a trim that leaves the chunk list in a
 * shape a later append cannot handle shows up only on a re-attach, several session switches
 * later, as output that is missing or doubled. That is a reason to import it from a test.
 *
 * The text accumulates in chunks rather than in one string: TUI agents send dozens of chunks a
 * second, and `buffer += data` followed by a slice to the limit would copy a quarter of a
 * megabyte every time. The join happens only at the moment of attach.
 */

/**
 * Characters assumed per line of output when a limit stated in lines has to be applied to a
 * buffer counted in characters.
 *
 * The two limits count different things and there is no exact rate between them: this buffer
 * holds the raw stream, escape sequences and repaints included, while xterm's limit counts the
 * lines that survive that stream. A TUI agent redrawing a spinner sends hundreds of characters
 * that end up as one line; plain output sends a line's worth of text plus a newline.
 *
 * So the number is an estimate, and it is deliberately generous — 200 characters for a line that
 * is typically 60-80 wide, colour codes included. The two ends of being wrong are not equal: too
 * high wastes memory that the unlimited setting was ready to spend anyway, while too low means a
 * pane that switches away and back is painted a shorter history than the one it was just
 * scrolling through, which is the bug this whole setting exists to remove.
 */
export const CHARS_PER_LINE = 200

/** the buffer keeps everything: `appendChunk` compares against it and never trims */
export const NO_LIMIT = Infinity

/**
 * The character limit that keeps at least `lines` lines of replay; `null` lines (no limit) gives
 * `NO_LIMIT`, which every comparison in here is written to survive.
 */
export function charLimitForLines(lines: number | null): number {
  if (lines === null) return NO_LIMIT
  return Math.max(1, Math.ceil(lines * CHARS_PER_LINE))
}

export interface Scrollback {
  chunks: string[]
  /** total length of `chunks`, kept alongside so the limit can be tested without a join */
  chunksLen: number
}

export function joinChunks(s: Scrollback): string {
  return s.chunks.join('')
}

/**
 * Appends a chunk and trims by total length, leaving what is kept untouched.
 *
 * `limit` defaults to keeping everything, because that is what the setting defaults to; the
 * caller that owns a terminal passes the configured one on every append, so a limit changed
 * while output is flowing takes hold on the next chunk.
 */
export function appendChunk(s: Scrollback, data: string, limit = NO_LIMIT): void {
  s.chunks.push(data)
  s.chunksLen += data.length
  while (s.chunksLen > limit && s.chunks.length > 1) {
    const dropped = s.chunks.shift()
    if (dropped === undefined) break
    s.chunksLen -= dropped.length
  }
  // a single chunk larger than the limit (a rare thing) — the chunk itself is trimmed
  const first = s.chunks[0]
  if (first !== undefined && s.chunksLen > limit) {
    const over = s.chunksLen - limit
    s.chunks[0] = first.slice(over)
    s.chunksLen -= over
  }
}

/**
 * Forget everything kept for replay.
 *
 * The empty list is not a special case anywhere else here: it is what a terminal starts life
 * with, `appendChunk` treats the next chunk as the first one, and `joinChunks` answers with the
 * empty string — which `start()` hands back as a buffer the renderer writes nothing for.
 */
export function clearChunks(s: Scrollback): void {
  s.chunks = []
  s.chunksLen = 0
}

/**
 * Keep only the last `n` chars — a dead pty needs no more than its last screen.
 *
 * `n` of zero or less means keep nothing, spelled out because `slice(-0)` is `slice(0)` and
 * would keep everything.
 */
export function trimToTail(s: Scrollback, n: number): void {
  // `slice(-Infinity)` is `slice(0)` and would answer correctly — after joining and copying a
  // buffer that is not being trimmed at all, which at no limit is the whole history of a tab
  if (!Number.isFinite(n)) return
  if (n <= 0) return clearChunks(s)
  const tail = joinChunks(s).slice(-n)
  s.chunks = tail ? [tail] : []
  s.chunksLen = tail.length
}
