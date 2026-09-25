import type { JSX, ReactNode } from 'react'
import { useMemo } from 'react'
import { useAgentTitleTracking } from '../hooks/useAgentTracking'
import { useAgentToolRequests } from '../hooks/useAgentToolRequests'
import { useAppShortcuts } from '../hooks/useAppShortcuts'
import { useLayout } from '../hooks/useLayout'
import { useProjectActions } from '../hooks/useProjectActions'
import { useSessionActions } from '../hooks/useSessionActions'
import { useStartupPolicy } from '../hooks/useStartupPolicy'
import { useTerminalActions } from '../hooks/useTerminalActions'
import type { Actions } from './actionsContext'
import { ActionsContext } from './actionsContext'
import { useRuntimeState } from './runtimeContext'

/**
 * This is where every action over the state comes together with the background watchers that
 * need both the state and the tab runtime: following conversation titles, the startup policy
 * and the keyboard shortcuts.
 */
export function ActionsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { awake } = useRuntimeState()
  const terminals = useTerminalActions()
  const sessions = useSessionActions()
  const projects = useProjectActions()
  const layout = useLayout()
  const { startAllAgents } = useStartupPolicy()

  useAgentTitleTracking(awake)
  useAgentToolRequests(sessions)
  useAppShortcuts(terminals, layout)

  const value = useMemo<Actions>(
    () => ({ projects, sessions, terminals, layout, startAllAgents }),
    [projects, sessions, terminals, layout, startAllAgents],
  )
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>
}
