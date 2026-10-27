import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { BranchInfo } from '../../../shared/types'
import { useT } from '../i18n'
import Modal from '../ui/Modal'

interface Props {
  cwd: string
  /** the path being compared, for the title */
  path: string
  /** the ref to put on the left of the diff */
  onPick: (ref: string) => void
  onClose: () => void
}

/**
 * Git ▸ Compare with branch…: one branch, then the diff tab with that branch on the left.
 *
 * A local branch is handed on as `refs/heads/<name>`, not as its short name: the diff tab
 * resolves a short name the way the session base is resolved — `main` becomes `origin/main`
 * whenever that exists — and the person picked the local one.
 */
export default function BranchPickModal({ cwd, path, onPick, onClose }: Props): JSX.Element {
  const t = useT()
  const [branches, setBranches] = useState<BranchInfo[] | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    void window.api.git.branchInfo(cwd).then((res) => {
      if (alive) setBranches(res)
    })
    return () => {
      alive = false
    }
  }, [cwd])

  const needle = filter.trim().toLowerCase()
  const shown = (branches ?? []).filter((b) => !b.current && b.name.toLowerCase().includes(needle))

  return (
    <Modal title={t('files.compare.title', { name: path })} className="wide" onClose={onClose}>
      <input
        autoFocus
        aria-label={t('files.compare.filter')}
        placeholder={t('files.compare.filter')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="push-commits file-git-list">
        {branches === null && <div className="muted pad small">{t('common.loading')}</div>}
        {branches !== null && shown.length === 0 && <div className="muted pad small">{t('files.compare.empty')}</div>}
        {shown.map((b) => (
          <button
            key={b.name}
            className="push-commit"
            onClick={() => onPick(b.remote ? b.name : `refs/heads/${b.name}`)}
            title={b.subject}
          >
            <span className="subject">{b.name}</span>
            <span className="meta muted small">{b.subject}</span>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </Modal>
  )
}
