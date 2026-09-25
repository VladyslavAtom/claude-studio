import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'
import type { AppState, Project, Session, Settings } from '../../../shared/types'
import { useAppState } from './appStateContext'

export function activeProjectOf(state: AppState): Project | null {
  return state.projects.find((p) => p.id === state.activeProjectId) ?? null
}

export function activeSessionOf(project: Project | null): Session | null {
  return project?.sessions.find((s) => s.id === project.activeSessionId) ?? null
}

/**
 * No memo on either of these: both are a `find` over a list the consumer already re-rendered
 * for, and both hand back an object that lives in the state, so repeating the search returns
 * the very same reference. A memo would only add a dependency list to keep in step.
 */
export function useActiveProject(): Project | null {
  return activeProjectOf(useAppState())
}

export function useActiveSession(project: Project | null): Session | null {
  return activeSessionOf(project)
}

/**
 * Fresh state for long loops and handlers: a closure holds the snapshot it was created with.
 * The ref is filled in an effect rather than during render — otherwise an abandoned render
 * pass could reach the file we are writing. That is why this hook has to be called BEFORE the
 * effects that read from the ref: effects of one component run in declaration order.
 */
export function useAppStateRef(): RefObject<AppState> {
  const state = useAppState()
  const ref = useRef(state)
  useEffect(() => {
    ref.current = state
  }, [state])
  return ref
}

/** settings through a ref: otherwise every settings write rebuilds every handler that reads them */
export function useSettingsRef(): RefObject<Settings> {
  const state = useAppState()
  const ref = useRef(state.settings)
  useEffect(() => {
    ref.current = state.settings
  }, [state.settings])
  return ref
}
