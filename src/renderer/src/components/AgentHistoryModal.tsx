import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type {
  ConversationHits,
  ConversationRef,
  ExternalSession,
  ExternalSessionQuery,
  Project,
  Settings,
} from '../../../shared/types'
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

/** shorter queries match nearly every conversation, and each search reads the whole store */
const SEARCH_MIN_CHARS = 3
/** a pause in typing before the store is read: one search per word, not per key */
const SEARCH_DELAY_MS = 350

/** the query split around its matches, for highlighting; the match keeps its own letter case */
function highlight(text: string, query: string): (string | JSX.Element)[] {
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  const out: (string | JSX.Element)[] = []
  let from = 0
  for (let i = hay.indexOf(needle); needle && i !== -1; i = hay.indexOf(needle, from)) {
    if (i > from) out.push(text.slice(from, i))
    out.push(<mark key={i}>{text.slice(i, i + needle.length)}</mark>)
    from = i + needle.length
  }
  if (from < text.length) out.push(text.slice(from))
  return out
}

export default function AgentHistoryModal({ project, settings, onCancel, onOpen, onError }: Props): JSX.Element {
  const t = useT()
  const [filter, setFilter] = useState('')
  const [hideKnown, setHideKnown] = useState(false)

  const queries = useMemo(() => queriesFor(settings), [settings])
  const kindOf = useMemo(() => new Map(queries.map((q) => [q.agentId, q.kind])), [queries])
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

  /**
   * What the conversations themselves say. Tagged with the list and the query it answers, like the
   * list itself: an answer to an older query is simply not shown, never cleared from the effect.
   */
  const query = filter.trim()
  const searchKey = query.length >= SEARCH_MIN_CHARS && entries ? `${key}\0${query}` : null
  const [found, setFound] = useState<{ key: string; hits: Map<string, ConversationHits> } | null>(null)
  const hits = searchKey !== null && found?.key === searchKey ? found.hits : null

  useEffect(() => {
    if (searchKey === null || !entries) return
    const refs: ConversationRef[] = []
    for (const e of entries) {
      const kind = kindOf.get(e.agentId)
      if (kind) refs.push({ id: e.id, kind, ...(e.configDir ? { configDir: e.configDir } : {}) })
    }
    let alive = true
    const timer = setTimeout(() => {
      void window.api.agents
        .searchConversations(refs, query)
        .then((list) => {
          if (alive) setFound({ key: searchKey, hits: new Map(list.map((h) => [h.id, h])) })
        })
        .catch((e: unknown) => {
          if (!alive) return
          onError(String(e))
          setFound({ key: searchKey, hits: new Map() })
        })
    }, SEARCH_DELAY_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [searchKey, entries, kindOf, query, onError])

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
    const q = query.toLowerCase()
    if (!q) return true
    return e.title.toLowerCase().includes(q) || e.cwd.toLowerCase().includes(q) || Boolean(hits?.has(e.id))
  })
  const searching = searchKey !== null && hits === null

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
        {entries !== null && !searching && visible.length === 0 && (
          <div className="muted pad">{t('modals.agents.none')}</div>
        )}
        {visible.map((e) => {
          const agent = findAgent(settings, e.agentId)
          const mark = known.get(e.id)
          const hit = hits?.get(e.id)
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
                {hit && (
                  <div className="ext-hits">
                    {hit.matches.map((m, i) => (
                      <div key={i} className="ext-hit" title={formatTime(m.at)}>
                        <span className="who">
                          {t(m.role === 'user' ? 'modals.agents.hit.user' : 'modals.agents.hit.agent')}
                        </span>
                        <span className="what">{highlight(m.snippet, query)}</span>
                      </div>
                    ))}
                    {hit.total > hit.matches.length && (
                      <div className="muted small">
                        {t.plural('modals.agents.hit.more', hit.total - hit.matches.length)}
                      </div>
                    )}
                  </div>
                )}
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
          {searching
            ? t('modals.agents.searching')
            : entries
              ? t('modals.agents.shown', { shown: visible.length, total: entries.length })
              : ''}
        </span>
        <div className="spacer" />
        <button data-testid="modal-close" onClick={onCancel}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  )
}
