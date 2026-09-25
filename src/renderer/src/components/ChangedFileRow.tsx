import type { JSX, ReactNode } from 'react'
import type { ChangeStatus } from '../../../shared/types'
import { useT } from '../i18n'
import { STATUS_LABEL, statusTitle } from '../lib/changeStatus'
import { splitPath } from '../lib/util'
import { activateOnKey } from '../ui/rows'

interface Props {
  file: { path: string; oldPath?: string | undefined; status: ChangeStatus }
  /** `undefined` is spelled out: callers pass `active ? 'active' : undefined` */
  className?: string | undefined
  /** the row opens something: it then behaves as a button for the keyboard too */
  onActivate?: () => void
  /** marks the row as the one currently open */
  active?: boolean
  /** goes before the status letter — the commit checkbox */
  lead?: ReactNode
  /** goes after the path — «resolve» and the staged dot */
  trail?: ReactNode
}

/**
 * One changed file: the status letter and the path, with its directory dimmed. The same row
 * in the changes panel and in the push window — the markup and the letter map used to be
 * copied into both.
 */
export default function ChangedFileRow({ file, className, onActivate, active, lead, trail }: Props): JSX.Element {
  const t = useT()
  const [dir, name] = splitPath(file.path)
  const title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path

  return (
    <div
      className={className ? 'change ' + className : 'change'}
      title={title}
      onClick={onActivate}
      onKeyDown={onActivate ? activateOnKey(onActivate) : undefined}
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? -1 : undefined}
      aria-label={onActivate ? `${statusTitle(t, file.status)}: ${title}` : undefined}
      aria-current={onActivate && active ? true : undefined}
    >
      {lead}
      <span className={'st ' + file.status} aria-hidden="true">
        {STATUS_LABEL[file.status]}
      </span>
      <span className="path">
        <span className="dir">{dir}</span>
        <span className="name">{name}</span>
      </span>
      {trail}
    </div>
  )
}
