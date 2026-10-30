import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import type {
  AgentActivity,
  ArchivedSession,
  BranchPrs,
  PermissionAnswer,
  PermissionAsk,
  Project,
  ProjectWorktrees,
  Session,
} from '../../../shared/types'
import type { T } from '../i18n'
import { useT } from '../i18n'
import { shownPermission, terminalStatus } from '../lib/status'
import { mainFolder, sessionWorktrees } from '../lib/worktrees'
import { treeRows } from '../lib/sessionTree'
import { formatTime } from '../lib/util'
import { dragHandlers, middleClickClose } from '../lib/dnd'
import InlineRename from '../ui/InlineRename'
import { activateOnKey, useRovingFocus } from '../ui/rows'
import ContextMenu from './ContextMenu'
import PrBadge from './PrBadge'

interface Props {
  project: Project
  /** tabs with a live process */
  awake: Set<string>
  /** tabs that rang and have not been looked at since */
  attention: Set<string>
  /** tabs that printed something in the last few seconds */
  busyIds: Set<string>
  /** what each claude tab's own CLI says it is doing, for the tabs anything answers for */
  agentActivity: Map<string, AgentActivity>
  /** the permission prompt each claude tab offered the window — see `lib/status.shownPermission` */
  permissions: Map<string, PermissionAsk>
  /** a click on a permission card: the only way an answer is ever given from here */
  onAnswerPermission: (terminalId: string, askId: string, answer: PermissionAnswer) => void
  /** the PR of each session's branch, by directory; a session absent from it shows no badge */
  prs: BranchPrs
  /** the project's worktrees and which each session worked in; null until the first read */
  worktrees: ProjectWorktrees | null
  /** the project's worktrees view */
  onWorktrees: () => void
  /** session directories that are not on disk */
  missing: ReadonlySet<string>
  /** put a deleted worktree back at its path, on its branch */
  onRecreate: (session: Session) => void
  onSelect: (id: string) => void
  onNew: () => void
  onClose: (session: Session) => void
  onRename: (session: Session, name: string) => void
  onReorder: (from: number, to: number) => void
  onRestore: (archived: ArchivedSession) => void
  onForget: (archivedId: string) => void
  onAgentHistory: () => void
  filesOpen: boolean
  onToggleFiles: () => void
}

/**
 * A session's activity at a glance: what its tabs add up to — and, for a folded parent, its
 * descendants' tabs too, so a child calling for the person is not hidden by the fold. Each tab is classified exactly as
 * the tab strip classifies it — one shared function (`lib/status`), because two hand-written
 * chains of `if`s over the same four inputs is two chances to disagree, and the pulse and the
 * strip are looking at the same tabs.
 */
function SessionPulse({
  sessions,
  awake,
  attention,
  busyIds,
  agentActivity,
  t,
}: {
  sessions: Session[]
  awake: Set<string>
  attention: Set<string>
  busyIds: Set<string>
  agentActivity: Map<string, AgentActivity>
  t: T
}): JSX.Element | null {
  const live = sessions.flatMap((s) => s.terminals).filter((t) => t.kind === 'agent' || t.kind === 'shell')
  if (!live.length) return null
  // `dead` is not passed: it is the terminal area's own bookkeeping and no tab list has it
  const statuses = live.map((tab) =>
    terminalStatus({
      awake: awake.has(tab.id),
      attention: attention.has(tab.id),
      activity: agentActivity.get(tab.id),
      busy: busyIds.has(tab.id),
    }),
  )
  const count = (status: string): number => statuses.filter((s) => s === status).length
  const calling = count('waiting')
  const working = count('running')
  const idle = count('idle')
  const asleep = count('asleep')

  const parts: { cls: string; n: number; hint: string }[] = [
    { cls: 'calling', n: calling, hint: t.plural('sessions.pulse.calling', calling) },
    { cls: 'working', n: working, hint: t.plural('sessions.pulse.working', working) },
    { cls: 'idle', n: idle, hint: t.plural('sessions.pulse.idle', idle) },
    { cls: 'asleep', n: asleep, hint: t.plural('sessions.pulse.asleep', asleep) },
  ].filter((p) => p.n > 0)

  return (
    <span className="pulse" title={parts.map((p) => p.hint).join(' · ')}>
      {parts.map((p) => (
        <span key={p.cls} className={'pulse-part ' + p.cls}>
          <span className="dot" />
          {p.n}
        </span>
      ))}
    </span>
  )
}

/**
 * The permission prompts a session's tabs are blocked on, each with Allow and Deny — so a tab in
 * the background can be answered without switching to it. The tab on screen gets no card: its
 * prompt is right there in the terminal.
 *
 * A card is the same prompt the terminal shows, and the CLI takes whichever answer arrives first;
 * the other is dropped, so nothing runs twice. Nothing is ever answered without a click, and there
 * is no «always allow» here: a rule that outlives the prompt is a decision for the terminal, where
 * the CLI shows exactly what it would add.
 */
function PermissionCards({
  sessions,
  onScreen,
  permissions,
  agentActivity,
  onAnswer,
  t,
}: {
  /** the row's session and, when it is folded, the descendants it hides — as the pulse counts them */
  sessions: Session[]
  /** the tab on screen in this project, which needs no card */
  onScreen: string | null
  permissions: Map<string, PermissionAsk>
  agentActivity: Map<string, AgentActivity>
  onAnswer: (terminalId: string, askId: string, answer: PermissionAnswer) => void
  t: T
}): JSX.Element | null {
  const cards = sessions.flatMap((session) =>
    session.terminals.flatMap((tab) => {
      if (tab.id === onScreen) return []
      const ask = shownPermission(permissions.get(tab.id), agentActivity.get(tab.id))
      return ask ? [{ session, tab, ask }] : []
    }),
  )
  if (!cards.length) return null
  return (
    <>
      {cards.map(({ session, tab, ask }) => {
        const name = tab.title || session.name
        // the buttons only: a click elsewhere on the card selects the session, as on the rest of the row
        const answer =
          (choice: PermissionAnswer) =>
          (e: { stopPropagation: () => void }): void => {
            e.stopPropagation()
            onAnswer(tab.id, ask.id, choice)
          }
        return (
          <div
            key={tab.id}
            className="permission-card"
            data-testid="permission-card"
            role="group"
            aria-label={t('sessions.permission.aria', { tab: name })}
            title={t('sessions.permission.title', { tab: name, tool: ask.tool })}
          >
            <div className="permission-what">
              <span className="permission-tool">{ask.tool}</span>
              {ask.detail && <code className="permission-detail">{ask.detail}</code>}
            </div>
            <div className="permission-actions">
              <button className="permission-allow" data-testid="permission-allow" onClick={answer('allow')}>
                {t('sessions.permission.allow')}
              </button>
              <button className="permission-deny" data-testid="permission-deny" onClick={answer('deny')}>
                {t('sessions.permission.deny')}
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}

/**
 * Where a session works: the branch of its primary worktree with that branch's PR, the other
 * worktrees counted — or, with none, the folder it was started in and that folder's branch, with no PR
 * badge: the main folder's branch is whatever was last checked out there, not this session's work.
 */
function SessionWhere({
  session,
  worktrees,
  prs,
  t,
}: {
  session: Session
  worktrees: ProjectWorktrees | null
  prs: BranchPrs
  t: T
}): JSX.Element {
  const [first, ...rest] = sessionWorktrees(session, worktrees)
  if (!first) {
    // before the first read the session's own record is all there is
    if (!worktrees && session.worktree)
      return (
        <div className="session-where">
          <span className="branch">⎇ {session.worktree.branch}</span>
          <PrBadge pr={prs[session.cwd]} compact />
        </div>
      )
    const main = mainFolder(session, worktrees)
    return (
      <div className="session-where">
        <span className="branch main" title={main.path}>
          {main.branch ? t('worktrees.row.mainFolder', { branch: main.branch }) : t('worktrees.row.mainFolderNoBranch')}
        </span>
      </div>
    )
  }
  // one line: the primary worktree's branch; the rest are counted, listed in the tooltip and
  // reachable through the changes panel switcher
  return (
    <div className="session-where">
      <div className="session-worktree" title={t('worktrees.row.title', { path: first.path })}>
        <span className="branch">⎇ {first.branch ?? t('worktrees.item.detached')}</span>
        <PrBadge pr={prs[first.path]} compact />
        {rest.length > 0 && (
          <span className="muted more" title={rest.map((w) => w.path).join('\n')}>
            {t.plural('worktrees.row.more', rest.length)}
          </span>
        )}
      </div>
    </div>
  )
}

/** file tree: three levels of indentation, no emoji */
function TreeIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2.5 2.5v9.5a1 1 0 0 0 1 1h2" strokeLinecap="round" />
      <path d="M5.5 7.5h3M5.5 3.5h3M5.5 12.5h3" strokeLinecap="round" />
      <rect x="9" y="1.8" width="4.6" height="3.4" rx="0.8" />
      <rect x="9" y="5.8" width="4.6" height="3.4" rx="0.8" />
      <rect x="9" y="10.8" width="4.6" height="3.4" rx="0.8" />
    </svg>
  )
}

/** nothing of the session runs: opening it wakes its agent, so its row is drawn faded */
function isAsleep(session: Session, awake: ReadonlySet<string>): boolean {
  const live = session.terminals.filter((tab) => tab.kind === 'agent' || tab.kind === 'shell')
  return live.length > 0 && !live.some((tab) => awake.has(tab.id))
}

export default function SessionList({
  project,
  awake,
  attention,
  busyIds,
  agentActivity,
  permissions,
  onAnswerPermission,
  prs,
  worktrees,
  onWorktrees,
  missing,
  onRecreate,
  onSelect,
  onNew,
  onClose,
  onRename,
  onReorder,
  onRestore,
  onForget,
  onAgentHistory,
  filesOpen,
  onToggleFiles,
}: Props): JSX.Element {
  const t = useT()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; session: Session } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  /** folded parents; a view preference of this window, not saved */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggleFold = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const listRef = useRef<HTMLDivElement>(null)
  const onListKeys = useRovingFocus(listRef, '.session')

  // a new session, or the active one after a restart, may sit below the fold of a long list
  useEffect(() => {
    listRef.current?.querySelector('.session.active')?.scrollIntoView({ block: 'nearest' })
  }, [project.id, project.activeSessionId])

  const history = project.history ?? []
  const parentName = (id: string | undefined): string => project.sessions.find((p) => p.id === id)?.name ?? ''
  const onScreen = project.sessions.find((p) => p.id === project.activeSessionId)?.activeTerminalId ?? null

  return (
    <aside className="sessions">
      {/* the project's name, large on its colour: which project this is, before reading anything */}
      <div className="sessions-head" aria-label={t('sessions.title')}>
        <span className="project-name" title={project.path}>
          {project.name}
        </span>
        <div className="spacer" />
        <button
          className={'icon-btn' + (filesOpen ? ' on' : '')}
          onClick={onToggleFiles}
          title={t('sessions.files.toggle')}
          aria-label={t('sessions.files.toggle')}
          aria-pressed={filesOpen}
        >
          <TreeIcon />
        </button>
        <button
          className="icon-btn"
          data-testid="worktrees-open"
          onClick={onWorktrees}
          title={t('worktrees.open')}
          aria-label={t('worktrees.open')}
        >
          ⎇
        </button>
        <button className="add" onClick={onNew} title={t('sessions.empty.new')} aria-label={t('sessions.empty.new')}>
          +
        </button>
      </div>

      <div
        className="sessions-list"
        ref={listRef}
        onKeyDown={onListKeys}
        role="group"
        aria-label={t('sessions.list.aria')}
      >
        {project.sessions.length === 0 && <div className="muted pad">{t('sessions.list.empty')}</div>}
        {treeRows(project.sessions, collapsed).map(({ session: s, index, depth, childCount, hidden }) => (
          <div
            key={s.id}
            className={
              'session' +
              (s.id === project.activeSessionId ? ' active' : '') +
              (depth ? ' child' : '') +
              (missing.has(s.cwd) ? ' missing' : '') +
              (isAsleep(s, awake) ? ' asleep' : '')
            }
            style={{ '--depth': depth }}
            data-testid={depth ? 'session-child' : 'session'}
            role="button"
            aria-current={s.id === project.activeSessionId}
            aria-label={t('sessions.item.aria', { name: s.name })}
            onClick={() => onSelect(s.id)}
            onKeyDown={activateOnKey(() => onSelect(s.id))}
            title={
              t('sessions.item.title', { path: s.cwd }) +
              (depth ? '\n' + t('sessions.child.of', { name: parentName(s.parentId) }) : '')
            }
            {...dragHandlers('session', index, onReorder)}
            {...middleClickClose(() => onClose(s))}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenuAt({ x: e.clientX, y: e.clientY, session: s })
            }}
          >
            <div className="session-row">
              {childCount > 0 && (
                <button
                  className="fold"
                  aria-expanded={!collapsed.has(s.id)}
                  aria-label={t(collapsed.has(s.id) ? 'sessions.children.expand' : 'sessions.children.collapse')}
                  title={t(collapsed.has(s.id) ? 'sessions.children.expand' : 'sessions.children.collapse')}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFold(s.id)
                  }}
                >
                  {collapsed.has(s.id) ? '▸' : '▾'}
                </button>
              )}
              {editingId === s.id ? (
                <InlineRename
                  label={t('sessions.rename.label')}
                  value={s.name}
                  onCommit={(name) => {
                    onRename(s, name)
                    setEditingId(null)
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <span
                  className="name"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setEditingId(s.id)
                  }}
                  title={s.nameAuto === false ? s.name : t('sessions.name.auto', { name: s.name })}
                >
                  {s.name}
                </span>
              )}
              <button
                className="close"
                title={t('sessions.close.title')}
                aria-label={t('sessions.close.aria', { name: s.name })}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(s)
                }}
              >
                ×
              </button>
            </div>
            <div className="session-meta">
              <SessionPulse
                sessions={[s, ...hidden]}
                awake={awake}
                attention={attention}
                busyIds={busyIds}
                agentActivity={agentActivity}
                t={t}
              />
              {childCount > 0 && (
                <span className="children-count">{t.plural('sessions.children.count', childCount)}</span>
              )}
              <span className="tabs-count">{t.plural('sessions.tabCount', s.terminals.length)}</span>
              <span className="time">{formatTime(s.createdAt)}</span>
            </div>
            <SessionWhere session={s} worktrees={worktrees} prs={prs} t={t} />
            <PermissionCards
              sessions={[s, ...hidden]}
              onScreen={onScreen}
              permissions={permissions}
              agentActivity={agentActivity}
              onAnswer={onAnswerPermission}
              t={t}
            />
            {missing.has(s.cwd) && (
              <div className="session-missing" title={t('sessions.missing.title', { path: s.cwd })}>
                <span className="missing-badge">{t('sessions.missing')}</span>
                {s.worktree && (
                  <button
                    className="link"
                    data-testid="session-recreate"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRecreate(s)
                    }}
                  >
                    {t('sessions.recreateWorktree')}
                  </button>
                )}
                <button
                  className="link"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(s)
                  }}
                >
                  {t('sessions.close')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {menuAt && (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          onClose={() => setMenuAt(null)}
          items={[
            {
              label: t('sessions.menu.rename'),
              hint: t('sessions.menu.rename.hint'),
              onPick: () => setEditingId(menuAt.session.id),
            },
            ...(menuAt.session.worktree && missing.has(menuAt.session.cwd)
              ? [{ label: t('sessions.recreateWorktree'), onPick: () => onRecreate(menuAt.session) }]
              : []),
            {
              label: t('sessions.close'),
              hint: t('sessions.menu.close.hint'),
              danger: true,
              onPick: () => onClose(menuAt.session),
            },
          ]}
        />
      )}

      <div className="history-section">
        <div className="history-head">
          <button
            className="history-toggle"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((v) => !v)}
            disabled={history.length === 0}
          >
            {historyOpen ? '▾' : '▸'} {t('sessions.history.title')} {history.length ? `(${history.length})` : ''}
          </button>
          <button
            className="ghost"
            data-testid="agent-history-open"
            title={t('sessions.history.agents.title')}
            onClick={onAgentHistory}
          >
            ⌕ {t('sessions.history.agents')}
          </button>
        </div>
        {historyOpen && (
          <div className="history-list">
            {history.map((h) => (
              <div
                key={h.id}
                className="archived"
                title={t('sessions.history.item.title', { path: h.cwd, time: formatTime(h.closedAt) })}
              >
                <div className="archived-row">
                  <span className="name">{h.name}</span>
                  <button
                    className="ghost"
                    title={t('sessions.history.restore')}
                    aria-label={t('sessions.history.restore.aria', { name: h.name })}
                    onClick={() => onRestore(h)}
                  >
                    ↩
                  </button>
                  <button
                    className="ghost"
                    title={t('sessions.history.forget')}
                    aria-label={t('sessions.history.forget.aria', { name: h.name })}
                    onClick={() => onForget(h.id)}
                  >
                    ×
                  </button>
                </div>
                <div className="session-meta">
                  {h.worktree && <span className="branch">⎇ {h.worktree.branch}</span>}
                  {h.worktreeRemoved && <span className="muted">{t('sessions.history.worktreeRemoved')}</span>}
                  <span className="time">{formatTime(h.closedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sessions-foot">
        <div className="muted small" title={project.path}>
          {project.path}
        </div>
      </div>
    </aside>
  )
}
