import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentActivity, AgentRun, Session, Settings, TerminalStatus, TerminalTab } from '../../../shared/types'
import TerminalPane from './TerminalPane'
import SleepScreen from './SleepScreen'
import FileEditor from './FileEditor'
import DiffView from './DiffView'
import MergeTab from './MergeTab'
import type { TKey } from '../i18n'
import { useT } from '../i18n'
import { commandFor, findAgent } from '../lib/agents'
import { dragHandlers, middleClickClose } from '../lib/dnd'
import { terminalStatus } from '../lib/status'
import { formatTime } from '../lib/util'
import InlineRename from '../ui/InlineRename'
import { Menu, MenuItem, MenuSep } from '../ui/Menu'
import { useMenu } from '../ui/useMenu'
import { activateOnKey, useRovingFocus } from '../ui/rows'
import { useHookPaths } from '../state/appStateContext'
import ContextMenu from './ContextMenu'

interface Props {
  session: Session
  settings: Settings
  /** terminals with a live pty; everything else is asleep and starts on click */
  awake: Set<string>
  /** terminals that rang the bell and have not been looked at since */
  attention: Set<string>
  /** ids with output in the last few seconds */
  busyIds: Set<string>
  /** what each claude tab's own CLI says it is doing, for the tabs anything answers for */
  agentActivity: Map<string, AgentActivity>
  /** tabs whose CLI reports nothing: they will never ring, and the strip has to say so */
  silent: Set<string>
  /** the last screen of a tab, kept while it sleeps; see lib/snapshots */
  snapshots: Map<string, string>
  /** a pane hands over its screen as it goes away — asleep, closed or left behind on a switch */
  onSnapshot: (terminalId: string, text: string) => void
  /** put a tab to sleep by hand; main kills the process and answers with the same `slept` event */
  onSleepTerminal: (terminalId: string) => void
  /**
   * Wake a tab. May report back when the launched flag has been resolved: restart waits for
   * that promise before mounting the new pane, so the fresh-vs-resume arguments are correct.
   */
  onWake: (terminalId: string) => void | Promise<void>
  onBell: (terminalId: string) => void
  onActivity: (terminalId: string) => void
  onSeen: (terminalId: string) => void
  onSelectTerminal: (id: string) => void
  onAddTerminal: (agentId: string | null) => void
  onCloseTerminal: (id: string) => void
  /** tab name given by a person: the agent no longer overwrites it */
  onRenameTerminal: (id: string, title: string) => void
  onReorderTerminals: (from: number, to: number) => void
  onTerminalTitle: (terminalId: string, title: string) => void
  onTerminalCommand: (terminalId: string, command: string) => void
  onRestoreRun: (run: AgentRun) => void
  /** which agent a single click on «+» creates */
  defaultAgentId: string | null
  onDefaultAgent: (agentId: string | null) => void
  /** file tabs: context for the editor and for handing a file reference to the agent */
  onSendToAgent: (text: string) => void
  /** a file path clicked in a terminal's output; `line` is the `:42` the output named */
  onOpenPath: (path: string, line?: number) => void
  onError: (msg: string) => void
  /** remember whether this tab should resume its conversation or start a new one */
  onLaunchedChange: (terminalId: string, launched: boolean) => void
}

/** what the dot on a tab means, as a key: the wording lives in the terminal area */
const STATUS_HINT = {
  running: 'terminal.status.running',
  waiting: 'terminal.status.waiting',
  idle: 'terminal.status.idle',
  asleep: 'terminal.status.asleep',
  dead: 'terminal.status.dead',
} as const satisfies Record<TerminalStatus, TKey>

/** the diff tab: its content is fetched from the tab's spec and refreshed on demand */
function DiffTab({ spec, onClose }: { spec: NonNullable<TerminalTab['diff']>; onClose: () => void }): JSX.Element {
  const [text, setText] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      // a hidden tab shows nothing — do not run git for it
      if (document.hidden) return
      void window.api.git
        .fileDiff(spec.cwd, spec.path, spec.mode, spec.baseRef, spec.untracked)
        .then((d) => !cancelled && setText(d))
    }
    load()
    const t = window.setInterval(load, 5000)
    const onVisible = (): void => {
      if (!document.hidden) load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [spec.cwd, spec.path, spec.mode, spec.baseRef, spec.untracked])

  return (
    <DiffView
      file={{
        path: spec.path,
        // left out entirely rather than set to undefined: only a rename has an old path
        ...(spec.oldPath === undefined ? {} : { oldPath: spec.oldPath }),
        status: spec.status,
        staged: false,
        untracked: spec.untracked,
      }}
      diff={text}
      cwd={spec.cwd}
      oldRef={spec.mode === 'base' && spec.baseRef ? spec.baseRef : 'HEAD'}
      onClose={onClose}
    />
  )
}

export default function TerminalArea({
  session,
  settings,
  awake,
  attention,
  busyIds,
  agentActivity,
  silent,
  snapshots,
  onSnapshot,
  onSleepTerminal,
  onWake,
  onBell,
  onActivity,
  onSeen,
  onSelectTerminal,
  onAddTerminal,
  onCloseTerminal,
  onRenameTerminal,
  onReorderTerminals,
  onTerminalTitle,
  onTerminalCommand,
  onRestoreRun,
  defaultAgentId,
  onDefaultAgent,
  onSendToAgent,
  onOpenPath,
  onError,
  onLaunchedChange,
}: Props): JSX.Element {
  const t = useT()
  /** a spawn argument, not a setting: it goes on the command line of every claude tab */
  const hookPaths = useHookPaths()
  const [nonces, setNonces] = useState<Record<string, number>>({})
  const [dead, setDead] = useState<Record<string, boolean>>({})
  /**
   * How many times each tab has been asked to clear its scrollback. Not a nonce in the sense the
   * map above is: bumping this one must **not** rebuild the pane — a rebuilt pane re-attaches and
   * main paints its buffer back, which is the opposite of what was asked for.
   */
  const [clearSeqs, setClearSeqs] = useState<Record<string, number>>({})
  /** the tab's process is restarting: the old pane is gone, the new one waits for `launched` */
  const [restarting, setRestarting] = useState<Set<string>>(new Set())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; tab: TerminalTab } | null>(null)
  /** id of the tab being renamed; the draft itself lives inside the field */
  const [renaming, setRenaming] = useState<{ id: string; initial: string } | null>(null)
  const historyMenu = useMenu(historyOpen, () => setHistoryOpen(false))
  const addMenu = useMenu(addOpen, () => setAddOpen(false))
  // bound once: reading a member off a handle that carries refs counts as touching a ref
  // during render, whether or not `.current` is what is being read
  const { rootRef: addRootRef, triggerProps: addTrigger } = addMenu
  const { rootRef: historyRootRef, triggerProps: historyTrigger } = historyMenu
  const tabsRef = useRef<HTMLDivElement>(null)
  const onTabKeys = useRovingFocus(tabsRef, '.term-tab', 'horizontal')

  const activeId = session.activeTerminalId ?? session.terminals[0]?.id ?? null

  // A closed tab needs no bookkeeping; without this it piles up for the lifetime of the window.
  // Done while rendering rather than in an effect: these four maps are read further down this
  // very render, so pruning them afterwards paints one frame in which a reused id still carries
  // the dead tab's nonce — and a nonce is what decides whether a pane is torn down and rebuilt.
  const [prunedFor, setPrunedFor] = useState(session.terminals)
  if (prunedFor !== session.terminals) {
    const alive = new Set(session.terminals.map((t) => t.id))
    const prune = <T,>(prev: Record<string, T>): Record<string, T> => {
      const stale = Object.keys(prev).filter((id) => !alive.has(id))
      if (!stale.length) return prev
      const next = { ...prev }
      for (const id of stale) delete next[id]
      return next
    }
    setPrunedFor(session.terminals)
    setNonces(prune)
    setDead(prune)
    setClearSeqs(prune)
    setRestarting((prev) => {
      const next = new Set([...prev].filter((id) => alive.has(id)))
      return next.size === prev.size ? prev : next
    })
  }

  /**
   * Restarting a tab's process.
   *
   * The order matters: the new pane works out its arguments (`--session-id` versus `--resume`)
   * from `launched`, which onWake settles asynchronously by looking in the agent's store. So
   * the old pane comes down first, then onWake is awaited, and only then does the new one go
   * up under a new nonce.
   */
  const restart = async (id: string): Promise<void> => {
    setRestarting((prev) => new Set(prev).add(id))
    try {
      await window.api.pty.kill(id)
      await onWake(id)
    } finally {
      setDead((d) => ({ ...d, [id]: false }))
      setNonces((n) => ({ ...n, [id]: (n[id] ?? 0) + 1 }))
      setRestarting((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  /**
   * Wipe a tab's history — both copies of it, or it comes back.
   *
   * The renderer's xterm instance is reached through the counter the pane watches; main's replay
   * buffer through the channel. Neither alone is enough: clearing only the pane leaves main to
   * paint everything back on the next attach, and clearing only main leaves the screen as it was.
   * Order does not matter — the two are cleared independently and nothing is read back.
   *
   * Nothing is done about the frozen screen a sleeping tab shows: this is offered for awake tabs
   * only, and an awake tab has no snapshot — waking drops it, and the pane captures a fresh one
   * on its way out. There is no third copy to reach.
   */
  const clearScrollback = (id: string): void => {
    void window.api.pty.clearScrollback(id)
    setClearSeqs((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
  }

  // «Shell» is the name of the thing that runs, not a word: it stays as it is in every locale
  const tabTitle = (tab: TerminalTab): string => tab.title || (tab.kind === 'agent' ? t('terminal.tab.agent') : 'Shell')

  // a file tab has no process and so no state of its own; everything else is decided in one
  // place, shared with the session pulse — see `lib/status`
  const statusOf = (tab: TerminalTab): TerminalStatus =>
    tab.kind === 'editor' || tab.kind === 'diff' || tab.kind === 'merge'
      ? 'idle'
      : terminalStatus({
          dead: dead[tab.id],
          awake: awake.has(tab.id),
          attention: attention.has(tab.id),
          activity: agentActivity.get(tab.id),
          busy: busyIds.has(tab.id),
        })

  /** the hint the status dot carries, already worded */
  const statusHint = (tab: TerminalTab): string => t(STATUS_HINT[statusOf(tab)])

  /**
   * Which tabs can be sent to sleep by hand: the ones that have a process and are still running
   * it. An editor, a diff and a merge tab have nothing to stop, and a tab that is already asleep
   * has nothing left to stop either.
   */
  const canSleep = (tab: TerminalTab): boolean => (tab.kind === 'agent' || tab.kind === 'shell') && awake.has(tab.id)

  /**
   * Which tabs can have their history dropped. The same test as `canSleep`, for a different
   * reason, which is why it is written out separately rather than shared: clearing needs a live
   * xterm instance to reach, and only a tab with a mounted pane has one. A tab whose process has
   * exited still does — it keeps its pane and main keeps the tail of its output — so it is
   * offered there too.
   *
   * A sleeping tab is left out rather than shown a disabled item: there is nothing to clear on
   * either side. Main killed the process and dropped the buffer with it, and there is no pane.
   * What such a tab shows is the frozen screen from `lib/snapshots`, and waking it drops that —
   * so the way to clear a sleeping tab is to wake it, which is one click it is going to need
   * anyway before the history means anything.
   */
  const canClear = (tab: TerminalTab): boolean => (tab.kind === 'agent' || tab.kind === 'shell') && awake.has(tab.id)

  // the run list was rebuilt on every keystroke in the terminal — sort only when it changes
  const runs = useMemo(() => [...(session.runs ?? [])].sort((a, b) => b.startedAt - a.startedAt), [session.runs])
  const activeKind = session.terminals.find((t) => t.id === activeId)?.kind
  const activeIsProcess = activeKind === 'agent' || activeKind === 'shell'
  const enabledAgents = settings.agents.filter((a) => a.enabled)
  const defaultAgent = defaultAgentId ? (enabledAgents.find((a) => a.id === defaultAgentId) ?? null) : null

  return (
    <section className="terminal-area">
      <div className="term-tabs">
        {/* only the tab strip scrolls: overflow on the wrapper would clip the popup menus */}
        <div className="term-tabs-scroll" role="tablist" aria-label={t('terminal.tabs.aria')} onKeyDown={onTabKeys}>
          {session.terminals.map((tab, i) => {
            const agent = findAgent(settings, tab.agentId)
            const asleep = !awake.has(tab.id)
            const select = (): void => {
              onSelectTerminal(tab.id)
              onSeen(tab.id)
              if (asleep && tab.kind === 'agent') onWake(tab.id)
            }
            const hint = statusHint(tab)
            return (
              <div
                key={tab.id}
                className={'term-tab ' + statusOf(tab) + (tab.id === activeId ? ' active' : '')}
                role="tab"
                aria-selected={tab.id === activeId}
                aria-label={t('terminal.tab.aria', { title: tabTitle(tab), status: hint })}
                onClick={select}
                onKeyDown={activateOnKey(select)}
                title={
                  agent
                    ? t('terminal.tab.hintAgent', { status: hint, command: agent.command })
                    : t('terminal.tab.hint', { status: hint })
                }
                style={agent ? { borderLeftColor: agent.color } : undefined}
                {...dragHandlers('term', i, onReorderTerminals)}
                {...middleClickClose(() => onCloseTerminal(tab.id))}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenuAt({ x: e.clientX, y: e.clientY, tab })
                }}
              >
                <span
                  className={
                    'kind' + (tab.kind === 'editor' || tab.kind === 'diff' || tab.kind === 'merge' ? ' file' : '')
                  }
                  title={hint}
                />
                {renaming?.id === tab.id ? (
                  <InlineRename
                    className="tab-rename"
                    label={t('terminal.tab.name.aria')}
                    value={renaming.initial}
                    onCommit={(title) => {
                      if (title !== tab.title) onRenameTerminal(tab.id, title)
                      setRenaming(null)
                    }}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span
                    className="tab-title"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setRenaming({ id: tab.id, initial: tabTitle(tab) })
                    }}
                  >
                    {tab.kind === 'diff' ? 'Δ ' : tab.kind === 'merge' ? '⚠ ' : ''}
                    {tabTitle(tab)}
                  </span>
                )}
                {asleep && (tab.kind === 'agent' || tab.kind === 'shell') && <span className="zzz">z</span>}
                {/* the tab is running but its CLI reports nothing back: it will never call */}
                {!asleep && silent.has(tab.id) && (
                  <span className="mute" role="img" title={t('terminal.silent')} aria-label={t('terminal.silent')}>
                    ⊘
                  </span>
                )}
                <button
                  className="close"
                  title={t('terminal.tab.close')}
                  aria-label={t('terminal.tab.close.aria', { title: tabTitle(tab) })}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTerminal(tab.id)
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>

        <div className="add-split" ref={addRootRef}>
          <button
            className="add-main"
            title={t('terminal.add.title', { what: defaultAgent ? defaultAgent.name : 'Shell' })}
            onClick={() => {
              onAddTerminal(defaultAgentId)
              setAddOpen(false)
            }}
          >
            <span className="plus">+</span>
            <span className="dot" style={defaultAgent ? { background: defaultAgent.color } : undefined} />
            <span className="what">{defaultAgent ? defaultAgent.name : 'Shell'}</span>
          </button>
          <button
            className="add-more"
            title={t('terminal.add.other')}
            aria-label={t('terminal.add.other.aria')}
            {...addTrigger}
            onClick={() => setAddOpen((v) => !v)}
          >
            ▾
          </button>

          {menuAt && (
            <ContextMenu
              x={menuAt.x}
              y={menuAt.y}
              onClose={() => setMenuAt(null)}
              items={[
                {
                  label: t('terminal.menu.rename'),
                  hint: t('terminal.menu.rename.hint'),
                  onPick: () => setRenaming({ id: menuAt.tab.id, initial: tabTitle(menuAt.tab) }),
                },
                // the tab's own view, not its process: it sits above the two items that stop one
                ...(canClear(menuAt.tab)
                  ? [
                      {
                        label: t('terminal.menu.clear'),
                        hint: t('terminal.menu.clear.hint'),
                        onPick: () => clearScrollback(menuAt.tab.id),
                      },
                    ]
                  : []),
                // the same door the idle sweep goes through, so a tab slept by hand and one slept
                // by the timer are the same thing afterwards
                ...(canSleep(menuAt.tab)
                  ? [
                      {
                        label: t('terminal.menu.sleep'),
                        hint: t('terminal.menu.sleep.hint'),
                        onPick: () => onSleepTerminal(menuAt.tab.id),
                      },
                    ]
                  : []),
                {
                  label: t('terminal.menu.close'),
                  hint: t('terminal.menu.close.hint'),
                  danger: true,
                  onPick: () => onCloseTerminal(menuAt.tab.id),
                },
              ]}
            />
          )}

          {addOpen && (
            <Menu menu={addMenu} className="add-menu" label={t('terminal.add.menu.aria')}>
              {enabledAgents.map((a) => (
                <MenuItem
                  key={a.id}
                  onClick={() => {
                    onAddTerminal(a.id)
                    onDefaultAgent(a.id)
                    setAddOpen(false)
                  }}
                >
                  <span className="dot" style={{ background: a.color }} />
                  <span className="name">{a.name}</span>
                  <span className="muted small">{a.command}</span>
                </MenuItem>
              ))}
              <MenuSep />
              <MenuItem
                onClick={() => {
                  onAddTerminal(null)
                  onDefaultAgent(null)
                  setAddOpen(false)
                }}
              >
                <span className="dot" />
                <span className="name">Shell</span>
                <span className="muted small">Ctrl+Shift+T</span>
              </MenuItem>
            </Menu>
          )}
        </div>

        <div className="spacer" />

        <div className="history-wrap" ref={historyRootRef}>
          <button
            className="ghost"
            data-testid="run-history"
            title={t('terminal.history.title')}
            aria-label={t('terminal.history.aria', { count: runs.length })}
            {...historyTrigger}
            onClick={() => setHistoryOpen((v) => !v)}
            disabled={runs.length === 0}
          >
            ⌛ {runs.length || ''}
          </button>
          {historyOpen && (
            <Menu menu={historyMenu} className="history-menu" label={t('terminal.history.caption')}>
              <div className="muted small pad" role="presentation">
                {t('terminal.history.caption')}
              </div>
              {runs.map((r) => {
                const agent = findAgent(settings, r.agentId)
                return (
                  <MenuItem
                    key={r.id}
                    onClick={() => {
                      setHistoryOpen(false)
                      onRestoreRun(r)
                    }}
                    title={
                      r.agentSessionId
                        ? t('terminal.history.runId', { id: r.agentSessionId })
                        : t('terminal.history.noId')
                    }
                  >
                    <span className="dot" style={{ background: agent?.color ?? 'var(--fg-dim)' }} />
                    <span className="run-title">{r.title}</span>
                    <span className="muted small">{formatTime(r.startedAt)}</span>
                  </MenuItem>
                )
              })}
            </Menu>
          )}
        </div>

        {activeId && activeIsProcess && (
          <button
            className="ghost"
            title={t('terminal.restart')}
            aria-label={t('terminal.restart.aria')}
            onClick={() => void restart(activeId)}
          >
            ↻
          </button>
        )}
      </div>

      <div className="term-body">
        {session.terminals.map((tab) => {
          if (tab.kind === 'editor') {
            // the editor stays mounted and merely hides: unmounting it would throw away the
            // unsaved buffer, and CodeMirror with it
            return tab.filePath ? (
              <FileEditor
                key={tab.id}
                path={tab.filePath}
                line={tab.fileLine}
                cwd={session.cwd}
                editor={settings.editor}
                active={tab.id === activeId}
                onSend={onSendToAgent}
                onClose={() => onCloseTerminal(tab.id)}
                onError={onError}
              />
            ) : null
          }
          if (tab.kind === 'merge') {
            return tab.id === activeId && tab.filePath ? (
              <MergeTab
                key={tab.id}
                cwd={tab.mergeCwd ?? session.cwd}
                path={tab.filePath}
                onClose={() => onCloseTerminal(tab.id)}
                onError={onError}
                onResolved={() => undefined}
              />
            ) : null
          }
          if (tab.kind === 'diff') {
            return tab.id === activeId && tab.diff ? (
              <DiffTab key={tab.id} spec={tab.diff} onClose={() => onCloseTerminal(tab.id)} />
            ) : null
          }

          const agent = findAgent(settings, tab.agentId)
          const asleep = !awake.has(tab.id)
          if (asleep) {
            if (tab.id !== activeId) return null
            // What the tab had on screen when its process was killed. Only the visible sleeping
            // tab is rendered, so there is at most one of these terminals in the window at a
            // time. The card is what is left when there is no screen to show — a tab that never
            // ran anything, or a capture that came to nothing.
            const snapshot = snapshots.get(tab.id)
            return snapshot ? (
              <SleepScreen
                key={tab.id}
                snapshot={snapshot}
                title={tabTitle(tab)}
                isAgent={tab.kind === 'agent'}
                onWake={() => onWake(tab.id)}
              />
            ) : (
              <div key={tab.id} className="sleep-card">
                <div className="zzz-big">z</div>
                <p>
                  {tab.kind === 'agent'
                    ? t('terminal.sleep.cardAgent', { title: tabTitle(tab) })
                    : t('terminal.sleep.card', { title: tabTitle(tab) })}
                </p>
                <button className="primary" onClick={() => onWake(tab.id)}>
                  {t('terminal.sleep.wake')}
                </button>
              </div>
            )
          }
          if (restarting.has(tab.id)) {
            return tab.id === activeId ? (
              <div key={tab.id} className="muted pad">
                {t('terminal.restarting')}
              </div>
            ) : null
          }
          return (
            <TerminalPane
              key={`${tab.id}:${nonces[tab.id] ?? 0}`}
              id={tab.id}
              cwd={session.cwd}
              kind={tab.kind}
              command={commandFor(agent, tab, hookPaths ?? undefined)}
              env={tab.configDir ? { ...(agent?.env ?? {}), CLAUDE_CONFIG_DIR: tab.configDir } : agent?.env}
              sleepable={tab.kind === 'agent'}
              scrollbackLines={settings.terminal.scrollbackLines}
              active={tab.id === activeId}
              clearSeq={clearSeqs[tab.id] ?? 0}
              onExit={() => setDead((d) => ({ ...d, [tab.id]: true }))}
              onTitle={(title) => onTerminalTitle(tab.id, title)}
              onSessionError={(kind) => {
                onLaunchedChange(tab.id, kind === 'in-use')
                // nothing to await: restart will not raise the pane until onWake settles launched
                void restart(tab.id)
              }}
              onBell={() => onBell(tab.id)}
              onActivity={() => onActivity(tab.id)}
              onInput={() => onSeen(tab.id)}
              onSeen={() => onSeen(tab.id)}
              onCommand={(cmd) => onTerminalCommand(tab.id, cmd)}
              onOpenPath={onOpenPath}
              onSnapshot={(text) => onSnapshot(tab.id, text)}
            />
          )
        })}
        {session.terminals.length === 0 && <div className="muted pad">{t('terminal.empty')}</div>}
      </div>
    </section>
  )
}
