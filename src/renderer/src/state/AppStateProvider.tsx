import type { JSX, ReactNode } from 'react'
import { useEffect, useReducer, useState } from 'react'
import type { AgentHookPaths } from '../../../shared/types'
import { emptyState } from '../../../shared/types'
import { usePersistence } from '../hooks/usePersistence'
import { appReducer } from './appReducer'
import { DispatchContext, HookPathsContext, LoadedContext, StateContext } from './appStateContext'

export function AppStateProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(appReducer, emptyState)
  const [loaded, setLoaded] = useState(false)
  const [hookPaths, setHookPaths] = useState<AgentHookPaths | null>(null)
  const { markClean } = usePersistence(state, loaded)

  useEffect(() => {
    // The reporting paths are not state, but they are needed at the same moment state is:
    // nothing may render a terminal before `loaded`, and the first thing a terminal does is build
    // a command line that has to carry them. So they are fetched alongside, and a failure to
    // fetch them is not allowed to hold the application on its loading screen — that is the null.
    const paths = window.api.agents.hookPaths().catch(() => null)
    void Promise.all([window.api.state.load(), paths]).then(([s, hooks]) => {
      markClean(s)
      dispatch({ type: 'loaded', state: s })
      setHookPaths(hooks)
      setLoaded(true)
    })
  }, [markClean])

  return (
    <LoadedContext.Provider value={loaded}>
      <HookPathsContext.Provider value={hookPaths}>
        <DispatchContext.Provider value={dispatch}>
          <StateContext.Provider value={state}>{children}</StateContext.Provider>
        </DispatchContext.Provider>
      </HookPathsContext.Provider>
    </LoadedContext.Provider>
  )
}
