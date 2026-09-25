import { createContext, useContext } from 'react'
import type { TerminalRuntimeActions, TerminalRuntimeState } from '../hooks/useTerminalRuntime'

/** see appStateContext: contexts and hooks stay out of the provider's own module */
export const StateContext = createContext<TerminalRuntimeState>({
  awake: new Set(),
  attention: new Set(),
  busyIds: new Set(),
  agentActivity: new Map(),
  silent: new Set(),
  snapshots: new Map(),
})
export const ActionsContext = createContext<TerminalRuntimeActions>({
  wake: () => undefined,
  rememberSnapshot: () => undefined,
  markActivity: () => undefined,
  markSeen: () => undefined,
  forgetTerminals: () => undefined,
  onBell: () => undefined,
})

/** which tabs are alive, which are calling and which are noisy right now */
export function useRuntimeState(): TerminalRuntimeState {
  return useContext(StateContext)
}

export function useRuntimeActions(): TerminalRuntimeActions {
  return useContext(ActionsContext)
}
