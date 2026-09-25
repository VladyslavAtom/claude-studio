import type { JSX } from 'react'
import { useState } from 'react'
import type { Session } from '../../../shared/types'
import { useT } from '../i18n'
import Modal from '../ui/Modal'

interface Props {
  session: Session
  onCancel: () => void
  onConfirm: (removeWorktree: boolean, deleteBranch: boolean) => void
}

export default function CloseSessionModal({ session, onCancel, onConfirm }: Props): JSX.Element {
  const t = useT()
  // a session is closed when its work is done: usually both the worktree and the branch go too
  const [removeWorktree, setRemoveWorktree] = useState(true)
  const [deleteBranch, setDeleteBranch] = useState(true)

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

      <div className="modal-actions">
        <button data-testid="modal-cancel" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="primary danger" onClick={() => onConfirm(removeWorktree, deleteBranch)}>
          {t('sessions.close')}
        </button>
      </div>
    </Modal>
  )
}
