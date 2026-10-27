import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { CommitInfo } from '../../../shared/types'
import { useT } from '../i18n'
import { formatTime } from '../lib/util'
import Modal from '../ui/Modal'

interface Props {
  /** the tree's root: the path is relative to it, and git runs there */
  cwd: string
  path: string
  onPick: (hash: string) => void
  onClose: () => void
}

/**
 * Git ▸ Show History: the commits touching one path, newest first, drawn like the push window's
 * list. A click opens the diff tab against that revision — the diff tab's right side is always
 * the working file, so this is PyCharm's «Compare with revision», not the commit's own patch.
 */
export default function FileHistoryModal({ cwd, path, onPick, onClose }: Props): JSX.Element {
  const t = useT()
  /** null while git is still answering: "no commits" and "not read yet" are different */
  const [commits, setCommits] = useState<CommitInfo[] | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.git.fileHistory(cwd, path).then((res) => {
      if (alive) setCommits(res)
    })
    return () => {
      alive = false
    }
  }, [cwd, path])

  return (
    <Modal title={t('files.history.title', { name: path })} className="wide" onClose={onClose}>
      <p className="muted small">{t('files.history.hint')}</p>
      <div className="push-commits file-git-list">
        {commits === null && <div className="muted pad small">{t('common.loading')}</div>}
        {commits?.length === 0 && <div className="muted pad small">{t('files.history.empty')}</div>}
        {commits?.map((c) => (
          <button key={c.hash} className="push-commit" onClick={() => onPick(c.hash)} title={c.subject}>
            <span className="subject">{c.subject}</span>
            <span className="meta muted small">
              <code>{c.short}</code>
              {c.author} · {formatTime(c.date)}
            </span>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>{t('common.close')}</button>
      </div>
    </Modal>
  )
}
