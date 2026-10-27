import type { JSX } from 'react'
import { useT } from '../i18n'
import Modal from '../ui/Modal'

interface Props {
  /** what goes back, as the person knows it: repo-relative paths */
  paths: string[]
  onCancel: () => void
  onConfirm: () => void
}

/**
 * The one confirmation before files are reverted. The changes panel and the file tree's Git ▸
 * menu run the same operation, so they ask the same question in the same words.
 */
export default function RevertConfirmModal({ paths, onCancel, onConfirm }: Props): JSX.Element {
  const t = useT()
  return (
    <Modal title={t.plural('changes.revert.confirm', paths.length)} onClose={onCancel}>
      <p className="hint warn">{t('changes.revert.warn')}</p>
      <ul className="revert-list">
        {paths.slice(0, 12).map((p) => (
          <li key={p}>{p}</li>
        ))}
        {paths.length > 12 && <li className="muted">{t('changes.revert.more', { count: paths.length - 12 })}</li>}
      </ul>
      <div className="modal-actions">
        <button data-testid="modal-cancel" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="primary danger" onClick={onConfirm}>
          {t('changes.revert')}
        </button>
      </div>
    </Modal>
  )
}
