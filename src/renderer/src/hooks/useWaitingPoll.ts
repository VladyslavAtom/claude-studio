import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'
import type { AgentActivity, Project, Session } from '../../../shared/types'
import { findAgent } from '../lib/agents'
import { useDispatch, useLoaded } from '../state/appStateContext'
import { useAppStateRef } from '../state/selectors'
import { storeDir, useAgentTitleSync } from './useAgentTracking'

export interface WaitingPollOptions {
  awake: Set<string>
  /** tabs already calling for the user; read through a ref so the interval is not re-armed */
  attentionRef: RefObject<Set<string>>
  onBell: (project: Project, session: Session, terminalId: string) => void
  /** the tab cannot report and so will never ring; the interface says so instead of going quiet */
  onSilent: (terminalId: string, silent: boolean) => void
  /** what the tab's own CLI says it is doing, or null when nothing answers for it */
  onActivity: (terminalId: string, activity: AgentActivity | null) => void
}

/**
 * How long a tab may be awake and say nothing before it is called silent.
 *
 * The measure is time awake rather than "has printed something": output only reaches the
 * renderer through a mounted pane, and a pane exists only for the session that is on screen —
 * a tab in a background session would never qualify. Generous on purpose: the shell, the rc
 * files and the CLI's own start all happen inside this window, and a badge that flashes at
 * every start is a badge people learn to ignore.
 */
const SILENT_AFTER_MS = 20_000

/**
 * Claude Code does not ring the terminal bell: the stream carries only the window title. So the
 * CLI is asked, through the hooks of the overlay every claude tab is started with (see
 * `main/agentHooks`). Only live agent tabs are polled, and only while the window is open.
 *
 * **`Stop` is «the agent has finished»** — and it is the only thing that is. The conversation
 * record used to be read for this, and it cannot answer: a Task subagent writes into the same
 * file and its turn ends with the same `stop_reason: end_turn`, so «Teammate @plan-B finished»
 * rang the bell while the main agent went on working. That read is gone rather than kept as a
 * second path — one signal cannot be trusted while a second one is allowed to disagree with it.
 *
 * **`Notification` is «the agent wants you now»** — a permission prompt, or an agent left idle.
 * `Stop` cannot cover it: an agent blocked on a prompt has not stopped, and is waiting for
 * exactly one person. It rings, but it does not end a turn, so it does not re-read the name.
 *
 * **A codex tab is polled for one thing only: which conversation it is in.** It reports no
 * events, so its counts are zero and it rings exactly as much as it did before — never. What it
 * does report is the thread codex picked, which is the only way to learn it and the only way to
 * notice it changing.
 *
 * **A claude tab that reports nothing is reported.** With no fallback left, a CLI whose hooks are
 * off would simply stop ringing and nothing would say why. The CLI reports a start for every tab,
 * so a tab that has been awake long enough to have started and still has no report is deaf, and
 * the tab strip marks it. **A codex tab is never marked**: silence there means «has not answered
 * yet» at least as often as «cannot report», the marker's sentence is about a bell it never had,
 * and a badge sitting on every codex tab for as long as it is thinking is one people learn to
 * ignore.
 *
 * The end of a turn is also the moment the tab's name is re-read. This is the one place that
 * already watches every live tab, including the tabs of sessions that are not on screen — those
 * have no mounted pane and so emit nothing the renderer could listen to.
 *
 * It is also where a tab notices that its CLI has left the conversation the tab was started
 * with — `/clear` opens a new one with an id of its own.
 *
 * **And it is where a claude tab is asked what it is doing.** That is a state rather than an
 * event — a file the running CLI keeps about itself, read in main by conversation id (see
 * `agentSessions.agentActivity`) — so it is fetched on the same pass, for the same tabs, over one
 * more call. No file, no answer, and the tab is judged by its output as before.
 *
 * The poll walks the tabs one after another, over IPC, once every 4 s. This is temporary: main
 * owns these files and could send an event — then this hook disappears entirely.
 */
export function useWaitingPoll({ awake, attentionRef, onBell, onSilent, onActivity }: WaitingPollOptions): void {
  const stateRef = useAppStateRef()
  const loaded = useLoaded()
  const dispatch = useDispatch()
  const syncTitle = useAgentTitleSync()
  /** a poll pass is already running: on a slow disk it does not keep up with the interval */
  const scanning = useRef(false)
  /** when each tab was first seen awake — the clock the silence is measured against */
  const awakeSince = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (!loaded) return
    const tick = async (): Promise<void> => {
      // a pass over every tab may not fit into the interval; ticks are never overlapped
      if (document.hidden || scanning.current) return
      scanning.current = true
      try {
        // a tab that has gone away or gone to sleep starts its clock afresh when it comes back
        for (const id of [...awakeSince.current.keys()]) if (!awake.has(id)) awakeSince.current.delete(id)
        for (const project of stateRef.current.projects) {
          for (const session of project.sessions) {
            for (const terminal of session.terminals) {
              // A conversation id is not required to poll: a codex tab has none until its first
              // turn ends, and that turn is what this call is here to catch.
              if (terminal.kind !== 'agent' || !awake.has(terminal.id)) continue
              const agent = findAgent(stateRef.current.settings, terminal.agentId)
              // Both reporting agents are asked; an agent with no conversation of its own
              // (`none`) is started with nothing and has nothing to say.
              if (!agent || agent.sessionSource === 'none') continue
              const since = awakeSince.current.get(terminal.id) ?? Date.now()
              awakeSince.current.set(terminal.id, since)

              // Everything the tab's own CLI has said since the last pass. The call takes the
              // events rather than reading them, so whatever comes back has to be acted on right
              // here — dropping it drops a bell.
              const report = await window.api.agents.takeHookReport(terminal.id)

              // Asked before anything is decided about the report, and for the freshly reported
              // id when there is one: after `/clear` the tab's own id is one conversation behind
              // for the rest of this pass. Only claude keeps such a file; a codex tab is never in
              // this map, and its dot is what it always was.
              if (agent.sessionSource === 'uuid') {
                const conversation = report.session?.sessionId ?? terminal.agentSessionId
                const activity = conversation
                  ? await window.api.agents.activity(conversation, storeDir(terminal, agent.env.CLAUDE_CONFIG_DIR))
                  : null
                onActivity(terminal.id, activity)
              }

              if (!report.session) {
                // A claude tab this long awake has finished starting. If it has still said
                // nothing, its hooks never fire, and from here on nothing would tell the person
                // it is done. Codex is not the same case: it names its thread when a turn ends
                // and never at a start, so a tab that has not answered yet is simply quiet, and
                // it has no bell to lose either way.
                if (agent.sessionSource === 'uuid' && Date.now() - since >= SILENT_AFTER_MS) {
                  onSilent(terminal.id, true)
                }
                continue
              }
              onSilent(terminal.id, false)

              // `/clear` abandons the id a claude tab was started with, and a codex tab is never
              // told an id at all; following the reported one is what keeps the name and the next
              // resume pointing at the conversation the person is in. `compact` reports too, with
              // the id unchanged — so the test is that the id differs, never which event produced
              // it.
              const rebound = report.session.sessionId !== terminal.agentSessionId
              if (rebound) {
                dispatch({
                  type: 'agentSessionCaptured',
                  projectId: project.id,
                  sessionId: session.id,
                  terminalId: terminal.id,
                  agentSessionId: report.session.sessionId,
                })
              }

              // One bell per event. Two of them inside one interval are two files on disk and
              // two calls here — main cannot collapse them, and neither can this. A finished
              // turn and a call for attention both mean «you»; they are counted apart because
              // only the first of them ends a turn.
              //
              // A call for attention adds nothing while the tab is already calling: the CLI
              // raises an idle notification a minute after a turn ends, so an unanswered `Stop`
              // would otherwise ring a second time, in the same words, for the same reason. Once
              // the person has looked, the tab leaves `attention` and a later notification is
              // news again — it means the tab is still waiting.
              const calling = attentionRef.current.has(terminal.id) || report.stops > 0
              const rings = report.stops + (calling ? 0 : report.notifications)
              for (let i = 0; i < rings; i++) {
                onBell(project, session, terminal.id)
              }

              // The name is re-read only when a turn has ended and the tab's id has settled: on
              // the tick that rebinds it the state still carries the old one, and reading the
              // conversation the tab has just left would put its name back on the tab. Only
              // claude reaches here at all — a codex tab reports no events, so its counts are
              // zero — but the id is still what the read needs, and a codex tab may not have one.
              if (report.stops && !rebound && terminal.agentSessionId) {
                void syncTitle({
                  projectId: project.id,
                  sessionId: session.id,
                  terminalId: terminal.id,
                  agentSessionId: terminal.agentSessionId,
                })
              }
            }
          }
        }
      } finally {
        scanning.current = false
      }
    }
    const t = window.setInterval(() => void tick(), 4000)
    void tick()
    return () => window.clearInterval(t)
  }, [loaded, awake, attentionRef, onBell, onSilent, onActivity, dispatch, stateRef, syncTitle])
}
