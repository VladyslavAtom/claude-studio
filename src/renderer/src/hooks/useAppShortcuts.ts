import { useEffect } from 'react'
import { isKey } from '../lib/keys'
import { useRuntimeActions } from '../state/runtimeContext'
import { activeProjectOf, activeSessionOf, useAppStateRef, useSettingsRef } from '../state/selectors'
import type { LayoutActions } from './useLayout'
import type { TerminalActions } from './useTerminalActions'

/**
 * Global keyboard shortcuts. The active project and session are read from a ref at the moment
 * of the keypress: the handler is attached once and so never sees a stale snapshot.
 */
export function useAppShortcuts(terminals: TerminalActions, layout: LayoutActions): void {
  const stateRef = useAppStateRef()
  const settingsRef = useSettingsRef()
  const { markSeen } = useRuntimeActions()
  const { addTerminal, closeTerminal, selectTerminal } = terminals
  const { togglePanel } = layout

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Escape in the settings belongs to the page: closing it from here walks past its
      // unsaved-changes prompt and drops everything the user typed
      // an `as HTMLElement` here was a lie about a cast: a key event whose target is the window
      // (a synthetic one, the screenshot harness's among them) has no `classList`, and the read
      // below threw instead of falling back to «not a field»
      const target = e.target instanceof HTMLElement ? e.target : null
      const field =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      // xterm keeps the focus in a textarea of its own — that is the terminal, not a field of the
      // app: counting it as typing would disable the shortcuts exactly where the focus usually is
      const inTerminal = target?.classList.contains('xterm-helper-textarea') ?? false
      const typing = field && !inTerminal
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const activeProject = activeProjectOf(stateRef.current)
      if (!activeProject) return
      const activeSession = activeSessionOf(activeProject)

      // switching tabs works while typing too: Ctrl+Tab prints nothing
      if (e.key === 'Tab' && activeSession) {
        e.preventDefault()
        const tabs = activeSession.terminals
        if (tabs.length < 2) return
        const idx = tabs.findIndex((t) => t.id === activeSession.activeTerminalId)
        const next = tabs[(idx + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]
        // findIndex returns -1 when the active tab is already gone; that lands inside the list
        // just as well, but a state where it does not is a reason to do nothing, not to crash
        if (!next) return
        selectTerminal(activeProject, activeSession, next.id)
        markSeen(next.id)
        return
      }

      // what follows are the keys that have no business firing inside an input field
      if (typing) return
      if (isKey(e, 'b')) {
        e.preventDefault()
        togglePanel('filesOpen')
        return
      }
      // Ctrl+T and Ctrl+W belong to the terminal (in a shell Ctrl+W deletes a word) — not caught there
      if (field) return
      if (!activeSession) return

      if (isKey(e, 't')) {
        e.preventDefault()
        const first = settingsRef.current.agents.find((a) => a.enabled)
        addTerminal(activeProject, activeSession, e.shiftKey ? null : (first?.id ?? null))
      }
      if (isKey(e, 'w') && activeSession.activeTerminalId) {
        e.preventDefault()
        void closeTerminal(activeProject, activeSession, activeSession.activeTerminalId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addTerminal, closeTerminal, selectTerminal, markSeen, togglePanel, settingsRef, stateRef])
}
