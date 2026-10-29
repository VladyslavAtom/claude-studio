import { createContext, useContext } from 'react'
import type { ReviewComment, ReviewStore } from '../lib/reviewComments'

export interface ReviewActions {
  add: (sessionId: string, comment: ReviewComment) => void
  edit: (sessionId: string, id: string, text: string) => void
  remove: (sessionId: string, ids: readonly string[]) => void
}

/** see appStateContext: contexts and hooks stay out of the provider's own module */
export const StateContext = createContext<ReviewStore>({})
export const ActionsContext = createContext<ReviewActions>({
  add: () => undefined,
  edit: () => undefined,
  remove: () => undefined,
})

const NONE: readonly ReviewComment[] = []

/** the review comments of one session, not yet sent to its agent */
export function useReviewComments(sessionId: string): readonly ReviewComment[] {
  return useContext(StateContext)[sessionId] ?? NONE
}

export function useReviewActions(): ReviewActions {
  return useContext(ActionsContext)
}
