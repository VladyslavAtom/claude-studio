import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeStatus, DirEntry, ReadDirResult } from '../../../shared/types'
import type { TKey } from '../i18n'
import { useT } from '../i18n'
import { fileBadge, statusClass } from '../lib/fileIcons'
import { activateOnKey, useRovingFocus } from '../ui/rows'

interface Props {
  root: string
  selected: string | null
  /** git state per file: the key is the path relative to the root of the tree */
  changed: Record<string, ChangeStatus>
  onOpen: (path: string) => void
  onClose: () => void
}

/**
 * Why a directory has no rows. main answers with a code and leaves the wording to the catalogue;
 * the point of the code is that `files.empty` must not be what a locked, deleted or unreadable
 * directory says — those three used to render identically, so a permissions problem looked like
 * an empty folder and nobody went looking for it.
 */
const FAILED = {
  denied: 'files.error.denied',
  missing: 'files.error.missing',
  'not-a-dir': 'files.error.notADir',
  'outside-roots': 'files.error.outsideRoots',
  failed: 'files.error.failed',
} as const satisfies Record<Extract<ReadDirResult, { ok: false }>['code'], TKey>

/** folder: the same icon in every state — the caret is what shows it is open */
function FolderIcon(): JSX.Element {
  return (
    <svg className="folder" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.5 12.2V4a1 1 0 0 1 1-1h3.2l1.4 1.6h5.4a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1z"
        fill="currentColor"
      />
    </svg>
  )
}

interface NodeProps {
  entry: DirEntry
  depth: number
  selected: string | null
  root: string
  changed: Record<string, ChangeStatus>
  /** directories with something changed inside: marked without being expanded */
  dirtyDirs: Set<string>
  /** refresh counter: bumping it re-reads the subdirectories that are open, too */
  version: number
  onOpen: (path: string) => void
}

function FileNode({ entry, depth, selected, root, changed, dirtyDirs, version, onOpen }: NodeProps): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<ReadDirResult | null>(null)

  // re-read on every expand and on every refresh of the panel: a file the agent created inside
  // an already open folder would otherwise never show up
  useEffect(() => {
    if (!open) return
    let alive = true
    void window.api.files.readDir(entry.path).then((res) => {
      if (alive) setChildren(res)
    })
    return () => {
      alive = false
    }
  }, [open, entry.path, version])

  const pad = { paddingLeft: 6 + depth * 12 }
  const rel = entry.path.startsWith(root + '/') ? entry.path.slice(root.length + 1) : entry.path

  if (!entry.isDir) {
    const badge = fileBadge(entry.name)
    return (
      <div
        className={'fnode file' + (selected === entry.path ? ' active' : '') + statusClass(changed[rel])}
        style={pad}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selected === entry.path}
        onClick={() => onOpen(entry.path)}
        onKeyDown={activateOnKey(() => onOpen(entry.path))}
        title={entry.path}
      >
        <span className="caret" />
        <span className={'badge ' + badge.cls}>{badge.text}</span>
        {entry.name}
      </div>
    )
  }

  return (
    <>
      <div
        className={'fnode dir' + (dirtyDirs.has(rel) ? ' has-changes' : '')}
        style={pad}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((v) => !v)
          } else if (e.key === 'ArrowRight' && !open) {
            e.preventDefault()
            setOpen(true)
          } else if (e.key === 'ArrowLeft' && open) {
            e.preventDefault()
            setOpen(false)
          }
        }}
        title={entry.path}
      >
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="badge dir">
          <FolderIcon />
        </span>
        {entry.name}
      </div>
      {open && children?.ok === false && (
        <div
          className="muted pad small"
          style={{ paddingLeft: 6 + (depth + 1) * 12 }}
          role="treeitem"
          aria-level={depth + 2}
        >
          {t(FAILED[children.code])}
        </div>
      )}
      {open &&
        children?.ok &&
        children.entries.map((c) => (
          <FileNode
            key={c.path}
            entry={c}
            depth={depth + 1}
            selected={selected}
            root={root}
            changed={changed}
            dirtyDirs={dirtyDirs}
            version={version}
            onOpen={onOpen}
          />
        ))}
    </>
  )
}

export default function FileTree({ root, selected, changed, onOpen, onClose }: Props): JSX.Element {
  const t = useT()
  /** null while the root is still being read: an empty list and "not read yet" are different */
  const [result, setResult] = useState<ReadDirResult | null>(null)
  const [filter, setFilter] = useState('')
  /** ↻ and a change of root: subdirectories are re-read off this counter */
  const [version, setVersion] = useState(0)

  /** every directory on the way to a changed file: a collapsed folder must light up too */
  const dirtyDirs = useMemo(() => {
    const dirs = new Set<string>()
    for (const path of Object.keys(changed)) {
      const parts = path.split('/')
      parts.pop()
      let prefix = ''
      for (const part of parts) {
        prefix = prefix ? `${prefix}/${part}` : part
        dirs.add(prefix)
      }
    }
    return dirs
  }, [changed])

  const treeRef = useRef<HTMLDivElement>(null)
  const onTreeKeys = useRovingFocus(treeRef, '.fnode')

  const reload = useCallback(() => setVersion((v) => v + 1), [])

  // cleared while rendering rather than from the effect below: an effect runs after the paint,
  // so the previous session's files stood under the new session's root for a frame
  const [readFor, setReadFor] = useState(root)
  if (readFor !== root) {
    setReadFor(root)
    setResult(null)
  }

  useEffect(() => {
    // the answer for the previous root arrives after the new one: only apply our own
    let alive = true
    void window.api.files.readDir(root).then((res) => {
      if (alive) setResult(res)
    })
    return () => {
      alive = false
    }
  }, [root, version])

  const list: DirEntry[] = result?.ok ? result.entries : []
  const visible = filter.trim() ? list.filter((e) => e.name.toLowerCase().includes(filter.trim().toLowerCase())) : list

  return (
    <aside className="files">
      <div className="files-head">
        <input
          aria-label={t('files.filter.aria')}
          placeholder={t('files.filter')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="ghost" title={t('files.refresh')} aria-label={t('files.refresh.aria')} onClick={reload}>
          ↻
        </button>
        <button className="ghost" title={t('files.hide')} aria-label={t('files.hide')} onClick={onClose}>
          ×
        </button>
      </div>
      <div className="files-tree" ref={treeRef} onKeyDown={onTreeKeys} role="tree" aria-label={t('files.tree.aria')}>
        {result === null && <div className="muted pad small">{t('files.loading')}</div>}
        {result?.ok === false && (
          <div className="muted pad small" title={root}>
            {t(FAILED[result.code])}
          </div>
        )}
        {result?.ok && visible.length === 0 && (
          <div className="muted pad small">{filter.trim() ? t('files.noMatches') : t('files.empty')}</div>
        )}
        {visible.map((e) => (
          <FileNode
            key={e.path}
            entry={e}
            depth={0}
            selected={selected}
            root={root}
            changed={changed}
            dirtyDirs={dirtyDirs}
            version={version}
            onOpen={onOpen}
          />
        ))}
      </div>
    </aside>
  )
}
