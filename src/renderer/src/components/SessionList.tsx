import type { JSX } from 'react'
import { useRef, useState } from 'react'
import type { AgentActivity, ArchivedSession, Project, Session } from '../../../shared/types'
import type { T } from '../i18n'
import { useT } from '../i18n'
import { terminalStatus } from '../lib/status'
import { formatTime } from '../lib/util'
import { dragHandlers, middleClickClose } from '../lib/dnd'
import InlineRename from '../ui/InlineRename'
import { activateOnKey, useRovingFocus } from '../ui/rows'
import ContextMenu from './ContextMenu'

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
 * A session's activity at a glance: what its tabs add up to. Each tab is classified exactly as
 * the tab strip classifies it — one shared function (`lib/status`), because two hand-written
 * chains of `if`s over the same four inputs is two chances to disagree, and the pulse and the
 * strip are looking at the same tabs.
 */
function SessionPulse({
  session,
  awake,
  attention,
  busyIds,
  agentActivity,
  t,
}: {
  session: Session
  awake: Set<string>
  attention: Set<string>
  busyIds: Set<string>
  agentActivity: Map<string, AgentActivity>
  t: T
}): JSX.Element | null {
  const live = session.terminals.filter((t) => t.kind === 'agent' || t.kind === 'shell')
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

export default function SessionList({
  project,
  awake,
  attention,
  busyIds,
  agentActivity,
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
  const listRef = useRef<HTMLDivElement>(null)
  const onListKeys = useRovingFocus(listRef, '.session')

  const history = project.history ?? []

  return (
    <aside className="sessions">
      <div className="sessions-head">
        <span>{t('sessions.title')}</span>
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
        {project.sessions.map((s, i) => (
          <div
            key={s.id}
            className={'session' + (s.id === project.activeSessionId ? ' active' : '')}
            role="button"
            aria-current={s.id === project.activeSessionId}
            aria-label={t('sessions.item.aria', { name: s.name })}
            onClick={() => onSelect(s.id)}
            onKeyDown={activateOnKey(() => onSelect(s.id))}
            title={t('sessions.item.title', { path: s.cwd })}
            {...dragHandlers('session', i, onReorder)}
            {...middleClickClose(() => onClose(s))}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenuAt({ x: e.clientX, y: e.clientY, session: s })
            }}
          >
            <div className="session-row">
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
                session={s}
                awake={awake}
                attention={attention}
                busyIds={busyIds}
                agentActivity={agentActivity}
                t={t}
              />
              {s.worktree ? (
                <span className="branch">⎇ {s.worktree.branch}</span>
              ) : (
                <span className="branch main">{t('sessions.mainRepo')}</span>
              )}
              <span className="tabs-count">{t.plural('sessions.tabCount', s.terminals.length)}</span>
              <span className="time">{formatTime(s.createdAt)}</span>
            </div>
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
