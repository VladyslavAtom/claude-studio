import type { JSX } from 'react'
import { useState } from 'react'
import type { StartupPolicy } from '../../../shared/types'
import { useT } from '../i18n'
import Modal from '../ui/Modal'

interface Props {
  agents: number
  sessions: number
  onAll: () => void
  onNone: () => void
  onRemember: (policy: StartupPolicy) => void
}

export default function StartupModal({ agents, sessions, onAll, onNone, onRemember }: Props): JSX.Element {
  const t = useT()
  const [remember, setRemember] = useState(false)

  const choose = (policy: 'all' | 'none'): void => {
    if (remember) onRemember(policy)
    if (policy === 'all') onAll()
    else onNone()
  }

  // an answer is required: this dialog has neither Escape nor close-on-backdrop
  return (
    <Modal title={t('modals.startup.title', { n: sessions })}>
      {/* the count of tabs agrees with the number, the offer that follows does not: two sentences */}
      <p className="hint">
        {t.plural('modals.startup.tabs', agents)} {t('modals.startup.hint')}
      </p>

      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>{t('modals.startup.remember')}</span>
      </label>

      <div className="modal-actions">
        <button onClick={() => choose('all')}>{t('modals.startup.all')}</button>
        <button className="primary" data-testid="startup-keep-asleep" onClick={() => choose('none')}>
          {t('modals.startup.none')}
        </button>
      </div>
    </Modal>
  )
}
