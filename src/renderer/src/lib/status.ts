import type { AgentActivity, TerminalStatus } from '../../../shared/types'
// the key types only: this module must not drag the React provider into a test that has no DOM
import type { PluralKey } from '../i18n/keys'

/**
 * Everything the dot on a tab is decided from. Kept as one argument, and pure, because two places
 * draw it — the tab strip and the session pulse — and they used to reach the same conclusion by
 * two hand-written chains of `if`s that could disagree with each other.
 */
export interface StatusInput {
  /** the tab's process has exited and its pane is showing what it left behind */
  dead?: boolean
  /** there is a live pty; a sleeping tab has no process to have a state */
  awake: boolean
  /** the tab rang and nobody has looked at it since */
  attention: boolean
  /** what the tab's CLI says about itself, when anything answers for it — see `main/agentSessions` */
  activity?: AgentActivity | null
  /** the pane reported output in the last few seconds */
  busy: boolean
}

/**
 * What the tab is doing, in the order the answers can be trusted.
 *
 * `attention` first, above everything the process itself says: it does not mean «the agent is
 * blocked», it means «this tab called you and you have not looked». That is about the person, and
 * the process cannot know it — it goes on working the moment the prompt is answered, while the
 * tab that rang is still unread.
 *
 * Then the CLI's own state. It is the process's answer to «what am I doing», and it is immune by
 * construction to the two ways output lies: an agent that thinks without printing looks idle, and
 * an agent drawing a spinner looks busy for as long as it draws. `shell` counts as running — the
 * CLI runs a command of its own and its own session list counts `busy` and `shell` alike as
 * working. `waiting` counts as waiting: the CLI sets it when it is blocked on a person (a
 * permission prompt, a dialog, a sandbox request), and it stays set for as long as the prompt is
 * up, which is exactly the stretch `attention` cannot cover — that is cleared the moment the
 * person looks at the tab.
 *
 * And only then output. It is what a shell tab has and all it has, and it is the answer for a
 * claude tab that no state file names — which is an ordinary case, so the fallback is the whole
 * of the behaviour this project had before the file was read at all.
 */
export function terminalStatus(input: StatusInput): TerminalStatus {
  if (input.dead) return 'dead'
  if (!input.awake) return 'asleep'
  if (input.attention) return 'waiting'
  switch (input.activity) {
    case 'busy':
    case 'shell':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'idle':
      return 'idle'
  }
  return input.busy ? 'running' : 'idle'
}

/**
 * The statuses a list of tabs is summarised in, most urgent first. `dead` is not among them: it is
 * the terminal area's own bookkeeping and no tab list carries it, so a summary counts a tab that
 * has no process the same way whether it went to sleep or its process exited.
 */
export const PULSE_ORDER = ['waiting', 'running', 'idle', 'asleep'] as const
export type PulseStatus = (typeof PULSE_ORDER)[number]

/**
 * How each status is spoken and painted. One table, so amber means the same thing in the sidebar
 * and in the tab strip: someone who has learnt the session pulse does not have to learn it twice.
 * The wording is the pulse's own — a project tab summarises the very same tabs.
 */
export const PULSE_LOOK = {
  waiting: { cls: 'calling', key: 'sessions.pulse.calling' },
  running: { cls: 'working', key: 'sessions.pulse.working' },
  idle: { cls: 'idle', key: 'sessions.pulse.idle' },
  asleep: { cls: 'asleep', key: 'sessions.pulse.asleep' },
} as const satisfies Record<PulseStatus, { cls: string; key: PluralKey }>

/** one segment of a summary: a status and how many tabs are in it */
export interface PulsePart {
  status: PulseStatus
  count: number
}

/** what a tab is doing, when it is doing something; both may be present at once */
const ACTIVE = ['waiting', 'running'] as const

/**
 * What a project tab shows: the statuses of every tab under it, combined rather than reduced to a
 * winner — a project with something calling *and* something working shows amber and green together,
 * because those are two different things to go and do.
 *
 * The combination is not the whole tally, though. Idle and asleep are not events; a project with
 * forty idle tabs and one calling has exactly one thing worth a dot, and four dots on every tab of
 * a strip that holds several is a wall, not a signal. So: everything active, in order, and only
 * when nothing at all is active does the resting state get the dot — idle over asleep, because a
 * live silent process is more than no process. The counts ride along for the tooltip.
 *
 * An empty list gives an empty summary; the caller decides what "nothing in here" looks like.
 */
export function projectPulse(statuses: readonly TerminalStatus[]): PulsePart[] {
  const tally: Record<PulseStatus, number> = { waiting: 0, running: 0, idle: 0, asleep: 0 }
  for (const status of statuses) tally[status === 'dead' ? 'asleep' : status]++

  const active = ACTIVE.filter((status) => tally[status] > 0).map((status) => ({ status, count: tally[status] }))
  if (active.length) return active

  const resting: PulseStatus | null = tally.idle > 0 ? 'idle' : tally.asleep > 0 ? 'asleep' : null
  return resting ? [{ status: resting, count: tally[resting] }] : []
}
