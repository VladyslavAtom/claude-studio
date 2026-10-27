/**
 * What the diff view does with a file before it reads any of it. The numbers come from
 * `git.fileDiffStat`; this only decides, so the thresholds can be tested without git.
 */
import type { FileDiffStat } from '../../../shared/types'
import { basename } from './util'

/** past this many changed lines a diff waits for a click: peers draw the line at the same place */
export const GATE_LINES = 500
/** past this size, too: one minified line of 400 KB is "one changed line" and still a stall */
export const GATE_BYTES = 512 * 1024
/** what `files.read` hands over at all; a larger file cannot be shown, only opened elsewhere */
export const MAX_BYTES = 2 * 1024 * 1024

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'go.sum',
  'flake.lock',
  'mix.lock',
  'pubspec.lock',
  'Podfile.lock',
])

/** lockfiles and machine output: nobody reads these line by line, and they are the large ones */
export function isGeneratedPath(path: string): boolean {
  const name = basename(path)
  if (LOCKFILES.has(name)) return true
  return /\.min\.(js|mjs|cjs|css)$|\.(js|css)\.map$|\.pb\.go$|_pb2\.pyi?$|\.generated\.\w+$/.test(name)
}

/**
 * - `show`: read both sides and draw the diff
 * - `binary`: there is no text to compare
 * - `too-large`: past what the app reads at all — offered for an external editor only
 * - `large` / `generated`: drawn only after "Load diff"
 */
export type GateVerdict = 'show' | 'binary' | 'too-large' | 'large' | 'generated'

export function gateVerdict(
  stat: Pick<FileDiffStat, 'added' | 'removed' | 'binary' | 'bytes'>,
  path: string,
): GateVerdict {
  if (stat.binary) return 'binary'
  if (stat.bytes > MAX_BYTES) return 'too-large'
  if (isGeneratedPath(path)) return 'generated'
  if (stat.added + stat.removed > GATE_LINES || stat.bytes > GATE_BYTES) return 'large'
  return 'show'
}
