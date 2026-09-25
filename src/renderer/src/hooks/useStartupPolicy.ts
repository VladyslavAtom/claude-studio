import { useCallback, useEffect } from 'react'
import { COMMIT_VIA_SERVICE, SERVICE_ARGS } from '../../../shared/types'
import { useLoaded } from '../state/appStateContext'
import { useRuntimeActions } from '../state/runtimeContext'
import { useAppStateRef } from '../state/selectors'
import { useUiActions } from '../state/uiContext'
import { useResolveLaunched } from './useAgentTracking'

/**
 * What happens right after the state is loaded: whether to bring the agent tabs up and whether
 * to warm the service session. Both decisions are taken once per start.
 */
export function useStartupPolicy(): { startAllAgents: () => void } {
  const stateRef = useAppStateRef()
  const loaded = useLoaded()
  const { wake } = useRuntimeActions()
  const { openModal, closeModal } = useUiActions()
  const resolveLaunched = useResolveLaunched()

  const startAllAgents = useCallback(() => {
    closeModal()
    for (const project of stateRef.current.projects) {
      for (const session of project.sessions) {
        for (const terminal of session.terminals) {
          // «start them all» (modals.startup.all) is about agents: shells, editors and diffs would
          // raise ptys and panels for nothing
          if (terminal.kind !== 'agent') continue
          void resolveLaunched(project.id, session.id, terminal).finally(() => wake(terminal.id))
        }
      }
    }
  }, [closeModal, resolveLaunched, stateRef, wake])

  useEffect(() => {
    if (!loaded) return
    const { projects, settings } = stateRef.current
    const sessions = projects.flatMap((p) => p.sessions)
    const agentTabs = sessions.flatMap((x) => x.terminals).filter((t) => t.kind === 'agent').length
    if (agentTabs === 0) return
    // starting them all has to go through the conversation-exists check as well
    if (settings.startup === 'all') startAllAgents()
    else if (settings.startup === 'ask') openModal({ kind: 'startup', agents: agentTabs, sessions: sessions.length })
  }, [loaded, openModal, startAllAgents, stateRef])

  /**
   * Warming the service session: starting a CLI costs about five seconds, so we pay them once
   * when the app starts rather than at the moment a commit message is actually needed.
   */
  useEffect(() => {
    if (!loaded) return
    // the settings are read from a ref: warm up once per start, not on every change to them
    const { projects, settings } = stateRef.current
    const cfg = settings.commitMessage
    if (cfg.agentId !== COMMIT_VIA_SERVICE || cfg.warmOnStart === false) return
    const base = settings.agents.find((a) => a.preset === 'claude') ?? settings.agents[0]
    if (!base) return
    // with a delay: the window, the panels and the tabs are all coming up at start anyway
    const timer = window.setTimeout(() => {
      void window.api.agents.serviceWarmUp({
        command: base.command,
        args: cfg.args.length ? cfg.args : SERVICE_ARGS,
        env: base.env,
        cwd: projects[0]?.path ?? '.',
      })
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [loaded, stateRef])

  return { startAllAgents }
}
