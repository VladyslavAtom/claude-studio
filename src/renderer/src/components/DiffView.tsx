import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangedFile } from '../../../shared/types'
import { useT } from '../i18n'
import { parseUnifiedDiff } from '../lib/diff'
import { highlightByLine, type Chunk } from '../lib/highlight'
import { join } from '../lib/util'

interface Props {
  file: ChangedFile
  diff: string
  cwd: string
  /** revision of the "before" side: HEAD or the session's base */
  oldRef?: string
  onClose: () => void
}

export default function DiffView({ file, diff, cwd, oldRef, onClose }: Props): JSX.Element {
  const t = useT()
  const [wrap, setWrap] = useState(false)
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff])

  /**
   * Highlighting is computed over whole file versions — "before" from git, "after" from disk —
   * and the diff lines then reference them by their own numbers. GitHub and Monaco do the same:
   * the diff text is not code itself, and from a single hunk the parser cannot see the start of
   * the file and confuses multi-line strings, comments and nesting.
   */
  const [sides, setSides] = useState<{ before: Chunk[][] | null; after: Chunk[][] | null }>({
    before: null,
    after: null,
  })

  // the diff is re-read every 5 seconds; if neither side's content changed, do not re-parse
  const lastTexts = useRef<{ before: string | null; after: string | null }>({ before: null, after: null })

  useEffect(() => {
    let alive = true
    void (async () => {
      const [beforeText, afterFile] = await Promise.all([
        oldRef ? window.api.git.fileAtRef(cwd, oldRef, file.oldPath ?? file.path) : Promise.resolve(null),
        window.api.files.read(join(cwd, file.path)),
      ])
      if (!alive) return
      const afterText = afterFile.ok && afterFile.content ? afterFile.content : null
      if (lastTexts.current.before === beforeText && lastTexts.current.after === afterText) return
      lastTexts.current = { before: beforeText, after: afterText }
      setSides({
        before: beforeText ? highlightByLine(beforeText, file.oldPath ?? file.path) : null,
        after: afterText ? highlightByLine(afterText, file.path) : null,
      })
    })()
    return () => {
      alive = false
    }
  }, [cwd, oldRef, file.path, file.oldPath, diff])

  /** a diff line knows its number in both versions — that is how the ready tokens are picked */
  const painted = useMemo<(Chunk[] | null)[]>(
    () =>
      parsed.lines.map((l) => {
        if (l.type === 'del') return l.oldNo ? (sides.before?.[l.oldNo - 1] ?? null) : null
        if (l.type === 'add' || l.type === 'context') return l.newNo ? (sides.after?.[l.newNo - 1] ?? null) : null
        return null
      }),
    [parsed, sides],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="diff-overlay">
      <div className="diff-head">
        <span className={'st ' + file.status}>{file.status}</span>
        <span className="file" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <span className="stat add">+{parsed.stats.additions}</span>
        <span className="stat del">−{parsed.stats.deletions}</span>
        <div className="spacer" />
        <button className="ghost" onClick={() => setWrap((w) => !w)} title={t('editor.diff.wrap')}>
          {wrap ? t('editor.diff.wrap.on') : t('editor.diff.wrap.off')}
        </button>
        <button
          className="ghost"
          title={t('editor.diff.external')}
          onClick={() => void window.api.system.openPath(join(cwd, file.path))}
        >
          ↗
        </button>
        <button className="ghost" onClick={onClose} title={t('editor.close')} aria-label={t('editor.diff.close.aria')}>
          ×
        </button>
      </div>

      <div className={'diff-body' + (wrap ? ' wrap' : '')}>
        {parsed.lines.length === 0 && <div className="muted pad">{t('editor.diff.empty')}</div>}
        <table className="diff-table">
          <tbody>
            {parsed.lines.map((l, i) => {
              const chunks = painted[i]
              return (
                <tr key={i} className={'dl ' + l.type}>
                  <td className="no">{l.oldNo ?? ''}</td>
                  <td className="no">{l.newNo ?? ''}</td>
                  <td className="sign">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}</td>
                  <td className="code">
                    {chunks && chunks.length
                      ? chunks.map((c, j) => (
                          <span key={j} className={c.cls ?? undefined}>
                            {c.text}
                          </span>
                        ))
                      : l.text || ' '}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
