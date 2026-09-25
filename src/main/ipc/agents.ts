import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/channels'
import type { AgentToolResult, ExternalSessionQuery, ServiceConfig } from '../../shared/types'
import { hookPaths, takeHookReport } from '../agentHooks'
import { replyToolRequest } from '../agentTools'
import { agentActivity, listExternalSessions, sessionExists, sessionTitle } from '../agentSessions'
import { serviceAlive, serviceAsk, serviceWarmUp, shutdownService } from '../serviceAgent'

const CH = CHANNELS.agent

/** the agents' conversations: their own stores, and the warmed-up service session */
export function register(): void {
  ipcMain.handle(CH.listExternalSessions, (_e, projectPath: string, queries: ExternalSessionQuery[]) =>
    listExternalSessions(projectPath, queries),
  )
  ipcMain.handle(CH.serviceAsk, (_e, cfg: ServiceConfig, prompt: string, payload: string, timeoutMs?: number) =>
    serviceAsk(cfg, prompt, payload, timeoutMs),
  )
  ipcMain.handle(CH.serviceWarmUp, (_e, cfg: ServiceConfig) => serviceWarmUp(cfg))
  ipcMain.handle(CH.serviceAlive, () => serviceAlive())
  ipcMain.handle(CH.serviceStop, () => shutdownService())
  ipcMain.handle(CH.sessionTitle, (_e, kind: 'claude' | 'codex', id: string, configDir?: string) =>
    sessionTitle(kind, id, configDir),
  )
  ipcMain.handle(CH.sessionExists, (_e, kind: 'claude' | 'codex', id: string, configDir?: string) =>
    sessionExists(kind, id, configDir),
  )
  ipcMain.handle(CH.hookPaths, () => hookPaths())
  ipcMain.handle(CH.takeHookReport, (_e, terminalId: string) => takeHookReport(terminalId))
  ipcMain.handle(CH.activity, (_e, sessionId: string, configDir?: string) => agentActivity(sessionId, configDir))
  // the answer to a request an agent made through its tool; it travels back as a file the
  // blocked tool call is watching for
  ipcMain.handle(CH.toolReply, (_e, id: string, result: AgentToolResult) => replyToolRequest(id, result))
}
