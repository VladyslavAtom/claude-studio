import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Project, ProjectWorktrees, RepoWorktree, WorktreeStatus } from '../../../shared/types'
import { relativeTo } from '../../../shared/worktrees'
import type { T } from '../i18n'
import { useT } from '../i18n'
import { sessionWorktrees } from '../lib/worktrees'
import Modal from '../ui/Modal'
import { resultMessage } from '../ui/useGitAction'
import PrBadge from './PrBadge'

interface Props {
  project: Project
  /** the project's worktrees as last read; null while the first read is out */
  data: ProjectWorktrees | null
  /** re-read the list: after a removal the worktree is gone from it */
  onRefresh: () => void
  /** folders only the renderer knows are in use (session folders, running agents' worktrees) */
  hints: () => string[]
  /** a shell tab opens in the session on screen; without one there is nowhere to put it */
  canOpenShell: boolean
  onOpenSession: (path: string) => void
  onOpenShell: (path: string) => void
  onClose: () => void
  onError: (msg: string) => void
}

interface Row {
  repo: string
  wt: RepoWorktree
}

/**
 * Every worktree of the project's repositories, the ones agents made themselves included: branch,
 * PR, what removing it would lose, which sessions worked there, whether something works there now.
 *
 * Removal comes in two kinds, as decided: «remove merged» takes only worktrees with nothing to
 * lose, after showing the list; any other goes one at a time, after a dialog naming what would be
 * lost. Main checks both again before it acts, and never removes one that is in use.
 */
export default function WorktreesModal({
  project,
  data,
  onRefresh,
  hints,
  canOpenShell,
  onOpenSession,
  onOpenShell,
  onClose,
  onError,
}: Props): JSX.Element {
  const t = useT()
  const rows = useMemo<Row[]>(
    () =>
      (data?.repos ?? []).flatMap((r) => r.worktrees.filter((wt) => !wt.prunable).map((wt) => ({ repo: r.repo, wt }))),
    [data],
  )
  const linked = useMemo(() => rows.filter((r) => !r.wt.isMain), [rows])
  /** what each linked worktree would lose; absent while it is being read */
  const [statuses, setStatuses] = useState<Map<string, WorktreeStatus>>(new Map())
  const [removing, setRemoving] = useState<Row | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  /** the status line of the view: what is being removed, then how many went */
  const [note, setNote] = useState('')

  const hintsRef = useRef(hints)
  useEffect(() => {
    hintsRef.current = hints
  })

  // the statuses of what is listed now; a list that changes while a read is out asks again
  const itemsKey = linked.map((r) => `${r.repo}\0${r.wt.path}`).join('\n')
  const readToken = useRef(0)
  const readStatuses = useCallback(async (): Promise<void> => {
    const token = ++readToken.current
    // nothing linked: no row asks for a status, so whatever is kept is never shown
    if (!itemsKey) return
    const items = itemsKey.split('\n').map((line) => {
      const [repo = '', path = ''] = line.split('\0')
      return { repo, path }
    })
    try {
      const list = await window.api.worktrees.status(items, hintsRef.current())
      if (token === readToken.current) setStatuses(new Map(list.map((s) => [s.path, s])))
    } catch {
      if (token === readToken.current) setStatuses(new Map())
    }
  }, [itemsKey])

  useEffect(() => {
    void readStatuses()
  }, [readStatuses])

  const owners = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const s of project.sessions)
      for (const w of sessionWorktrees(s, data)) map.set(w.path, [...(map.get(w.path) ?? []), s.name])
    return map
  }, [project.sessions, data])

  const safe = linked.filter((r) => statuses.get(r.wt.path)?.safe)

  /** one removal, reported; true when the worktree is gone */
  const removeOne = async (row: Row, force: boolean): Promise<boolean> => {
    const r = await window.api.worktrees.remove({ repo: row.repo, path: row.wt.path, force }, hintsRef.current())
    if (!r.ok) {
      onError(`${relativeTo(row.wt.path, row.repo)}: ${resultMessage(t, r, 'git worktree remove failed')}`)
      return false
    }
    if (r.code || r.warning) onError(`${relativeTo(row.wt.path, row.repo)}: ${resultMessage(t, r)}`)
    return true
  }

  const run = async (list: readonly Row[], force: boolean): Promise<void> => {
    setBusy(true)
    setNote(t('worktrees.busy'))
    let done = 0
    try {
      // one at a time: git takes a lock on the repository's worktree records for each
      for (const row of list) if (await removeOne(row, force)) done++
    } finally {
      setBusy(false)
      setNote(t.plural('worktrees.bulk.done', done))
    }
    onRefresh()
    void readStatuses()
  }

  const refreshAll = (): void => {
    onRefresh()
    void readStatuses()
  }

  const byRepo = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of rows) map.set(r.repo, [...(map.get(r.repo) ?? []), r])
    return [...map]
  }, [rows])

  return (
    <Modal title={t('worktrees.title', { project: project.name })} className="wide worktrees-modal" onClose={onClose}>
      <p className="hint">{t('worktrees.hint')}</p>
      {!data ? (
        <p className="muted">{t('worktrees.loading')}</p>
      ) : !linked.length ? (
        <p className="muted">{t('worktrees.empty')}</p>
      ) : null}

      <div className="worktrees-list">
        {byRepo.map(([repo, list]) => (
          <section key={repo} className="worktrees-repo">
            <h3 title={repo}>
              {relativeTo(repo, project.path) === '.' ? project.name : relativeTo(repo, project.path)}
            </h3>
            {list.map((row) => (
              <WorktreeRow
                key={row.wt.path}
                row={row}
                status={statuses.get(row.wt.path)}
                owners={owners.get(row.wt.path) ?? []}
                busy={busy}
                canOpenShell={canOpenShell}
                onOpenSession={() => onOpenSession(row.wt.path)}
                onOpenShell={() => onOpenShell(row.wt.path)}
                onRemove={() => setRemoving(row)}
                t={t}
              />
            ))}
          </section>
        ))}
      </div>

      <div className="modal-actions">
        <button onClick={refreshAll} disabled={busy}>
          {t('worktrees.refresh')}
        </button>
        <span className="muted small" role="status">
          {note}
        </span>
        <div className="spacer" />
        <button
          className="danger"
          data-testid="worktrees-remove-merged"
          disabled={busy || !safe.length}
          onClick={() => setBulkOpen(true)}
        >
          {t('worktrees.bulk.button', { count: safe.length })}
        </button>
        <button data-testid="modal-cancel" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>

      {bulkOpen && (
        <Modal title={t('worktrees.bulk.title')} onClose={() => setBulkOpen(false)}>
          <p className="hint">{t('worktrees.bulk.hint')}</p>
          <ul className="worktrees-bulk">
            {safe.map((r) => (
              <li key={r.wt.path} title={r.wt.path}>
                <code>{relativeTo(r.wt.path, r.repo)}</code> ⎇ {r.wt.branch ?? t('worktrees.item.detached')}
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            <button data-testid="modal-cancel" onClick={() => setBulkOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              className="primary danger"
              onClick={() => {
                setBulkOpen(false)
                void run(safe, false)
              }}
            >
              {t('worktrees.bulk.confirm', { count: safe.length })}
            </button>
          </div>
        </Modal>
      )}

      {removing && (
        <RemoveWorktreeModal
          row={removing}
          status={statuses.get(removing.wt.path)}
          onCancel={() => setRemoving(null)}
          onConfirm={(force) => {
            const row = removing
            setRemoving(null)
            void run([row], force)
          }}
          t={t}
        />
      )}
    </Modal>
  )
}

function WorktreeRow({
  row,
  status,
  owners,
  busy,
  canOpenShell,
  onOpenSession,
  onOpenShell,
  onRemove,
  t,
}: {
  row: Row
  status: WorktreeStatus | undefined
  owners: string[]
  busy: boolean
  canOpenShell: boolean
  onOpenSession: () => void
  onOpenShell: () => void
  onRemove: () => void
  t: T
}): JSX.Element {
  const { wt, repo } = row
  return (
    <div className={'worktree-row' + (status?.live ? ' live' : '')} data-testid="worktree-row" title={wt.path}>
      <div className="worktree-main">
        <span className="wt-name">{wt.isMain ? t('worktrees.item.main') : relativeTo(wt.path, repo)}</span>
        <span className="branch">⎇ {wt.branch ?? t('worktrees.item.detached')}</span>
        {status?.pr && <PrBadge pr={status.pr} compact />}
        {wt.locked && <span className="muted small">{t('worktrees.item.locked')}</span>}
        {status?.live && (
          <span className="live-mark" title={t('worktrees.item.live.title')}>
            {t('worktrees.item.live')}
          </span>
        )}
      </div>
      {!wt.isMain && (
        <div className="worktree-facts muted small">
          <StatusFacts status={status} t={t} />
          {owners.length > 0 && <span>{t('worktrees.item.owners', { names: owners.join(', ') })}</span>}
        </div>
      )}
      <div className="worktree-actions">
        <button className="link" onClick={onOpenSession}>
          {t('worktrees.action.openSession')}
        </button>
        <button
          className="link"
          disabled={!canOpenShell}
          title={canOpenShell ? undefined : t('worktrees.action.shell.noSession')}
          onClick={onOpenShell}
        >
          {t('worktrees.action.shell')}
        </button>
        {!wt.isMain && (
          <button
            className="link danger"
            data-testid="worktree-remove"
            disabled={busy || !status || status.live}
            title={status?.live ? t('worktrees.item.live.title') : undefined}
            onClick={onRemove}
          >
            {t('worktrees.action.remove')}
          </button>
        )}
      </div>
    </div>
  )
}

function StatusFacts({ status, t }: { status: WorktreeStatus | undefined; t: T }): JSX.Element {
  if (!status) return <span>{t('worktrees.item.statusLoading')}</span>
  if (status.changed === null || status.unpushed === null) return <span>{t('worktrees.item.statusUnknown')}</span>
  return (
    <>
      <span className={status.changed ? 'warn' : ''}>
        {status.changed ? t.plural('worktrees.item.changed', status.changed) : t('worktrees.item.clean')}
      </span>
      {status.unpushed > 0 && <span className="warn">{t.plural('worktrees.item.unpushed', status.unpushed)}</span>}
      <span className={status.merged ? '' : 'warn'}>
        {status.merged ? t('worktrees.item.merged') : t('worktrees.item.notMerged')}
      </span>
    </>
  )
}

/**
 * Removing one worktree. Safe: said so, and git is asked without force. Otherwise the dialog names
 * what goes — the changed files, the unpushed commits, an unmerged branch — and the confirmation is
 * what lets main use `--force` and `-D`.
 */
function RemoveWorktreeModal({
  row,
  status,
  onCancel,
  onConfirm,
  t,
}: {
  row: Row
  status: WorktreeStatus | undefined
  onCancel: () => void
  onConfirm: (force: boolean) => void
  t: T
}): JSX.Element {
  const { wt, repo } = row
  const safe = status?.safe === true
  const losses: string[] = []
  if (status && !safe) {
    if (status.changed === null || status.unpushed === null) losses.push(t('worktrees.item.statusUnknown'))
    if (status.changed) losses.push(t.plural('worktrees.item.changed', status.changed))
    if (status.unpushed) losses.push(t.plural('worktrees.item.unpushed', status.unpushed))
    if (!status.merged && wt.branch) losses.push(t('worktrees.remove.notMerged', { branch: wt.branch }))
  }
  return (
    <Modal title={t('worktrees.remove.title', { name: relativeTo(wt.path, repo) })} onClose={onCancel}>
      {safe ? (
        <p className="hint">{t('worktrees.remove.safe')}</p>
      ) : (
        <>
          <p className="hint warn">{t('worktrees.remove.loses')}</p>
          <ul className="worktrees-bulk">
            {losses.map((l) => (
              <li key={l} className="warn">
                {l}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="hint">
        {t('worktrees.remove.what')}
        <code>{wt.path}</code>
        {wt.branch && (
          <>
            {' '}
            ⎇ <code>{wt.branch}</code>
          </>
        )}{' '}
        {/* git's own commands, the same in every locale */}
        <span className="muted">
          ({safe ? 'git worktree remove, git branch -d' : 'git worktree remove --force, git branch -D'})
        </span>
      </p>
      <div className="modal-actions">
        <button data-testid="modal-cancel" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="primary danger" onClick={() => onConfirm(!safe)}>
          {t('worktrees.remove.confirm')}
        </button>
      </div>
    </Modal>
  )
}
