import type { JSX } from 'react'
import { useMemo, useRef, useState } from 'react'
import type { AgentActivity, ClosedProject, Project, PullStrategy, TerminalStatus } from '../../../shared/types'
import GitMenu from './GitMenu'
import { useT } from '../i18n'
import { dragHandlers, middleClickClose } from '../lib/dnd'
import type { PulsePart } from '../lib/status'
import { PULSE_LOOK, projectPulse, terminalStatus } from '../lib/status'
import InlineRename from '../ui/InlineRename'
import { Menu, MenuItem, MenuSep } from '../ui/Menu'
import { formatTime } from '../lib/util'
import { useMenu } from '../ui/useMenu'
import { activateOnKey, useRovingFocus } from '../ui/rows'
import ContextMenu from './ContextMenu'

interface Props {
  projects: Project[]
  /** closed projects, newest first: reopening one brings its sessions back */
  closedProjects: ClosedProject[]
  /** tabs with a live process */
  awake: Set<string>
  /** tabs that rang and have not been looked at since */
  attention: Set<string>
  /** tabs that printed something in the last few seconds */
  busyIds: Set<string>
  /** what each claude tab's own CLI says it is doing, for the tabs anything answers for */
  agentActivity: Map<string, AgentActivity>
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onReopen: (id: string) => void
  onForgetClosed: (id: string) => void
  onReorder: (from: number, to: number) => void
  onOpenFolder: () => void
  onClone: () => void
  onSettings: () => void
  onError: (msg: string) => void
  onInfo: (msg: string | null) => void
  onNewWorktree: (baseRef: string) => void
  onRename: (id: string, name: string) => void
  pullStrategy: PullStrategy
  onPullStrategy: (strategy: PullStrategy) => void
}

export default function ProjectTabs({
  projects,
  closedProjects,
  awake,
  attention,
  busyIds,
  agentActivity,
  activeId,
  onSelect,
  onClose,
  onReopen,
  onForgetClosed,
  onReorder,
  onOpenFolder,
  onClone,
  onSettings,
  onError,
  onInfo,
  onNewWorktree,
  onRename,
  pullStrategy,
  onPullStrategy,
}: Props): JSX.Element {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; id: string; name: string } | null>(null)
  /** right-click on a closed project: the only way to drop it from the reopen list */
  const [forgetAt, setForgetAt] = useState<{ x: number; y: number; id: string; name: string } | null>(null)
  /** id of the tab being renamed; the draft itself lives inside the field */
  const [editing, setEditing] = useState<{ id: string; initial: string } | null>(null)
  const addMenu = useMenu(menuOpen, () => setMenuOpen(false))
  // bound once: reading a member off a handle that carries refs counts as touching a ref
  // during render, whether or not `.current` is what is being read
  const { rootRef: addRootRef, triggerProps: addTrigger } = addMenu
  const tabsRef = useRef<HTMLDivElement>(null)
  const onTabKeys = useRovingFocus(tabsRef, '.tab', 'horizontal')
  const active = projects.find((p) => p.id === activeId) ?? null

  /**
   * What is happening inside each project. One walk of the whole tree — the same walk that used to
   * count nothing but the calling tabs — and every tab in the strip is drawn from its result.
   *
   * The four runtime maps change every few seconds, so this recomputes rather more often than the
   * old count did; each of them comes back as the same object when nothing in it changed
   * (`useTerminalRuntime`), which is what keeps that to the passes where something really moved.
   *
   * Only tabs that can have a process are counted: a diff or an editor tab has no status to
   * report, exactly as in the session pulse this summarises.
   */
  const pulses = useMemo(() => {
    const byProject: Record<string, PulsePart[]> = {}
    for (const p of projects) {
      const statuses: TerminalStatus[] = []
      for (const s of p.sessions) {
        for (const tab of s.terminals) {
          if (tab.kind !== 'agent' && tab.kind !== 'shell') continue
          // `dead` is not passed: it is the terminal area's own bookkeeping and no tab list has it
          statuses.push(
            terminalStatus({
              awake: awake.has(tab.id),
              attention: attention.has(tab.id),
              activity: agentActivity.get(tab.id),
              busy: busyIds.has(tab.id),
            }),
          )
        }
      }
      byProject[p.id] = projectPulse(statuses)
    }
    return byProject
  }, [projects, awake, attention, busyIds, agentActivity])

  return (
    <div className="project-tabs" ref={tabsRef} onKeyDown={onTabKeys}>
      {projects.map((p, i) => {
        const pulse = pulses[p.id] ?? []
        // one sentence, and the only one: the tooltip and the accessible name are the same words,
        // so what a person hovers and what a screen reader hears cannot drift apart
        const status = pulse.map((part) => t.plural(PULSE_LOOK[part.status].key, part.count)).join(' · ')
        return (
          <div
            key={p.id}
            className={'tab' + (p.id === activeId ? ' active' : '')}
            role="button"
            aria-current={p.id === activeId}
            aria-label={
              status
                ? t('projects.tab.aria.status', { name: p.name, status })
                : t('projects.tab.aria', { name: p.name })
            }
            onClick={() => onSelect(p.id)}
            onKeyDown={activateOnKey(() => onSelect(p.id))}
            title={p.isGit ? t('projects.tab.title.git', { path: p.path }) : t('projects.tab.title', { path: p.path })}
            {...dragHandlers('project', i, onReorder)}
            {...middleClickClose(() => onClose(p.id))}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenuAt({ x: e.clientX, y: e.clientY, id: p.id, name: p.name })
            }}
          >
            {/* the dots repeat the accessible name, so they are hidden from it rather than read
                twice; the title is for the pointer, which has no other way to ask */}
            <span className="pulse" aria-hidden="true" title={status || undefined}>
              {pulse.length === 0 ? (
                <span className="dot" />
              ) : (
                pulse.map((part) => <span key={part.status} className={'dot ' + PULSE_LOOK[part.status].cls} />)
              )}
            </span>
            {editing?.id === p.id ? (
              <InlineRename
                className="tab-rename"
                label={t('projects.rename.label')}
                value={editing.initial}
                onCommit={(name) => {
                  onRename(p.id, name)
                  setEditing(null)
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <span
                className="label"
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditing({ id: p.id, initial: p.name })
                }}
              >
                {p.name}
              </span>
            )}
            {/* one meaning per element: the dots say what is happening, the badge says how big the
                project is. It used to turn amber and count the calling tabs, which is what the dots
                now say — two shapes for one fact, and the reader had to work out they agreed. */}
            {p.sessions.length > 0 ? <span className="count">{p.sessions.length}</span> : null}
            <button
              className="close"
              title={t('projects.close')}
              aria-label={t('projects.close.aria', { name: p.name })}
              onClick={(e) => {
                e.stopPropagation()
                onClose(p.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}

      {menuAt && (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          onClose={() => setMenuAt(null)}
          items={[
            {
              label: t('projects.menu.rename'),
              hint: t('projects.menu.rename.hint'),
              onPick: () => setEditing({ id: menuAt.id, initial: menuAt.name }),
            },
            {
              label: t('projects.close'),
              hint: t('projects.menu.close.hint'),
              danger: true,
              onPick: () => onClose(menuAt.id),
            },
          ]}
        />
      )}

      {forgetAt && (
        <ContextMenu
          x={forgetAt.x}
          y={forgetAt.y}
          onClose={() => setForgetAt(null)}
          items={[
            {
              label: t('projects.closed.forget', { name: forgetAt.name }),
              hint: t('projects.closed.forget.hint'),
              danger: true,
              onPick: () => onForgetClosed(forgetAt.id),
            },
          ]}
        />
      )}

      <div className="add-wrap" ref={addRootRef}>
        <button
          className="add"
          {...addTrigger}
          onClick={() => setMenuOpen((v) => !v)}
          title={t('projects.add')}
          aria-label={t('projects.add')}
        >
          +
        </button>
        {menuOpen && (
          <Menu menu={addMenu} className="menu" label={t('projects.add')}>
            <MenuItem
              onClick={() => {
                setMenuOpen(false)
                onOpenFolder()
              }}
            >
              {t('projects.empty.open')}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenuOpen(false)
                onClone()
              }}
            >
              {t('projects.empty.clone')}
            </MenuItem>
            {closedProjects.length > 0 && <MenuSep />}
            {closedProjects.map((p) => (
              <MenuItem
                key={p.id}
                className="closed-project"
                onClick={() => {
                  setMenuOpen(false)
                  onReopen(p.id)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenuOpen(false)
                  setForgetAt({ x: e.clientX, y: e.clientY, id: p.id, name: p.name })
                }}
                title={t('projects.closed.title', { path: p.path, time: formatTime(p.closedAt) })}
              >
                <span className="label">{p.name}</span>
                <span className="hint">{t.plural('projects.sessionCount', p.sessions.length)}</span>
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>

      <div className="spacer" />
      {active && (
        <GitMenu
          project={active}
          onError={onError}
          onInfo={onInfo}
          onNewWorktree={onNewWorktree}
          pullStrategy={pullStrategy}
          onPullStrategy={onPullStrategy}
        />
      )}
      <button
        className="settings"
        title={t('projects.settings')}
        aria-label={t('projects.settings')}
        onClick={onSettings}
      >
        ⚙
      </button>
    </div>
  )
}
