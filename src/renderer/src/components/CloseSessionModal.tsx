import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { Session } from '../../../shared/types'
import { useT } from '../i18n'
import Modal from '../ui/Modal'

interface Props {
  session: Session
  /** the sessions its agent opened, and theirs; parents before children */
  descendants: Session[]
  onCancel: () => void
  /** `closeIds`: the descendants to close along with it; the rest move up to its parent */
  onConfirm: (removeWorktree: boolean, deleteBranch: boolean, closeIds: string[]) => void
}

/** uncommitted files per descendant; absent while loading, null when it could not be read */
type Dirt = Map<string, number | null>

export default function CloseSessionModal({ session, descendants, onCancel, onConfirm }: Props): JSX.Element {
  const t = useT()
  // a session is closed when its work is done: usually both the worktree and the branch go too
  const [removeWorktree, setRemoveWorktree] = useState(true)
  const [deleteBranch, setDeleteBranch] = useState(true)
  const [dirt, setDirt] = useState<Dirt>(new Map())
  /** ids the person unticked or ticked by hand; everything else follows «close the clean ones» */
  const [picked, setPicked] = useState<Map<string, boolean>>(new Map())

  useEffect(() => {
    let alive = true
    for (const d of descendants) {
      window.api.git
        .status(d.cwd, 'working')
        .then((st) => (st.error ? null : st.files.length))
        .catch(() => null)
        .then((n) => {
          if (alive) setDirt((prev) => new Map(prev).set(d.id, n))
        })
    }
    return () => {
      alive = false
    }
  }, [descendants])

  /** a child is closed by default only when it is known to be clean */
  const closing = (id: string): boolean => picked.get(id) ?? dirt.get(id) === 0

  return (
    <Modal title={t('modals.closeSession.title', { name: session.name })} onClose={onCancel}>
      <p className="hint">{t('modals.closeSession.hint')}</p>

      {session.worktree && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={removeWorktree}
              onChange={(e) => {
                setRemoveWorktree(e.target.checked)
                if (!e.target.checked) setDeleteBranch(false)
              }}
            />
            <span>
              {t('modals.closeSession.removeWorktree')}
              <code>{session.worktree.path}</code>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              disabled={!removeWorktree}
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
            />
            {/* the command in the brackets is git's own and stays as it is written in every locale */}
            <span>
              {t('modals.closeSession.deleteBranch')}
              <code>{session.worktree.branch}</code> (git branch -D)
            </span>
          </label>
          {removeWorktree && (
            <p className="hint warn">
              {deleteBranch ? t('modals.closeSession.warnBranch') : t('modals.closeSession.warn')}
            </p>
          )}
        </>
      )}

      {descendants.length > 0 && (
        <div className="close-children">
          <p className="hint">{t('modals.closeSession.children')}</p>
          {descendants.map((d) => {
            const n = dirt.get(d.id)
            return (
              <label key={d.id} className="check">
                <input
                  type="checkbox"
                  checked={closing(d.id)}
                  onChange={(e) => setPicked((prev) => new Map(prev).set(d.id, e.target.checked))}
                />
                <span>
                  {d.name}
                  {d.worktree && <code>{d.worktree.branch}</code>}{' '}
                  <span className={'muted' + (n ? ' warn' : '')}>
                    {n === undefined
                      ? t('modals.closeSession.child.loading')
                      : n === null
                        ? t('modals.closeSession.child.unknown')
                        : n === 0
                          ? t('modals.closeSession.child.clean')
                          : t.plural('modals.closeSession.child.dirty', n)}
                  </span>
                </span>
              </label>
            )
          })}
          <p className="hint">{t('modals.closeSession.children.rest')}</p>
        </div>
      )}

      <div className="modal-actions">
        <button data-testid="modal-cancel" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          className="primary danger"
          onClick={() =>
            onConfirm(
              removeWorktree,
              deleteBranch,
              descendants.filter((d) => closing(d.id)).map((d) => d.id),
            )
          }
        >
          {t('sessions.close')}
        </button>
      </div>
    </Modal>
  )
}
