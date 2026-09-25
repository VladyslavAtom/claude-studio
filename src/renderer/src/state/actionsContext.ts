import { createContext, useContext } from 'react'
import type { LayoutActions } from '../hooks/useLayout'
import type { ProjectActions } from '../hooks/useProjectActions'
import type { SessionActions } from '../hooks/useSessionActions'
import type { TerminalActions } from '../hooks/useTerminalActions'

export interface Actions {
  projects: ProjectActions
  sessions: SessionActions
  terminals: TerminalActions
  layout: LayoutActions
  /** "start all" from the startup window */
  startAllAgents: () => void
}

/** see appStateContext: contexts and hooks stay out of the provider's own module */
export const ActionsContext = createContext<Actions | null>(null)

export function useActions(): Actions {
  const actions = useContext(ActionsContext)
  if (!actions) throw new Error('useActions used outside ActionsProvider')
  return actions
}
