import type { AgentHookPaths, Session, Settings, TerminalTab } from '../../../shared/types'
import { withWorktreeEnv } from '../../../shared/worktreeSetup'
import { commandFor, envFor, findAgent } from './agents'

/**
 * Starts a tab's process with no pane to show it.
 *
 * A tab's process normally starts when its pane is first mounted, and a pane exists only for the
 * session on screen — a tab of any other session would wait for the person to go there. So it
 * is started here, with exactly what the pane would pass; the pane that mounts later re-attaches
 * to it (`pty.start` on a live id), takes the kept output and applies its measured size. No size
 * now: there is no pane to measure. True when a process is running for the tab afterwards.
 */
export async function startWithoutPane(
  settings: Settings,
  hookPaths: AgentHookPaths | null,
  projectPath: string,
  session: Session,
  terminal: TerminalTab,
): Promise<boolean> {
  const agent = findAgent(settings, terminal.agentId)
  const command = commandFor(agent, terminal, hookPaths ?? undefined)
  const env = withWorktreeEnv(envFor(agent, terminal), projectPath, session.worktree)
  const res = await window.api.pty
    .start({
      id: terminal.id,
      cwd: session.cwd,
      kind: terminal.kind,
      ...(command === undefined ? {} : { initialCommand: command }),
      ...(env === undefined ? {} : { env }),
      sleepable: terminal.kind === 'agent',
    })
    .catch(() => null)
  return Boolean(res?.alive)
}
