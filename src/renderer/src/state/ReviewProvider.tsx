import type { JSX, ReactNode } from 'react'
import { useMemo, useReducer } from 'react'
import { reviewReducer } from '../lib/reviewComments'
import type { ReviewActions } from './reviewContext'
import { ActionsContext, StateContext } from './reviewContext'

/**
 * Review comments per session, in memory: above the session's tabs, so they survive the diff tab
 * being unmounted and the session being switched away from. Not written to state.json — see the
 * 2026-10-29 entry in docs/decisions.md.
 */
export function ReviewProvider({ children }: { children: ReactNode }): JSX.Element {
  const [store, dispatch] = useReducer(reviewReducer, {})
  const actions = useMemo<ReviewActions>(
    () => ({
      add: (sessionId, comment) => dispatch({ type: 'added', sessionId, comment }),
      edit: (sessionId, id, text) => dispatch({ type: 'edited', sessionId, id, text }),
      remove: (sessionId, ids) => dispatch({ type: 'removed', sessionId, ids }),
    }),
    [],
  )
  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={store}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  )
}
