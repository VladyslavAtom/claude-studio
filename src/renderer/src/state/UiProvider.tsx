import type { JSX, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import type { Modal, UiActions, UiState } from './uiContext'
import { ActionsContext, StateContext } from './uiContext'

export function UiProvider({ children }: { children: ReactNode }): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal | null>(null)

  const actions = useMemo<UiActions>(
    () => ({ setBusy, setError, openModal: (next) => setModal(next), closeModal: () => setModal(null) }),
    [],
  )
  const state = useMemo<UiState>(() => ({ busy, error, modal }), [busy, error, modal])

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  )
}
