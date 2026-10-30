import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project, ProjectWorktrees, Settings } from '../../../shared/types'
import { onChangesInvalidated } from '../lib/changesRefresh'
import { sessionTranscripts } from '../lib/worktrees'

interface Shown {
  /** whose answer this is: a switch to another project shows nothing until its own arrives */
  projectId: string
  data: ProjectWorktrees
}

/**
 * The worktrees of the project on screen and which of them each session worked in. Read on
 * events that already exist — the project opened or its conversations changed, the window coming
 * back, a turn end or a write (`changesInvalidated`) — never on a timer. A read asked for while
 * one runs becomes one follow-up, so a burst of events is one round trip.
 */
export function useProjectWorktrees(
  project: Project,
  settings: Settings,
): { data: ProjectWorktrees | null; refresh: () => void } {
  const [shown, setShown] = useState<Shown | null>(null)
  const transcripts = useMemo(() => sessionTranscripts(project.sessions, settings), [project.sessions, settings])
  // a string, so the read re-arms when a conversation is added, not on every edit of a session
  const key = JSON.stringify(transcripts)

  const latest = useRef({ projectId: project.id, path: project.path, transcripts })
  useEffect(() => {
    latest.current = { projectId: project.id, path: project.path, transcripts }
  })

  const running = useRef(false)
  const again = useRef(false)
  // a ref, not a callback: the listeners below are armed once, not per render
  const read = useRef(async (): Promise<void> => {
    if (running.current) {
      again.current = true
      return
    }
    running.current = true
    try {
      do {
        again.current = false
        const { projectId, path, transcripts: asked } = latest.current
        const data = await window.api.worktrees.list(path, asked)
        // an answer for the previous project is dropped; the follow-up asks for the current one
        if (projectId === latest.current.projectId) setShown({ projectId, data })
        else again.current = true
      } while (again.current)
    } catch {
      // nothing to show is the failure mode: the rows fall back to what the session itself knows
    } finally {
      running.current = false
    }
  })

  useEffect(() => {
    void read.current()
  }, [project.id, key])

  useEffect(() => {
    const all = (): void => void read.current()
    const off = onChangesInvalidated(all)
    const onVisible = (): void => {
      if (!document.hidden) all()
    }
    window.addEventListener('focus', all)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      off()
      window.removeEventListener('focus', all)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const refresh = useMemo(() => () => void read.current(), [])
  return { data: shown?.projectId === project.id ? shown.data : null, refresh }
}
