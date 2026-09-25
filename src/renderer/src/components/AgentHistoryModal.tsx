import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { ExternalSession, ExternalSessionQuery, Project, Settings } from '../../../shared/types'
import { useT } from '../i18n'
import { findAgent } from '../lib/agents'
import { basename, formatTime } from '../lib/util'
import Modal from '../ui/Modal'

interface Props {
  project: Project
  settings: Settings
  onCancel: () => void
  onOpen: (entry: ExternalSession) => void
  onError: (msg: string) => void
}

/**
 * Where an agent keeps its conversations. The kind comes from preset/sessionSource rather than
 * from the command name: a wrapper such as `claude-1` does not end in «claude» yet is still a
 * claude preset with sessionSource 'uuid'. The command name is only the fallback for agents of
 * the custom preset. For Claude the directory is named only when the agent's settings set one:
 * the main process reads every ~/.claude* profile anyway and labels them by name.
 */
function queriesFor(settings: Settings): ExternalSessionQuery[] {
  const out: ExternalSessionQuery[] = []
  for (const a of settings.agents) {
    const command = a.command.toLowerCase()
    if (a.preset === 'codex' || a.sessionSource === 'codex' || command.endsWith('codex')) {
      out.push({ agentId: a.id, kind: 'codex' })
    } else if (a.preset === 'claude' || a.sessionSource === 'uuid' || command.endsWith('claude')) {
      out.push({ agentId: a.id, kind: 'claude', configDir: a.env.CLAUDE_CONFIG_DIR })
    }
  }
  return out
}

export default function AgentHistoryModal({ project, settings, onCancel, onOpen, onError }: Props): JSX.Element {
  const t = useT()
  const [filter, setFilter] = useState('')
  const [hideKnown, setHideKnown] = useState(false)

  const queries = useMemo(() => queriesFor(settings), [settings])
  const key = `${project.path}\0${JSON.stringify(queries)}`
  const [loaded, setLoaded] = useState<{ key: string; list: ExternalSession[] } | null>(null)

  /**
   * The answer for a previous project arrives after the new one was asked for, so a result is
   * only shown when it belongs to the current question. Tagging it beats clearing the list from
   * inside the effect: that would set state during the effect and re-render the modal twice.
   */
  const entries = loaded?.key === key ? loaded.list : null

  useEffect(() => {
    let alive = true
    void window.api.agents
      .listExternalSessions(project.path, queries)
      .then((list) => {
        if (alive) setLoaded({ key, list })
      })
      .catch((e: unknown) => {
        if (!alive) return
        onError(String(e))
        setLoaded({ key, list: [] })
      })
    return () => {
      alive = false
    }
  }, [project.path, queries, key, onError])

  /** ids the app already tracks: open tabs, recorded runs and archived sessions */
  const known = useMemo(() => {
    const ids = new Map<string, string>()
    // where the conversation was met is one whole sentence per case, not a label glued to a name
    const collect = (sessions: Project['sessions'], mark: (name: string) => string): void => {
      for (const s of sessions) {
        for (const term of s.terminals) if (term.agentSessionId) ids.set(term.agentSessionId, mark(s.name))
        for (const r of s.runs ?? [])
          if (r.agentSessionId) ids.set(r.agentSessionId, t('modals.agents.mark.run', { name: s.name }))
      }
    }
    collect(project.sessions, (name) => t('modals.agents.mark.open', { name }))
    collect(project.history ?? [], (name) => t('modals.agents.mark.history', { name }))
    return ids
  }, [project, t])

  const visible = (entries ?? []).filter((e) => {
    if (hideKnown && known.has(e.id)) return false
    const q = filter.trim().toLowerCase()
    if (!q) return true
    return e.title.toLowerCase().includes(q) || e.cwd.toLowerCase().includes(q)
  })

  return (
    <Modal title={t('modals.agents.title', { project: project.name })} className="wide" onClose={onCancel}>
      <p className="hint">{t('modals.agents.hint')}</p>

      <div className="row">
        <input
          aria-label={t('modals.agents.filter')}
          placeholder={t('modals.agents.filter')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={hideKnown} onChange={(e) => setHideKnown(e.target.checked)} />
          <span>{t('modals.agents.onlyNew')}</span>
        </label>
      </div>

      <div className="ext-list">
        {entries === null && <div className="muted pad">{t('modals.agents.loading')}</div>}
        {entries !== null && visible.length === 0 && <div className="muted pad">{t('modals.agents.none')}</div>}
        {visible.map((e) => {
          const agent = findAgent(settings, e.agentId)
          const mark = known.get(e.id)
          return (
            <div key={e.id} className={'ext-item' + (mark ? ' known' : '')}>
              <span className="dot" style={{ background: agent?.color ?? 'var(--fg-dim)' }} title={agent?.name} />
              <div className="ext-main">
                <div className="ext-title">{e.title}</div>
                <div className="ext-meta">
                  <span className="muted small">{agent?.name ?? e.agentId}</span>
                  {e.configDir && basename(e.configDir) !== '.claude' && (
                    <span className="muted small" title={t('modals.agents.store', { path: e.configDir })}>
                      {basename(e.configDir)}
                    </span>
                  )}
                  <span className="muted small">{e.cwd.replace(project.path, '.')}</span>
                  <span className="muted small">{formatTime(e.updatedAt)}</span>
                  {mark && <span className="badge">{mark}</span>}
                </div>
              </div>
              <button onClick={() => onOpen(e)} title={t('modals.agents.open.title', { title: e.title })}>
                {t('modals.agents.open')}
              </button>
            </div>
          )
        })}
      </div>

      <div className="modal-actions">
        <span className="muted small">
          {entries ? t('modals.agents.shown', { shown: visible.length, total: entries.length }) : ''}
        </span>
        <div className="spacer" />
        <button data-testid="modal-close" onClick={onCancel}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  )
}
