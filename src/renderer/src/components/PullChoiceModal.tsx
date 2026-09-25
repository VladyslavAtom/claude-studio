import type { JSX } from 'react'
import { useState } from 'react'
import type { PullStrategy } from '../../../shared/types'
import { useT } from '../i18n'
import Modal from '../ui/Modal'

interface Props {
  /**
   * What is being updated, already worded: `git.pullChoice.what.project` or
   * `…what.branch`. It goes into the title so the project is not mistaken for a session branch.
   */
  what: string
  onPick: (strategy: 'merge' | 'rebase', remember: boolean) => void
  onClose: () => void
}

/**
 * Choice of pull strategy. Shared by the project menu and the session branch menu: it is the
 * same question, and the wording must not drift between the two.
 */
export default function PullChoiceModal({ what, onPick, onClose }: Props): JSX.Element {
  const t = useT()
  const [remember, setRemember] = useState(false)

  const pick = (strategy: PullStrategy & ('merge' | 'rebase')): void => {
    onPick(strategy, remember)
  }

  return (
    <Modal title={t('git.pullChoice.title', { what })} onClose={onClose}>
      <div className="choice-list">
        <button className="choice" onClick={() => pick('rebase')}>
          <span className="choice-title">{t('git.pullChoice.rebase')}</span>
          <span className="choice-hint">{t('git.pullChoice.rebase.hint')}</span>
        </button>
        <button className="choice" onClick={() => pick('merge')}>
          <span className="choice-title">{t('git.pullChoice.merge')}</span>
          <span className="choice-hint">{t('git.pullChoice.merge.hint')}</span>
        </button>
      </div>
      <label className="row-check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>{t('git.pullChoice.remember')}</span>
      </label>
      <div className="modal-actions">
        <button onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </Modal>
  )
}
