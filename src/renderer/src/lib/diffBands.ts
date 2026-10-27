/**
 * The pure half of the side-by-side diff: what kind a change is, and the shape of the band that
 * joins its two sides across the divider. Nothing here touches the DOM or CodeMirror, so the
 * geometry can be tested on numbers.
 */

// Band geometry ported from JetBrains intellij-community (Apache-2.0): platform/diff-impl/src/com/intellij/diff/util/DiffDividerDrawUtil.java (DividerPolygon.paint) and DiffDrawUtil.java (drawCurveTrapezium, makeCurvePath, makeCurve).

/** IntelliJ's three colours: blue, green, grey */
export type ChangeKind = 'modified' | 'inserted' | 'deleted'

/**
 * A change empty on the left was inserted, one empty on the right was deleted, anything with
 * text on both sides was modified. Works for a whole chunk and for a word inside one alike.
 */
export function changeKind(fromA: number, toA: number, fromB: number, toB: number): ChangeKind {
  if (fromA === toA) return 'inserted'
  if (fromB === toB) return 'deleted'
  return 'modified'
}

/**
 * A change's vertical extent on one side, in pixels from the top of the divider. An empty side
 * (nothing deleted there, or nothing inserted) has `top === bottom`: the band narrows to the
 * boundary between the two lines the change sits between.
 */
export interface Span {
  top: number
  bottom: number
}

/** how far along the divider the control points sit: IntelliJ's CTRL_PROXIMITY_X */
export const CTRL_PROXIMITY_X = 0.3

const n = (v: number): string => String(Math.round(v * 10) / 10)

/**
 * The SVG path of the band between `left` and `right` across a divider `width` pixels wide: two
 * cubic curves, the top edge running forward and the bottom edge back, closed. A side shorter
 * than two pixels is widened to two, as IntelliJ does, or an insertion would draw nothing at all.
 */
export function bandPath(width: number, left: Span, right: Span): string {
  const [s1, e1] = edges(left)
  const [s2, e2] = edges(right)
  // makeCurvePath(x1, x2, start1, start2, end1 + 1, end2 + 1)
  const y21 = e1 + 1
  const y22 = e2 + 1
  const c1 = width * CTRL_PROXIMITY_X
  const c2 = width * (1 - CTRL_PROXIMITY_X)
  return (
    `M0 ${n(s1)}` +
    `C${n(c1)} ${n(s1)} ${n(c2)} ${n(s2)} ${n(width)} ${n(s2)}` +
    `L${n(width)} ${n(y22)}` +
    `C${n(c2)} ${n(y22)} ${n(c1)} ${n(y21)} 0 ${n(y21)}` +
    'Z'
  )
}

/** DividerPolygon.paint: the drawn edges of one side */
function edges({ top, bottom }: Span): [number, number] {
  if (bottom - top < 2) return [top - 1, top]
  return [top, bottom - 1]
}

/** the chunk the position is in, by index; -1 between chunks */
export function chunkAt(chunks: readonly { from: number; to: number }[], pos: number): number {
  return chunks.findIndex((c) => c.from <= pos && pos <= Math.max(c.from, c.to))
}
