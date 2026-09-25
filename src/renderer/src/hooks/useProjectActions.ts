import { useCallback, useMemo } from 'react'
import type { Project } from '../../../shared/types'
import { useT } from '../i18n'
import { basename, uid } from '../lib/util'
import { useDispatch } from '../state/appStateContext'
import { useRuntimeActions } from '../state/runtimeContext'
import { useAppStateRef } from '../state/selectors'

export interface ProjectActions {
  addProject: (path: string) => Promise<void>
  openFolder: () => Promise<void>
  closeProject: (projectId: string) => void
  /** bring a closed project back without going through the folder picker */
  reopenProject: (projectId: string) => Promise<void>
  forgetClosedProject: (projectId: string) => void
  selectProject: (projectId: string) => void
  renameProject: (projectId: string, name: string) => void
  reorderProjects: (from: number, to: number) => void
}

export function useProjectActions(): ProjectActions {
  const t = useT()
  const stateRef = useAppStateRef()
  const dispatch = useDispatch()
  const { forgetTerminals } = useRuntimeActions()

  /**
   * A restored project's sessions live in worktrees that may have been deleted while it was
   * closed. Their roots have to be registered before anything reads them, and the ones that are
   * gone move to the project's history — an unopenable session in the list would only mislead.
   */
  const settleRestored = useCallback(
    async (projectId: string) => {
      const project = stateRef.current.projects.find((p) => p.id === projectId)
      if (!project) return
      const checked = await Promise.all(
        project.sessions.map(async (session) => ({ session, alive: await window.api.fs.exists(session.cwd) })),
      )
      await Promise.all(checked.filter((c) => c.alive).map((c) => window.api.files.registerRoot(c.session.cwd)))
      const sessionIds = checked.filter((c) => !c.alive).map((c) => c.session.id)
      if (sessionIds.length > 0)
        dispatch({ type: 'projectSessionsPruned', projectId, sessionIds, prunedAt: Date.now() })
    },
    [dispatch, stateRef],
  )

  const addProject = useCallback(
    async (path: string) => {
      const root = await window.api.git.repoRoot(path)
      const projectPath = root ?? path
      // main allows file operations only inside registered roots, and a path from the state gets
      // there only after the deferred write — the file tree opens earlier than that
      await window.api.files.registerRoot(projectPath)
      const project: Project = {
        id: uid(),
        name: basename(projectPath),
        path: projectPath,
        isGit: Boolean(root),
        sessions: [],
        activeSessionId: null,
        history: [],
      }
      // already open, or closed earlier and restored whole — the reducer decides which
      const restored = stateRef.current.closedProjects.find((p) => p.path === projectPath)
      dispatch({ type: 'projectAdded', project })
      if (restored) await settleRestored(restored.id)
    },
    [dispatch, settleRestored, stateRef],
  )

  const openFolder = useCallback(async () => {
    const dir = await window.api.dialog.pickDirectory(t('projects.pick.title'))
    if (dir) await addProject(dir)
  }, [addProject, t])

  const closeProject = useCallback(
    (projectId: string) => {
      // the tab list comes from the fresh state: more of them may have appeared during the handler's life
      const project = stateRef.current.projects.find((p) => p.id === projectId)
      const ids = project?.sessions.flatMap((s) => s.terminals.map((t) => t.id)) ?? []
      ids.forEach((id) => void window.api.pty.kill(id))
      forgetTerminals(ids)
      // the project is not discarded, only set aside: its sessions come back with the folder
      dispatch({ type: 'projectClosed', projectId, closedAt: Date.now() })
    },
    [dispatch, forgetTerminals, stateRef],
  )

  const reopenProject = useCallback(
    async (projectId: string) => {
      const closed = stateRef.current.closedProjects.find((p) => p.id === projectId)
      if (!closed) return
      await window.api.files.registerRoot(closed.path)
      // matched by path, so this restores the closed entry rather than adding an empty project
      dispatch({ type: 'projectAdded', project: { ...closed } })
      await settleRestored(closed.id)
    },
    [dispatch, settleRestored, stateRef],
  )

  const forgetClosedProject = useCallback(
    (projectId: string) => dispatch({ type: 'closedProjectForgotten', projectId }),
    [dispatch],
  )

  const selectProject = useCallback(
    (projectId: string) => dispatch({ type: 'projectActivated', projectId }),
    [dispatch],
  )

  const renameProject = useCallback(
    (projectId: string, name: string) => dispatch({ type: 'projectRenamed', projectId, name }),
    [dispatch],
  )

  const reorderProjects = useCallback(
    (from: number, to: number) => dispatch({ type: 'projectsReordered', from, to }),
    [dispatch],
  )

  return useMemo(
    () => ({
      addProject,
      openFolder,
      closeProject,
      reopenProject,
      forgetClosedProject,
      selectProject,
      renameProject,
      reorderProjects,
    }),
    [
      addProject,
      openFolder,
      closeProject,
      reopenProject,
      forgetClosedProject,
      selectProject,
      renameProject,
      reorderProjects,
    ],
  )
}
