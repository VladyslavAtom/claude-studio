import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { basename } from '../lib/util'
import Modal from '../ui/Modal'
import { resultMessage } from '../ui/useGitAction'

interface Props {
  onCancel: () => void
  onCloned: (path: string) => void | Promise<void>
  setBusy: (msg: string | null) => void
  setError: (msg: string | null) => void
}

export default function CloneModal({ onCancel, onCloned, setBusy, setError }: Props): JSX.Element {
  const t = useT()
  const [url, setUrl] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [name, setName] = useState('')
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void window.api.system.homeDir().then((h) => setParentDir((p) => p || h))
  }, [])

  const autoName = url ? basename(url.replace(/\.git$/, '')) : ''

  const submit = async (): Promise<void> => {
    if (!url.trim() || !parentDir.trim() || running) return
    setRunning(true)
    setBusy(t('modals.clone.busy'))
    const res = await window.api.git.clone(url.trim(), parentDir.trim(), name.trim() || undefined)
    setBusy(null)
    setRunning(false)
    if (!res.ok || !res.path) {
      // an address the app rejected itself arrives as a code and has no `error` at all; what git
      // said comes through as detail, untranslated, because it is git's own words
      setError(resultMessage(t, res, t('git.run.failed', { label: 'git clone' })))
      return
    }
    await onCloned(res.path)
  }

  return (
    <Modal title={t('modals.clone.title')} onClose={onCancel}>
      <label>
        <span>URL</span>
        <input
          autoFocus
          placeholder={t('modals.clone.url.placeholder')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </label>

      <label>
        <span>{t('modals.clone.where')}</span>
        <div className="row">
          <input value={parentDir} onChange={(e) => setParentDir(e.target.value)} />
          <button
            aria-label={t('modals.clone.pick')}
            onClick={async () => {
              const dir = await window.api.dialog.pickDirectory(t('modals.clone.pick.title'))
              if (dir) setParentDir(dir)
            }}
          >
            …
          </button>
        </div>
      </label>

      <label>
        <span>{t('modals.clone.name')}</span>
        <input placeholder={autoName} value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <p className="hint">{t('modals.clone.hint')}</p>

      <div className="modal-actions">
        <button data-testid="modal-cancel" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="primary" disabled={running} onClick={() => void submit()}>
          {running ? t('modals.clone.running') : t('modals.clone.submit')}
        </button>
      </div>
    </Modal>
  )
}
