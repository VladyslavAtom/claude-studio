/**
 * The last screen of a terminal, kept while its tab sleeps.
 *
 * A sleeping tab has no process — main killed it and dropped its scrollback with it — so the
 * only record of what was on screen is the one the pane takes on its way out. These snapshots
 * are runtime state and nothing else: they are not persisted, because after a restart the
 * process is gone and the conversation is resumed from the agent's own store, and a screen from
 * the previous run would be a lie about a session that no longer exists.
 *
 * The store is a plain `Map` in insertion order and the functions here return a new one, so it
 * can live in React state: the sleeping pane has to re-render when its screen arrives.
 */

/**
 * How many screens are kept. Only the visible sleeping tab is ever rendered, so everything past
 * the last few is memory held against a click that will not come.
 */
export const MAX_SNAPSHOTS = 12

/**
 * A screen with its escapes is a few kilobytes; a hundred times that is not a screen but a
 * runaway. Such a capture is dropped rather than truncated — cutting a string of escape
 * sequences in half produces visible garbage, which is worse than the card it falls back to.
 */
export const MAX_SNAPSHOT_CHARS = 200_000

/**
 * A captured screen and the width it was captured at. The sleeping pane is a terminal of its own,
 * and its fitted width differs from the live pane's by a column or two (another renderer measures
 * the cell differently); written at another width, every line the program wrapped itself breaks
 * again a character before its end. So the screen is redrawn at exactly `cols`.
 */
export interface Snapshot {
  text: string
  cols: number
}

/**
 * Remember the last screen of `id`, forgetting the oldest once too many pile up.
 *
 * An empty or oversized capture **removes** whatever was stored for that id instead of leaving
 * it in place. A pane that could not be serialised must not put the screen of a previous life
 * back on view: showing the card is honest, showing an older screen is not.
 */
export function putSnapshot(prev: Map<string, Snapshot>, id: string, snapshot: Snapshot): Map<string, Snapshot> {
  const next = new Map(prev)
  next.delete(id)
  if (!snapshot.text || snapshot.text.length > MAX_SNAPSHOT_CHARS) return next.size === prev.size ? prev : next
  // re-inserted at the end: the most recently captured screen is the last to be evicted
  next.set(id, snapshot)
  while (next.size > MAX_SNAPSHOTS) {
    const oldest = next.keys().next()
    if (oldest.done) break
    next.delete(oldest.value)
  }
  return next
}

/** a closed tab keeps nothing: its screen goes with the rest of its runtime bookkeeping */
export function dropSnapshots(prev: Map<string, Snapshot>, ids: string[]): Map<string, Snapshot> {
  if (!ids.some((id) => prev.has(id))) return prev
  const next = new Map(prev)
  for (const id of ids) next.delete(id)
  return next
}
