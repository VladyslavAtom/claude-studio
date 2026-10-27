/**
 * The pure half of the three-way merge tab: parsing a file with conflict markers, laying it out
 * as three documents (yours, result, incoming) whose blocks line up, and writing the result back.
 * No CodeMirror and no DOM here, so it is tested on its own.
 *
 * Every chunk is an array of lines. A string cannot tell an empty side from a side holding one
 * empty line, and the difference is a line of the user's file.
 */
import type { ConflictInfo, ConflictSide } from '../../../shared/types'

export interface Conflict {
  kind: 'conflict'
  /** git's stage 2 (HEAD) — during a rebase that is the upstream, not the person's work */
  ours: string[]
  /** git's stage 3 */
  theirs: string[]
  /** present only when the file's markers carried a base chunk (diff3/zdiff3); together with `baseLabel` */
  base?: string[]
  oursLabel: string
  baseLabel?: string
  theirsLabel: string
}

export type Block = { kind: 'text'; lines: string[] } | Conflict

/**
 * Parsing a file with conflict markers. The format is the same for merge and rebase:
 * <<<<<<< our side … ||||||| base … ======= … >>>>>>> their side
 *
 * Every read of `lines[i]` is checked. A file whose last line was cut — by a crashed editor, a
 * full disk, a killed agent — ends mid-block, and the index then walks off the end. Bailing out
 * keeps whatever was parsed so far; inventing an empty line would rewrite the file on save.
 */
export function parseConflicts(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let plain: string[] = []
  let i = 0

  const flush = (): void => {
    if (plain.length) blocks.push({ kind: 'text', lines: plain })
    plain = []
  }

  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined) break
    if (!line.startsWith('<<<<<<<')) {
      plain.push(line)
      i++
      continue
    }
    flush()
    // a label the marker did not carry is written back into the file on save, so it is git's
    // own word for the side and never a translated one: the file must not change language
    const oursLabel = line.slice(7).trim() || 'ours'
    const ours: string[] = []
    const base: string[] = []
    const theirs: string[] = []
    let where: 'ours' | 'base' | 'theirs' = 'ours'
    let theirsLabel = 'theirs'
    let baseLabel: string | undefined
    i++
    while (i < lines.length) {
      const l = lines[i]
      if (l === undefined) break
      if (where === 'ours' && l.startsWith('|||||||')) {
        where = 'base'
        baseLabel = l.slice(7).trim()
        i++
        continue
      }
      if (where !== 'theirs' && l.startsWith('=======')) {
        where = 'theirs'
        i++
        continue
      }
      // anywhere, not only after `=======`: a damaged block still ends at its closing marker
      if (l.startsWith('>>>>>>>')) {
        theirsLabel = l.slice(7).trim() || theirsLabel
        i++
        break
      }
      ;(where === 'ours' ? ours : where === 'base' ? base : theirs).push(l)
      i++
    }
    const conflict: Conflict = { kind: 'conflict', ours, theirs, oursLabel, theirsLabel }
    // the marker decides whether there is a base at all, not the chunk's length: both fields are
    // added or left out together, which is what `markers` below relies on
    blocks.push(baseLabel === undefined ? conflict : { ...conflict, base, baseLabel })
  }
  flush()
  return blocks
}

/** lines that each end with a newline: a chunk as it sits inside a document */
const asText = (lines: readonly string[]): string => lines.map((l) => l + '\n').join('')

/** an unresolved conflict exactly as the file had it, base chunk included */
export function markers(c: Conflict): string {
  const base = c.base === undefined ? '' : `||||||| ${c.baseLabel ?? ''}`.trimEnd() + '\n' + asText(c.base)
  return `<<<<<<< ${c.oursLabel}\n${asText(c.ours)}${base}=======\n${asText(c.theirs)}>>>>>>> ${c.theirsLabel}\n`
}

/** the file put back together with every conflict unresolved: the parse's inverse */
export function renderBlocks(blocks: readonly Block[]): string {
  // every block but the last ends with a newline; a conflict's markers already carry theirs
  let out = ''
  blocks.forEach((b, i) => {
    if (b.kind === 'conflict') out += markers(b)
    else out += b.lines.join('\n') + (i < blocks.length - 1 ? '\n' : '')
  })
  return out
}

const sameLines = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((l, i) => l === b[i])

/**
 * What the result starts with in each conflict: the base chunk, as PyCharm does. The file's own
 * markers carry it only with diff3 style; otherwise it is taken from `diff3` — the three stages
 * merged again by main — by finding the conflict with the same two sides. A conflict that cannot
 * be matched (the person already edited it, or git split the hunks differently) starts empty.
 */
export function baseSeeds(blocks: readonly Block[], diff3: string | undefined): string[][] {
  const pool = diff3 ? parseConflicts(diff3).filter((b): b is Conflict => b.kind === 'conflict') : []
  const used = new Set<number>()
  const seeds: string[][] = []
  for (const b of blocks) {
    if (b.kind !== 'conflict') continue
    if (b.base !== undefined) {
      seeds.push(b.base)
      continue
    }
    const at = pool.findIndex((p, i) => !used.has(i) && sameLines(p.ours, b.ours) && sameLines(p.theirs, b.theirs))
    if (at >= 0) used.add(at)
    seeds.push(pool[at]?.base ?? [])
  }
  return seeds
}

/** one conflict laid out across the three documents */
export interface Region {
  /** index into `Layout.blocks` */
  block: number
  /** the text each arrow puts into the result, newline-terminated lines */
  yours: string
  incoming: string
  /** what the result holds while the conflict is unresolved */
  seed: string
  /** its range in the initial result: whole lines, the last newline included */
  from: number
  to: number
}

export interface Layout {
  blocks: Block[]
  left: string
  right: string
  result: string
  /** per block, the number of lines it takes in the left and in the right document */
  leftHeights: number[]
  rightHeights: number[]
  regions: Region[]
}

/**
 * Three documents from the parsed file: «yours» on the left, the result in the middle, the
 * incoming side on the right. Which of git's sides is «yours» depends on the operation — during
 * a rebase it is `theirs` (stage 3, the commit being replayed). The text between conflicts is
 * the same in all three: it is what git already merged.
 *
 * A file ending in a conflict gets an empty last line, so every conflict is followed by a line
 * and its range ends at a line start. git always ends a marker with a newline; only a hand-made
 * file is changed by this.
 */
export function layout(parsed: readonly Block[], seeds: readonly string[][], yoursIs: 'ours' | 'theirs'): Layout {
  const blocks: Block[] = [...parsed]
  if (blocks.at(-1)?.kind !== 'text') blocks.push({ kind: 'text', lines: [''] })
  const left: string[] = []
  const right: string[] = []
  const result: string[] = []
  const leftHeights: number[] = []
  const rightHeights: number[] = []
  const regions: Region[] = []
  let offset = 0
  let conflict = 0
  blocks.forEach((b, i) => {
    const last = i === blocks.length - 1
    if (b.kind === 'text') {
      const text = b.lines.join('\n') + (last ? '' : '\n')
      left.push(text)
      right.push(text)
      result.push(text)
      offset += text.length
      leftHeights.push(b.lines.length)
      rightHeights.push(b.lines.length)
      return
    }
    const mine = yoursIs === 'ours' ? b.ours : b.theirs
    const other = yoursIs === 'ours' ? b.theirs : b.ours
    const seed = asText(seeds[conflict] ?? [])
    conflict++
    left.push(asText(mine))
    right.push(asText(other))
    result.push(seed)
    leftHeights.push(mine.length)
    rightHeights.push(other.length)
    regions.push({
      block: i,
      yours: asText(mine),
      incoming: asText(other),
      seed,
      from: offset,
      to: offset + seed.length,
    })
    offset += seed.length
  })
  return {
    blocks,
    left: left.join(''),
    right: right.join(''),
    result: result.join(''),
    leftHeights,
    rightHeights,
    regions,
  }
}

/** where a conflict stands in the result: its range now, and whether it is settled */
export interface RegionState {
  from: number
  to: number
  resolved: boolean
}

/**
 * The file to write: the result as edited, with every conflict not yet settled put back as its
 * markers — so a saved, half-done merge reopens with the rest of its conflicts intact.
 */
export function renderResult(
  doc: string,
  layoutRegions: readonly Region[],
  states: readonly RegionState[],
  blocks: readonly Block[],
): string {
  let out = ''
  let at = 0
  states.forEach((s, i) => {
    const region = layoutRegions[i]
    const block = region ? blocks[region.block] : undefined
    if (s.resolved || !block || block.kind !== 'conflict') return
    out += doc.slice(at, s.from) + markers(block)
    at = s.to
  })
  return out + doc.slice(at)
}

/**
 * The spacer each pane needs under each block for the three to line up: the tallest pane's
 * height minus its own. `heights[pane][block]`.
 */
export function spacers(heights: readonly (readonly number[])[]): number[][] {
  const blocks = Math.max(0, ...heights.map((h) => h.length))
  const tallest = Array.from({ length: blocks }, (_, b) => Math.max(0, ...heights.map((h) => h[b] ?? 0)))
  return heights.map((h) => tallest.map((top, b) => top - (h[b] ?? 0)))
}

/** a side's label, before it is worded: the renderer turns each kind into its locale's sentence */
export type SideLabel =
  | { kind: 'yours' }
  | { kind: 'yoursOn'; ref: string }
  | { kind: 'yourCommit'; commit: string }
  | { kind: 'incoming' }
  | { kind: 'incomingFrom'; ref: string }
  | { kind: 'upstream'; ref: string }

const commitText = (s: ConflictSide): string => [s.sha, s.subject].filter(Boolean).join(' ')

/**
 * The sides by what they are to the person, and which of git's stages is «yours». During a
 * rebase git's stage 2 («ours», HEAD) is the upstream being built on and stage 3 («theirs») is
 * the person's own commit being replayed — the reverse of a merge. Labelling by git's words put
 * «Ours · HEAD» on the upstream.
 */
export function sideLabels(info: Pick<ConflictInfo, 'operation' | 'ours' | 'theirs'>): {
  yoursIs: 'ours' | 'theirs'
  yours: SideLabel
  incoming: SideLabel
} {
  if (info.operation === 'rebase') {
    const mine = commitText(info.theirs)
    const upstream = info.ours.ref ?? info.ours.sha
    return {
      yoursIs: 'theirs',
      yours: mine ? { kind: 'yourCommit', commit: mine } : { kind: 'yours' },
      incoming: upstream ? { kind: 'upstream', ref: upstream } : { kind: 'incoming' },
    }
  }
  const from = info.theirs.ref ?? commitText(info.theirs)
  return {
    yoursIs: 'ours',
    yours: info.ours.ref ? { kind: 'yoursOn', ref: info.ours.ref } : { kind: 'yours' },
    incoming: from ? { kind: 'incomingFrom', ref: from } : { kind: 'incoming' },
  }
}
