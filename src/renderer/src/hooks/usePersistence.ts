import { useCallback, useEffect, useRef } from 'react'
import type { AppState } from '../../../shared/types'
import { useT } from '../i18n'
import { useUiActions } from '../state/uiContext'

export interface Persistence {
  /** write the state right now, cancelling the pending deferred write */
  flush: () => Promise<void>
  /** this is already on disk: state that was only just read back needs no write */
  markClean: (state: AppState) => void
}

/**
 * Writing the state: deferred by 400 ms, but flushed before the window closes. Agents rewrite
 * titles and statuses all the time, so only what really changed is written.
 *
 * A refused save answers `ok: false` instead of throwing — main will not overwrite a file
 * written by a newer build, nor one it could not move aside when it turned out to be corrupt —
 * so the answer has to be read every time, or the save is lost without a word.
 */
export function usePersistence(state: AppState, loaded: boolean): Persistence {
  const t = useT()
  const stateRef = useRef<AppState>(state)
  const saveTimer = useRef<number | null>(null)
  const lastSaved = useRef<string>('')
  /** the write currently on the wire: its payload is not on disk yet, so it is not `lastSaved` */
  const inFlight = useRef<{ payload: string; done: Promise<void> } | null>(null)
  const { setError } = useUiActions()

  // assigning during render would let an abandoned render pass reach the file we save;
  // this effect is declared first, so everything below sees the state of its own commit
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const flushState = useCallback(
    async (next: AppState): Promise<void> => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      const payload = JSON.stringify(next)
      if (payload === lastSaved.current) return
      // the very same bytes are already being written: wait for that write instead of queuing
      // a second one, and do not resolve early — the quit handler answers as soon as this does
      if (inFlight.current?.payload === payload) return inFlight.current.done
      const done = (async (): Promise<void> => {
        try {
          const res = await window.api.state.save(next)
          // recording the payload before the answer is what used to hide a refusal: every later
          // identical save was skipped as a no-op, so the app looked like it was saving forever
          if (!res.ok) setError(t('common.state.notSaved', { reason: res.error }))
          else lastSaved.current = payload
        } catch (err) {
          setError(t('common.state.notSaved', { reason: String(err) }))
        }
      })()
      inFlight.current = { payload, done }
      try {
        await done
      } finally {
        if (inFlight.current?.done === done) inFlight.current = null
      }
    },
    [setError, t],
  )

  const flush = useCallback((): Promise<void> => flushState(stateRef.current), [flushState])

  const markClean = useCallback((clean: AppState): void => {
    lastSaved.current = JSON.stringify(clean)
  }, [])

  // before the state is loaded there is nothing to write: we would overwrite the file with a blank
  useEffect(() => {
    if (!loaded) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void flushState(state), 400)
  }, [state, loaded, flushState])

  /**
   * The window can be closed during the 400 ms a mutation waits to be written — the last edit
   * would then be lost. Before unload, and when the window goes to the background, write at once.
   */
  useEffect(() => {
    if (!loaded) return
    const onFlush = (): void => void flush()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') onFlush()
    }
    window.addEventListener('beforeunload', onFlush)
    window.addEventListener('pagehide', onFlush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', onFlush)
      window.removeEventListener('pagehide', onFlush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loaded, flush])

  /**
   * Quitting: main does not close the window straight away, it sends `app:beforeQuit` and waits
   * for an answer (with a 2 s safety net). We finish writing the state and answer either way:
   * without quitReady the close hangs until that timer fires.
   */
  useEffect(() => {
    return window.api.app.onBeforeQuit(() => {
      void (async () => {
        try {
          // before the state is loaded there is nothing to write: we would overwrite the file with a blank
          if (loaded) await flush()
        } finally {
          await window.api.app.quitReady()
        }
      })()
    })
  }, [loaded, flush])

  return { flush, markClean }
}
