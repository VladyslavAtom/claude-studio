import type { JSX, ReactNode } from 'react'
import { useTerminalRuntime } from '../hooks/useTerminalRuntime'
import { ActionsContext, StateContext } from './runtimeContext'

export function RuntimeProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state, actions } = useTerminalRuntime()
  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  )
}
