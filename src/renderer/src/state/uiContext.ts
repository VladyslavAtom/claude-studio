import { createContext, useContext } from 'react'
import type { Project, Session } from '../../../shared/types'

/**
 * Everything that covers the work area, as a single value: two windows can never be open at
 * once, and the base for a worktree lives together with the window that needs it and dies
 * with it.
 */
export type Modal =
  /** the base is set when the session is created from the branch menu */
  | { kind: 'newSession'; project: Project; baseRef?: string }
  | { kind: 'clone' }
  | { kind: 'settings'; tab: 'agents' | 'commits' }
  | { kind: 'agentHistory' }
  | { kind: 'closeSession'; project: Project; session: Session }
  | { kind: 'startup'; agents: number; sessions: number }

export interface UiState {
  /** the "operation running" strip, or its result */
  busy: string | null
  error: string | null
  modal: Modal | null
}

export interface UiActions {
  setBusy: (msg: string | null) => void
  setError: (msg: string | null) => void
  openModal: (modal: Modal) => void
  closeModal: () => void
}

/** see appStateContext: contexts and hooks stay out of the provider's own module */
export const StateContext = createContext<UiState>({ busy: null, error: null, modal: null })
export const ActionsContext = createContext<UiActions>({
  setBusy: () => undefined,
  setError: () => undefined,
  openModal: () => undefined,
  closeModal: () => undefined,
})

export function useUiState(): UiState {
  return useContext(StateContext)
}

/** stable for the whole life of the app: the handlers that call them are never rebuilt */
export function useUiActions(): UiActions {
  return useContext(ActionsContext)
}
