import { useEffect, useMemo, useRef, useState } from 'react'
import type { BranchPrs, Project } from '../../../shared/types'
import { onChangesInvalidated, pathsOverlap } from '../lib/changesRefresh'
import { mergePrs, onPrStatusInvalidated, pendingCwds, PR_PENDING_POLL_MS } from '../lib/prStatus'

interface Shown {
  /** whose answers these are: a switch to another project shows nothing until its own arrive */
  projectId: string
  prs: BranchPrs
}

/**
 * The PR and checks of every session branch of the project on screen, keyed by session
 * directory. See `lib/prStatus` for when it asks; asks that land while one is running are folded
 * into a single follow-up, so a burst of events is one round trip.
 */
export function usePrStatus(project: Project): BranchPrs {
  const [shown, setShown] = useState<Shown>({ projectId: project.id, prs: {} })
  const cwds = useMemo(() => project.sessions.map((s) => s.cwd), [project.sessions])
  // a string, so the effects below re-arm when the set of directories changes, not on every edit
  const cwdKey = cwds.join('\0')
  const activeCwd = project.sessions.find((s) => s.id === project.activeSessionId)?.cwd

  const projectRef = useRef(project.id)
  const cwdsRef = useRef(cwds)
  useEffect(() => {
    projectRef.current = project.id
    cwdsRef.current = cwds
  })

  /** asks waiting for the running one to end: directory → forced */
  const queued = useRef(new Map<string, boolean>())
  const running = useRef(false)
  // a ref, not a callback: the listeners below are armed once per project, not per render
  const ask = useRef(async (list: readonly string[], force = false): Promise<void> => {
    for (const cwd of list) queued.current.set(cwd, force || queued.current.get(cwd) === true)
    if (running.current) return
    running.current = true
    try {
      while (queued.current.size) {
        const batch = [...queued.current]
        queued.current.clear()
        const forced = batch.filter(([, f]) => f).map(([cwd]) => cwd)
        const plain = batch.filter(([, f]) => !f).map(([cwd]) => cwd)
        // the project this was asked for: an answer that comes back after a switch is dropped
        const projectId = projectRef.current
        const answers = await Promise.all([
          forced.length ? window.api.gh.branchPrs(forced, true) : Promise.resolve({}),
          plain.length ? window.api.gh.branchPrs(plain) : Promise.resolve({}),
        ])
        if (projectId !== projectRef.current) continue
        const asked = [...forced, ...plain]
        const answer: BranchPrs = { ...answers[0], ...answers[1] }
        setShown((prev) =>
          prev.projectId === projectId
            ? { projectId, prs: mergePrs(prev.prs, asked, answer) }
            : { projectId, prs: mergePrs({}, asked, answer) },
        )
      }
    } catch {
      // an IPC failure shows nothing, as gh's own failures do; the next event asks again
      queued.current.clear()
    } finally {
      running.current = false
    }
  })

  // the project as a whole: on opening it and when its sessions come or go
  useEffect(() => {
    void ask.current(cwdKey ? cwdKey.split('\0') : [])
  }, [project.id, cwdKey])

  // a session switch: the one now on screen
  useEffect(() => {
    if (activeCwd) void ask.current([activeCwd])
  }, [activeCwd])

  // events that already exist: writes and turn ends, a PR opened from the app, the window coming back
  useEffect(() => {
    const all = (): void => void ask.current(cwdsRef.current)
    const offChanges = onChangesInvalidated((path) => {
      const hit = cwdsRef.current.filter((cwd) => pathsOverlap(path, cwd))
      if (hit.length) void ask.current(hit)
    })
    const offPr = onPrStatusInvalidated((cwd) => void ask.current([cwd], true))
    const onVisible = (): void => {
      if (!document.hidden) all()
    }
    window.addEventListener('focus', all)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      offChanges()
      offPr()
      window.removeEventListener('focus', all)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const prs = shown.projectId === project.id ? shown.prs : EMPTY
  // the slow timer, only while something runs; a string so it re-arms only when that set changes
  const pendingKey = pendingCwds(prs).join('\0')
  useEffect(() => {
    if (!pendingKey) return
    const timer = window.setInterval(() => {
      if (!document.hidden) void ask.current(pendingKey.split('\0'))
    }, PR_PENDING_POLL_MS)
    return () => window.clearInterval(timer)
  }, [pendingKey])

  return prs
}

const EMPTY: BranchPrs = {}
