import type { JSX } from 'react'
import { useState } from 'react'
import { useT } from '../i18n'
import Modal from '../ui/Modal'

interface Props {
  /** name of the branch being renamed */
  branch: string
  /** called only with a new, non-empty name: renaming to the same thing is a cancel */
  onRename: (to: string) => void
  onClose: () => void
}

/**
 * Branch rename. Shared by the project menu and the session branch menu: it is the same
 * question, and the wording must not drift between the two — as with PullChoiceModal.
 */
export default function RenameBranchModal({ branch, onRename, onClose }: Props): JSX.Element {
  const t = useT()
  const [to, setTo] = useState(branch)

  const submit = (): void => {
    const name = to.trim()
    onClose()
    if (name && name !== branch) onRename(name)
  }

  return (
    <Modal title={t('git.rename.title', { branch })} onClose={onClose}>
      <label>
        <span>{t('git.rename.newName')}</span>
        <input
          autoFocus
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      <div className="modal-actions">
        <button onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary" onClick={submit}>
          {t('git.rename.submit')}
        </button>
      </div>
    </Modal>
  )
}
