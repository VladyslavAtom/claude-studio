import { useCallback, useEffect, useState } from 'react'
import type { Project } from '../../../shared/types'
import { watchedDirs } from '../lib/sessionHealth'

export interface MissingDirs {
  /** project folders and session directories that are not on disk */
  missing: ReadonlySet<string>
  /** look again now — after a worktree was recreated, say */
  recheck: () => void
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x))

/**
 * Which of the window's directories have been deleted behind its back. Checked when the set of
 * directories changes (load, a project or session added) and whenever the window regains focus —
 * a folder is usually removed from another program, and coming back is the event that follows.
 */
export function useMissingDirs(projects: readonly Project[]): MissingDirs {
  // one string, so an unrelated state change does not start another round of checks
  const key = watchedDirs(projects).join('\0')
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  const [round, setRound] = useState(0)
  const recheck = useCallback(() => setRound((n) => n + 1), [])

  useEffect(() => {
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [recheck])

  useEffect(() => {
    let alive = true
    const dirs = key ? key.split('\0') : []
    void Promise.all(
      // a check that failed says nothing about the folder: it is not reported as missing
      dirs.map(async (d) => ((await window.api.fs.exists(d).catch(() => true)) ? null : d)),
    ).then((gone) => {
      if (!alive) return
      const next = new Set(gone.filter((d): d is string => d !== null))
      setMissing((prev) => (sameSet(prev, next) ? prev : next))
    })
    return () => {
      alive = false
    }
  }, [key, round])

  return { missing, recheck }
}
