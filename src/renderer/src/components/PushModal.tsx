import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { ChangedFile, CommitInfo } from '../../../shared/types'
import { useT } from '../i18n'
import { formatTime } from '../lib/util'
import Modal from '../ui/Modal'
import { lastLine, useGitAction } from '../ui/useGitAction'
import ChangedFileRow from './ChangedFileRow'

interface Props {
  cwd: string
  branch: string
  /** the tracked branch on the server; null when the branch has never been pushed */
  upstream: string | null
  /** what the branch forked from: its commits are what we show while there is no upstream */
  baseRef?: string | undefined
  onClose: () => void
  onError: (msg: string) => void
  onInfo: (msg: string | null) => void
  onDone: () => void
}

/**
 * What will leave for the server: commits on the left, the files of the selected one on the
 * right. One window for both entry points — the ↑ arrow in the changes panel and the
 * «Push the current branch» menu entry.
 */
export default function PushModal({
  cwd,
  branch,
  upstream,
  baseRef,
  onClose,
  onError,
  onInfo,
  onDone,
}: Props): JSX.Element {
  const t = useT()
  const [commits, setCommits] = useState<CommitInfo[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const { busy: pushing, run } = useGitAction({ onError, onInfo })

  // without an upstream the whole branch leaves, so show all of it, counted from the base
  const range = upstream ? `${upstream}..HEAD` : baseRef ? `${baseRef}..HEAD` : 'HEAD'

  /**
   * «Not read yet» is cleared while rendering rather than from the effect below. Doing it in
   * the effect paints one frame of the previous repository's commits under the new heading,
   * and costs a second render anyway — React restarts this one before touching the DOM.
   */
  const commitsKey = `${cwd}\0${range}`
  const [commitsFor, setCommitsFor] = useState(commitsKey)
  if (commitsFor !== commitsKey) {
    setCommitsFor(commitsKey)
    setCommits(null)
  }
  const filesKey = `${cwd}\0${selected ?? ''}`
  const [filesFor, setFilesFor] = useState(filesKey)
  if (filesFor !== filesKey) {
    setFilesFor(filesKey)
    setFiles(null)
  }

  useEffect(() => {
    // the answer for the previous range arrives after the new one and would reset the selection
    let alive = true
    void window.api.git.listCommits(cwd, range).then((list) => {
      if (!alive) return
      setCommits(list)
      setSelected(list[0]?.hash ?? null)
    })
    return () => {
      alive = false
    }
  }, [cwd, range])

  useEffect(() => {
    if (!selected) return
    let alive = true
    void window.api.git.commitFiles(cwd, selected).then((list) => {
      if (alive) setFiles(list)
    })
    return () => {
      alive = false
    }
  }, [cwd, selected])

  const push = async (): Promise<void> => {
    // git push writes the line worth showing last, after the progress noise. The name of the
    // call is git's own and stays English in every locale: it is what the status line shows
    const res = await run('Push', () => window.api.git.push(cwd, branch, !upstream), {
      done: (r) => lastLine(r.output) || t('changes.push.done'),
    })
    if (!res?.ok) return
    onDone()
    onClose()
  }

  const count = commits?.length ?? 0

  const title = (
    <>
      {t('changes.push.title', { branch })}{' '}
      <span className="muted small">→ {upstream ?? t('changes.push.newBranch')}</span>
    </>
  )

  return (
    <Modal title={title} className="wide push-modal" onClose={onClose}>
      <div className="push-body">
        <div className="push-commits">
          {commits === null && <div className="muted pad small">{t('changes.push.reading')}</div>}
          {commits !== null && count === 0 && <div className="muted pad small">{t('changes.push.nothing')}</div>}
          {commits?.map((c) => (
            <button
              key={c.hash}
              className={'push-commit' + (selected === c.hash ? ' active' : '')}
              aria-current={selected === c.hash}
              onClick={() => setSelected(c.hash)}
              title={c.subject}
            >
              <span className="subject">{c.subject}</span>
              <span className="meta muted small">
                <code>{c.short}</code>
                {c.author} · {formatTime(c.date)}
              </span>
            </button>
          ))}
        </div>

        <div className="push-files">
          {files === null && selected && <div className="muted pad small">{t('changes.push.readingFiles')}</div>}
          {files?.length === 0 && <div className="muted pad small">{t('changes.push.noFiles')}</div>}
          {files?.map((f) => (
            <ChangedFileRow key={f.path} file={f} />
          ))}
        </div>
      </div>

      <div className="modal-actions">
        <span className="muted small">
          {count ? t('changes.push.toSend', { count }) : ''}
          {!upstream && count ? t('changes.push.willCreate') : ''}
        </span>
        <div className="spacer" />
        <button data-testid="modal-cancel" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="primary" onClick={() => void push()} disabled={!count || pushing}>
          {pushing ? 'Push…' : 'Push'}
        </button>
      </div>
    </Modal>
  )
}
