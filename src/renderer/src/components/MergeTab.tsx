import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useT } from '../i18n'
import { basename } from '../lib/util'
import { resultMessage } from '../ui/useGitAction'

interface Props {
  cwd: string
  path: string
  onClose: () => void
  onError: (msg: string) => void
  onResolved: () => void
}

type Block =
  | { kind: 'text'; text: string }
  | {
      kind: 'conflict'
      ours: string
      theirs: string
      base?: string
      oursLabel: string
      /** label on the base marker (diff3): needed to hand the file back unchanged */
      baseLabel?: string
      theirsLabel: string
    }

/**
 * Parsing a file with conflict markers. The format is the same for merge and rebase:
 * <<<<<<< our side … ||||||| base … ======= … >>>>>>> their side
 *
 * Every read of `lines[i]` is checked. That is not ceremony: a file whose last line was cut —
 * by a crashed editor, a full disk, a killed agent — ends mid-block, and the index then walks
 * off the end. Bailing out there keeps whatever was parsed so far, which is what the editor
 * can still show; inventing an empty line instead would silently rewrite the file on save.
 */
function parseConflicts(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let plain: string[] = []
  let i = 0

  const flush = (): void => {
    if (plain.length) blocks.push({ kind: 'text', text: plain.join('\n') })
    plain = []
  }

  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined) break
    if (!line.startsWith('<<<<<<<')) {
      plain.push(line)
      i++
      continue
    }
    flush()
    // a label the marker did not carry is written back into the file on save, so it is git's
    // own word for the side and never a translated one: the file must not change language
    const oursLabel = line.slice(7).trim() || 'ours'
    const ours: string[] = []
    const base: string[] = []
    const theirs: string[] = []
    let where: 'ours' | 'base' | 'theirs' = 'ours'
    let theirsLabel = 'theirs'
    let baseLabel: string | undefined
    i++
    while (i < lines.length) {
      const l = lines[i]
      if (l === undefined) break
      if (l.startsWith('|||||||')) {
        where = 'base'
        baseLabel = l.slice(7).trim()
        i++
        continue
      }
      if (l.startsWith('=======')) {
        where = 'theirs'
        i++
        continue
      }
      if (l.startsWith('>>>>>>>')) {
        theirsLabel = l.slice(7).trim() || theirsLabel
        i++
        break
      }
      ;(where === 'ours' ? ours : where === 'base' ? base : theirs).push(l)
      i++
    }
    const conflict = {
      kind: 'conflict' as const,
      ours: ours.join('\n'),
      theirs: theirs.join('\n'),
      oursLabel,
      theirsLabel,
    }
    // the base marker can sit above an empty chunk, so the marker decides whether there is a
    // base at all — not the chunk's length. Both fields are therefore added or left out
    // together, which is also the invariant the base pane and `render` below rely on.
    blocks.push(baseLabel === undefined ? conflict : { ...conflict, base: base.join('\n'), baseLabel })
  }
  flush()
  return blocks
}

/**
 * Putting the file back together. An unresolved conflict must come back exactly as it was,
 * base chunk (diff3) included: without it the common ancestor disappears from the file and
 * from the tab when it is reopened.
 */
function render(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.kind === 'text') return b.text
      // an empty base chunk is a marker with no lines under it; an extra newline would
      // change the file
      const marker = b.base === undefined ? '' : `\n||||||| ${b.baseLabel ?? 'base'}`.trimEnd()
      const base = b.base ? `${marker}\n${b.base}` : marker
      return `<<<<<<< ${b.oursLabel}\n${b.ours}${base}\n=======\n${b.theirs}\n>>>>>>> ${b.theirsLabel}`
    })
    .join('\n')
}

/** the merge editor: each conflict is settled with a button, the rest is edited by hand */
export default function MergeTab({ cwd, path, onClose, onError, onResolved }: Props): JSX.Element {
  const t = useT()
  const [blocks, setBlocks] = useState<Block[] | null>(null)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(() => {
    void window.api.files.read(path).then((res) => {
      if (!res.ok || res.content === undefined) {
        // a refusal the app decided on itself (outside the roots, too large, binary) arrives
        // as a code and is worded here; the filesystem's own message passes through as it is
        onError(resultMessage(t, res, t('changes.merge.openFailed')))
        setBlocks([])
        return
      }
      setBlocks(parseConflicts(res.content))
      setDirty(false)
    })
  }, [path, onError, t])

  useEffect(load, [load])

  const rel = path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path
  const conflicts = (blocks ?? []).filter((b) => b.kind === 'conflict').length

  const resolveBlock = (index: number, choice: 'ours' | 'theirs' | 'both'): void => {
    setBlocks((prev) => {
      if (!prev) return prev
      const b = prev[index]
      if (!b || b.kind !== 'conflict') return prev
      const text = choice === 'ours' ? b.ours : choice === 'theirs' ? b.theirs : `${b.ours}\n${b.theirs}`
      const next = [...prev]
      next[index] = { kind: 'text', text }
      return next
    })
    setDirty(true)
  }

  const save = async (markResolved: boolean): Promise<void> => {
    if (!blocks) return
    const res = await window.api.files.write(path, render(blocks))
    if (!res.ok) {
      onError(resultMessage(t, res, t('changes.merge.writeFailed')))
      return
    }
    setDirty(false)
    if (!markResolved) return
    const marked = await window.api.git.markResolved(cwd, [rel])
    if (!marked.ok) {
      onError(resultMessage(t, marked, t('changes.merge.addFailed')))
      return
    }
    onResolved()
    onClose()
  }

  const acceptWhole = async (side: 'ours' | 'theirs'): Promise<void> => {
    const res = await window.api.git.acceptSide(cwd, rel, side)
    if (!res.ok) {
      onError(resultMessage(t, res, t('changes.merge.sideFailed')))
      return
    }
    onResolved()
    onClose()
  }

  return (
    <div className="merge-tab">
      <div className="merge-head">
        <span className="file" title={path}>
          {basename(path)}
        </span>
        <span className="muted small">{t.plural('changes.merge.conflicts', conflicts)}</span>
        <div className="spacer" />
        <button onClick={() => void acceptWhole('ours')} title="git checkout --ours">
          {t('changes.takeOurs')}
        </button>
        <button onClick={() => void acceptWhole('theirs')} title="git checkout --theirs">
          {t('changes.takeTheirs')}
        </button>
        <button onClick={() => void save(false)} disabled={!dirty}>
          {t('common.save')}
        </button>
        <button className="primary" onClick={() => void save(true)} disabled={conflicts > 0}>
          {t('common.done')}
        </button>
        <button className="ghost" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
          ×
        </button>
      </div>

      <div className="merge-body">
        {blocks === null && <div className="muted pad">{t('changes.merge.reading')}</div>}
        {blocks?.map((b, i) =>
          b.kind === 'text' ? (
            <pre key={i} className="merge-text">
              {b.text}
            </pre>
          ) : (
            <div key={i} className="merge-conflict">
              <div className="merge-side ours">
                <div className="merge-side-head">
                  <span>
                    {t('changes.merge.side.ours')} · {b.oursLabel}
                  </span>
                  <button onClick={() => resolveBlock(i, 'ours')}>{t('changes.merge.take')}</button>
                </div>
                <pre>{b.ours || t('changes.merge.emptySide')}</pre>
              </div>
              {b.base !== undefined && (
                <div className="merge-side base">
                  <div className="merge-side-head">
                    <span>{t('changes.merge.side.base')}</span>
                  </div>
                  <pre>{b.base || t('changes.merge.emptySide')}</pre>
                </div>
              )}
              <div className="merge-side theirs">
                <div className="merge-side-head">
                  <span>
                    {t('changes.merge.side.theirs')} · {b.theirsLabel}
                  </span>
                  <button onClick={() => resolveBlock(i, 'theirs')}>{t('changes.merge.take')}</button>
                </div>
                <pre>{b.theirs || t('changes.merge.emptySide')}</pre>
              </div>
              <div className="merge-both">
                <button onClick={() => resolveBlock(i, 'both')}>{t('changes.merge.keepBoth')}</button>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
