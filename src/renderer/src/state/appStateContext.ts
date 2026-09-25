import type { Dispatch } from 'react'
import { createContext, useContext } from 'react'
import type { AgentHookPaths, AppState } from '../../../shared/types'
import { emptyState } from '../../../shared/types'
import type { Action } from './appReducer'

/**
 * Contexts and their hooks live apart from the provider component: a module that exports both
 * a component and plain functions loses fast refresh, and every hook here is imported by files
 * that never render the provider.
 */
export const StateContext = createContext<AppState>(emptyState)
export const DispatchContext = createContext<Dispatch<Action>>(() => undefined)
export const LoadedContext = createContext(false)
export const HookPathsContext = createContext<AgentHookPaths | null>(null)

/** persisted state as it is right now; every consumer re-renders when any part of it changes */
export function useAppState(): AppState {
  return useContext(StateContext)
}

export function useDispatch(): Dispatch<Action> {
  return useContext(DispatchContext)
}

/** false until the state file has been read: nothing may be written before that */
export function useLoaded(): boolean {
  return useContext(LoadedContext)
}

/**
 * What tabs are started with so their CLIs report back — the claude overlay and the codex notify
 * program — or null when main could not write them. It lives beside `loaded` because it is read
 * during render, when a tab's command line is built: a value that arrived one effect later would
 * let the first tab spawn without it.
 */
export function useHookPaths(): AgentHookPaths | null {
  return useContext(HookPathsContext)
}
