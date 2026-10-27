import type { JSX } from 'react'
import { useT } from '../i18n'
import Modal from '../ui/Modal'

interface Props {
  /** the operation that was refused, already worded: the label of its run, «Switching to main» */
  what: string
  onConfirm: () => void
  onClose: () => void
}

/**
 * Checkout, merge or rebase refused over uncommitted edits: offer to stash them, run the same
 * operation, and put them back — what pull does with `--autostash`. Shared by the project menu
 * and the session branch menu: it is the same question in both.
 */
export default function StashChoiceModal({ what, onConfirm, onClose }: Props): JSX.Element {
  const t = useT()
  return (
    <Modal title={t('git.stash.title')} onClose={onClose}>
      <p className="hint">{t('git.stash.hint', { what })}</p>
      <div className="modal-actions">
        <button onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary" onClick={onConfirm}>
          {t('git.stash.confirm')}
        </button>
      </div>
    </Modal>
  )
}
