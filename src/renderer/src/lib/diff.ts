export type DiffLineType = 'context' | 'add' | 'del' | 'meta' | 'hunk'

export interface DiffLine {
  type: DiffLineType
  text: string
  oldNo: number | null
  newNo: number | null
}

export interface DiffStats {
  additions: number
  deletions: number
  binary: boolean
}

export interface ParsedDiff {
  lines: DiffLine[]
  stats: DiffStats
}

/** minimal unified-diff parser: enough for `git diff` output, no rename/mode noise */
export function parseUnifiedDiff(raw: string): ParsedDiff {
  const lines: DiffLine[] = []
  const stats: DiffStats = { additions: 0, deletions: 0, binary: false }
  let oldNo = 0
  let newNo = 0

  for (const line of raw.split('\n')) {
    // git's own headers carry nothing the panel doesn't already show
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to')
    ) {
      continue
    }
    if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
      stats.binary = true
      lines.push({ type: 'meta', text: line, oldNo: null, newNo: null })
      continue
    }
    if (line.startsWith('@@')) {
      // a hunk header that does not parse leaves the counters where they were: the lines that
      // follow still belong to the previous hunk's numbering, which beats restarting from NaN
      const [, oldStart, , newStart] = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line) ?? []
      if (oldStart && newStart) {
        oldNo = parseInt(oldStart, 10)
        newNo = parseInt(newStart, 10)
      }
      lines.push({ type: 'hunk', text: line, oldNo: null, newNo: null })
      continue
    }
    if (line.startsWith('+')) {
      stats.additions++
      lines.push({ type: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ })
      continue
    }
    if (line.startsWith('-')) {
      stats.deletions++
      lines.push({ type: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null })
      continue
    }
    if (line.startsWith('\\')) {
      lines.push({ type: 'meta', text: line, oldNo: null, newNo: null })
      continue
    }
    if (line === '' && lines.length === 0) continue
    lines.push({ type: 'context', text: line.startsWith(' ') ? line.slice(1) : line, oldNo: oldNo++, newNo: newNo++ })
  }

  return { lines, stats }
}
