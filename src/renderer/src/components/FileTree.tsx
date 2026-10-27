import type { JSX, KeyboardEvent, MouseEvent } from 'react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect } from 'react'
import type { ChangeStatus, DirEntry, OpResult, ReadDirResult, TerminalTab } from '../../../shared/types'
import { isValidName } from '../../../shared/fileNames'
import type { TKey } from '../i18n'
import { useT } from '../i18n'
import { useChangesRefresh } from '../hooks/useChangesRefresh'
import { changesInvalidated, sameJson } from '../lib/changesRefresh'
import { filterTree } from '../lib/fileFilter'
import { fileBadge, statusClass } from '../lib/fileIcons'
import { basename } from '../lib/util'
import InlineRename from '../ui/InlineRename'
import Modal from '../ui/Modal'
import { activateOnKey, useRovingFocus } from '../ui/rows'
import { appMessage, resultMessage, useGitAction } from '../ui/useGitAction'
import BranchPickModal from './BranchPickModal'
import ContextMenu, { type MenuItem } from './ContextMenu'
import FileHistoryModal from './FileHistoryModal'
import RevertConfirmModal from './RevertConfirmModal'

type DiffSpec = NonNullable<TerminalTab['diff']>

interface Props {
  root: string
  /** the session's tabs: what they are decides whether the tree also polls (see useChangesRefresh) */
  terminals: readonly TerminalTab[]
  selected: string | null
  /** git state per file: the key is the path relative to the root of the tree */
  changed: Record<string, ChangeStatus>
  onOpen: (path: string) => void
  onClose: () => void
  onOpenDiff: (spec: DiffSpec) => void
  /** a new shell tab of the session, started in this directory */
  onOpenTerminal: (dir: string) => void
  onError: (msg: string) => void
  onInfo: (msg: string | null) => void
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

/** the inline field that is open: renaming a row, or naming a new entry inside `dir` */
type Edit = { kind: 'rename'; path: string } | { kind: 'new'; dir: string; type: 'file' | 'dir' }

/** what the menu was opened on: a row, or the empty space below the rows (the root) */
type Target = { kind: 'row'; path: string; isDir: boolean } | { kind: 'space' }

/** at most one dialog over the tree */
type Dialog =
  | { kind: 'delete'; paths: string[] }
  | { kind: 'revert'; paths: string[] }
  | { kind: 'history'; path: string }
  | { kind: 'compare'; path: string }

/** Cut/Copy inside the app: paths, not file contents, and never the system clipboard */
interface Clip {
  mode: 'cut' | 'copy'
  paths: string[]
}

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

/** the parent of an absolute path; the tree only ever holds absolute ones */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

/**
 * What every row needs from the tree. A context rather than props: the rows are rendered
 * recursively, and threading a dozen values through each level buys nothing.
 */
interface TreeCtx {
  root: string
  selected: string | null
  changed: Record<string, ChangeStatus>
  /** directories with something changed inside: marked without being expanded */
  dirtyDirs: Set<string>
  /** every directory read so far, the root included, by absolute path */
  listings: ReadonlyMap<string, ReadDirResult>
  /** read a directory into `listings` */
  load: (dir: string) => void
  /** what the filter leaves on screen; null while there is no filter */
  shown: Set<string> | null
  expanded: Set<string>
  picked: Set<string>
  cut: Set<string>
  edit: Edit | null
  toggle: (path: string) => void
  /** null for a key: Enter or Space on a file row opens it like a plain click */
  onRowClick: (entry: DirEntry, e: MouseEvent | null) => void
  onRowMenu: (entry: DirEntry, e: MouseEvent) => void
  commitEdit: (name: string) => void
  cancelEdit: () => void
}

const Ctx = createContext<TreeCtx | null>(null)

function useTree(): TreeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('FileNode outside FileTree')
  return ctx
}

/** the field a new file or directory is named in, standing where the row will appear */
function NewRow({ depth, type }: { depth: number; type: 'file' | 'dir' }): JSX.Element {
  const t = useT()
  const { commitEdit, cancelEdit } = useTree()
  return (
    <div className="fnode new" style={{ paddingLeft: 6 + depth * 12 }} role="treeitem" aria-level={depth + 1}>
      <span className="caret" />
      <InlineRename
        className="fnode-rename"
        label={type === 'file' ? t('files.new.file.label') : t('files.new.dir.label')}
        value=""
        onCommit={commitEdit}
        onCancel={cancelEdit}
      />
    </div>
  )
}

function FileNode({ entry, depth }: { entry: DirEntry; depth: number }): JSX.Element {
  const t = useT()
  const tree = useTree()
  const { root, selected, changed, dirtyDirs, picked, cut, edit, load, shown } = tree
  const open = entry.isDir && tree.expanded.has(entry.path)
  const children = tree.listings.get(entry.path) ?? null

  // read on every expand; later re-reads of the open folders are the tree's refresh
  useEffect(() => {
    if (open) load(entry.path)
  }, [open, entry.path, load])

  const pad = { paddingLeft: 6 + depth * 12 }
  const rel = entry.path.startsWith(root + '/') ? entry.path.slice(root.length + 1) : entry.path
  const renaming = edit?.kind === 'rename' && edit.path === entry.path
  const isPicked = picked.has(entry.path)
  const rowClass = (isPicked ? ' picked' : '') + (cut.has(entry.path) ? ' cut' : '')
  const name = renaming ? (
    <InlineRename
      className="fnode-rename"
      label={t('files.rename.label')}
      value={entry.name}
      onCommit={tree.commitEdit}
      onCancel={tree.cancelEdit}
    />
  ) : (
    entry.name
  )

  if (!entry.isDir) {
    const badge = fileBadge(entry.name)
    return (
      <div
        className={'fnode file' + (selected === entry.path ? ' active' : '') + rowClass + statusClass(changed[rel])}
        style={pad}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isPicked || selected === entry.path}
        data-path={entry.path}
        onClick={(e) => tree.onRowClick(entry, e)}
        onContextMenu={(e) => tree.onRowMenu(entry, e)}
        onKeyDown={activateOnKey(() => tree.onRowClick(entry, null))}
        title={entry.path}
      >
        <span className="caret" />
        <span className={'badge ' + badge.cls}>{badge.text}</span>
        {name}
      </div>
    )
  }

  const creatingHere = edit?.kind === 'new' && edit.dir === entry.path
  return (
    <>
      <div
        className={'fnode dir' + (dirtyDirs.has(rel) ? ' has-changes' : '') + rowClass}
        style={pad}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={open}
        aria-selected={isPicked}
        data-path={entry.path}
        data-dir="1"
        onClick={(e) => tree.onRowClick(entry, e)}
        onContextMenu={(e) => tree.onRowMenu(entry, e)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            tree.toggle(entry.path)
          } else if (e.key === 'ArrowRight' && !open) {
            e.preventDefault()
            tree.toggle(entry.path)
          } else if (e.key === 'ArrowLeft' && open) {
            e.preventDefault()
            tree.toggle(entry.path)
          }
        }}
        title={entry.path}
      >
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="badge dir">
          <FolderIcon />
        </span>
        {name}
      </div>
      {open && creatingHere && <NewRow depth={depth + 1} type={edit.type} />}
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
        children.entries
          .filter((c) => !shown || shown.has(c.path))
          .map((c) => <FileNode key={c.path} entry={c} depth={depth + 1} />)}
    </>
  )
}

export default function FileTree({
  root,
  terminals,
  selected,
  changed,
  onOpen,
  onClose,
  onOpenDiff,
  onOpenTerminal,
  onError,
  onInfo,
}: Props): JSX.Element {
  const t = useT()
  /**
   * Every directory read so far, the root included. One map in the tree rather than a state per
   * folder: a refresh re-reads all open folders at once, and the filter searches all of them.
   */
  const [listings, setListings] = useState<ReadonlyMap<string, ReadDirResult>>(() => new Map())
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  /** the rows Ctrl/Shift+click gathered; Delete, Cut, Copy and the Git items act on all of them */
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  /** where a Shift+click range starts */
  const [anchor, setAnchor] = useState<string | null>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [clip, setClip] = useState<Clip | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; target: Target } | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)

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

  // a file operation of our own: this tree and the changes panel both re-read off the invalidation
  const afterOperation = useCallback(() => changesInvalidated(root), [root])
  const { run } = useGitAction({ onError, onInfo, onRefresh: afterOperation })

  // cleared while rendering rather than from the effect below: an effect runs after the paint,
  // so the previous session's files stood under the new session's root for a frame. What was
  // open, picked or being edited belongs to the old root too; the in-app clipboard does not —
  // pasting into another session's tree is a fair thing to want
  const [readFor, setReadFor] = useState(root)
  if (readFor !== root) {
    setReadFor(root)
    setListings(new Map())
    setExpanded(new Set())
    setPicked(new Set())
    setAnchor(null)
    setEdit(null)
    setMenu(null)
    setDialog(null)
  }

  /** the root of the moment: the answer for the previous root may arrive after the new one */
  const rootNow = useRef(root)
  useEffect(() => {
    rootNow.current = root
  }, [root])

  /** an unchanged directory keeps its object, so an idle refresh re-renders nothing */
  const read = useCallback(
    async (dirs: readonly string[]): Promise<void> => {
      const results = await Promise.all(dirs.map((d) => window.api.files.readDir(d)))
      if (rootNow.current !== root) return
      setListings((prev) => {
        let next: Map<string, ReadDirResult> | null = null
        dirs.forEach((d, i) => {
          const res = results[i]
          if (res === undefined || sameJson(prev.get(d), res)) return
          next ??= new Map(prev)
          next.set(d, res)
        })
        return next ?? prev
      })
    },
    [root],
  )
  const load = useCallback((dir: string) => void read([dir]), [read])

  useEffect(() => {
    void read([root])
  }, [read, root])

  /**
   * ↻, and every event the changes panel re-reads on — a turn end, focus, the app's own writes:
   * a file an agent or a terminal created shows up without ↻. Open folders are re-read too.
   */
  const refresh = useCallback(() => read([root, ...expanded]), [read, root, expanded])
  useChangesRefresh({ cwd: root, terminals, enabled: true, refresh })
  const reload = (): void => void refresh()

  /** null while the root is still being read: an empty list and "not read yet" are different */
  const result = listings.get(root) ?? null
  const shown = useMemo(
    () =>
      filterTree(
        result?.ok ? result.entries : [],
        (dir) => {
          const res = expanded.has(dir) ? listings.get(dir) : undefined
          return res?.ok ? res.entries : undefined
        },
        filter,
      ),
    [result, listings, expanded, filter],
  )

  const rel = useCallback(
    (path: string): string => (path.startsWith(root + '/') ? path.slice(root.length + 1) : path),
    [root],
  )

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }, [])

  /** what an action applies to: the picked rows when the row is one of them, else the row alone */
  const scopeOf = useCallback((path: string): string[] => (picked.has(path) ? [...picked] : [path]), [picked])

  const onRowClick = useCallback(
    (entry: DirEntry, e: MouseEvent | null) => {
      if (e && (e.ctrlKey || e.metaKey)) {
        setPicked((prev) => {
          const next = new Set(prev)
          if (!next.delete(entry.path)) next.add(entry.path)
          return next
        })
        setAnchor(entry.path)
        return
      }
      if (e?.shiftKey && anchor) {
        // the range is the rows as they stand on screen, expanded folders included
        const rows = [...(treeRef.current?.querySelectorAll<HTMLElement>('.fnode[data-path]') ?? [])]
          .map((el) => el.dataset.path)
          .filter((p): p is string => p !== undefined)
        const a = rows.indexOf(anchor)
        const b = rows.indexOf(entry.path)
        if (a !== -1 && b !== -1) {
          setPicked(new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1)))
          return
        }
      }
      setPicked(new Set([entry.path]))
      setAnchor(entry.path)
      if (entry.isDir) toggle(entry.path)
      else onOpen(entry.path)
    },
    [anchor, onOpen, toggle],
  )

  /** a row's menu: right click, Shift+F10 or the menu key; a row outside the selection replaces it */
  const openRowMenu = useCallback(
    (path: string, isDir: boolean, x: number, y: number) => {
      if (!picked.has(path)) {
        setPicked(new Set([path]))
        setAnchor(path)
      }
      setMenu({ x, y, target: { kind: 'row', path, isDir } })
    },
    [picked],
  )

  const onRowMenu = useCallback(
    (entry: DirEntry, e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // a menu key on the focused row arrives as a contextmenu at 0,0: put it under the row
      if (e.clientX === 0 && e.clientY === 0) {
        const r = e.currentTarget.getBoundingClientRect()
        openRowMenu(entry.path, entry.isDir, r.left + 16, r.bottom)
      } else openRowMenu(entry.path, entry.isDir, e.clientX, e.clientY)
    },
    [openRowMenu],
  )

  const cancelEdit = useCallback(() => setEdit(null), [])

  const commitEdit = useCallback(
    (name: string) => {
      const current = edit
      setEdit(null)
      if (!current) return
      if (!isValidName(name)) {
        onError(appMessage(t, 'file-name-invalid', { name }))
        return
      }
      if (current.kind === 'rename') {
        void run(t('files.run.rename'), () => window.api.files.rename(current.path, name))
        return
      }
      let created: string | undefined
      void run(t('files.run.create'), async () => {
        const res = await window.api.files.create(current.dir, name, current.type)
        created = res.path
        return res
      }).then(() => {
        if (created && current.type === 'file') onOpen(created)
      })
    },
    [edit, onError, onOpen, run, t],
  )

  const startNew = (dir: string, type: 'file' | 'dir'): void => {
    if (dir !== root) setExpanded((prev) => new Set(prev).add(dir))
    setEdit({ kind: 'new', dir, type })
  }

  const paste = (dir: string): void => {
    if (!clip) return
    const { mode, paths } = clip
    void run(t('files.run.paste'), () =>
      mode === 'cut' ? window.api.files.move(paths, dir) : window.api.files.copy(paths, dir),
    ).then((res) => {
      // a cut is used up by its paste; a copy can be pasted again
      if (res?.ok && mode === 'cut') setClip(null)
    })
  }

  /** a one-off call whose failure is worth a toast and whose success needs no status line */
  const report = (call: Promise<{ ok: boolean }>): void => {
    void call.then((res) => {
      if (!res.ok) onError(resultMessage(t, res, t('git.run.failed', { label: t('files.run.open') })))
    })
  }

  /** through the action runner for its status line, which also takes the message down again */
  const copyText = (text: string): void => {
    void run(
      t('files.menu.copyPath'),
      async () => {
        await window.api.clipboard.write(text)
        return { ok: true }
      },
      { done: () => t('files.copyPath.done') },
    )
  }

  const diffOf = (path: string, extra: Pick<DiffSpec, 'mode'> & Partial<Pick<DiffSpec, 'baseRef'>>): DiffSpec => {
    const status = changed[rel(path)] ?? 'modified'
    return {
      cwd: root,
      path: rel(path),
      status,
      untracked: extra.mode === 'working' && status === 'untracked',
      ...extra,
    }
  }

  const ignore = (paths: string[]): void => {
    void run(t('files.run.ignore'), async () => {
      let last: OpResult = { ok: true }
      for (const p of paths) {
        last = await window.api.git.addToGitignore(p)
        if (!last.ok) return last
      }
      return last
    })
  }

  const itemsFor = (target: Target): MenuItem[] => {
    const dir = target.kind === 'space' ? root : target.isDir ? target.path : dirOf(target.path)
    const newItems: MenuItem = {
      label: t('files.menu.new'),
      items: [
        { label: t('files.menu.new.file'), onPick: () => startNew(dir, 'file') },
        { label: t('files.menu.new.dir'), onPick: () => startNew(dir, 'dir') },
      ],
    }
    const pasteItem: MenuItem = { label: t('files.menu.paste'), disabled: !clip, onPick: () => paste(dir) }
    if (target.kind === 'space') {
      return [
        newItems,
        { ...pasteItem, sep: true },
        {
          label: t('files.menu.copyPath'),
          sep: true,
          items: [{ label: t('files.menu.copyPath.absolute'), onPick: () => copyText(root) }],
        },
        {
          label: t('files.menu.openIn'),
          items: [
            { label: t('files.menu.openIn.fileManager'), onPick: () => report(window.api.files.reveal(root)) },
            { label: t('files.menu.openIn.terminal'), onPick: () => onOpenTerminal(root) },
          ],
        },
      ]
    }

    const { path, isDir } = target
    const paths = scopeOf(path)
    const single = paths.length === 1
    return [
      newItems,
      { label: t('files.menu.cut'), sep: true, onPick: () => setClip({ mode: 'cut', paths }) },
      { label: t('files.menu.copy'), onPick: () => setClip({ mode: 'copy', paths }) },
      pasteItem,
      {
        label: t('files.menu.duplicate'),
        disabled: !single,
        onPick: () => void run(t('files.run.duplicate'), () => window.api.files.copy([path], dirOf(path))),
      },
      {
        label: t('files.menu.copyPath'),
        sep: true,
        items: [
          { label: t('files.menu.copyPath.absolute'), onPick: () => copyText(paths.join('\n')) },
          { label: t('files.menu.copyPath.relative'), onPick: () => copyText(paths.map(rel).join('\n')) },
          { label: t('files.menu.copyPath.name'), onPick: () => copyText(paths.map((p) => basename(p)).join('\n')) },
        ],
      },
      {
        label: t('files.menu.rename'),
        hint: t('files.key.rename'),
        disabled: !single,
        onPick: () => setEdit({ kind: 'rename', path }),
      },
      {
        label: t('files.menu.delete'),
        hint: t('files.key.delete'),
        danger: true,
        onPick: () => setDialog({ kind: 'delete', paths }),
      },
      {
        label: t('files.menu.openIn'),
        sep: true,
        items: [
          { label: t('files.menu.openIn.fileManager'), onPick: () => report(window.api.files.reveal(path)) },
          { label: t('files.menu.openIn.terminal'), onPick: () => onOpenTerminal(isDir ? path : dirOf(path)) },
          { label: t('files.menu.openIn.default'), onPick: () => report(window.api.files.openDefault(path)) },
        ],
      },
      {
        label: t('files.menu.git'),
        items: [
          {
            label: t('files.menu.git.diff'),
            disabled: !single || isDir,
            onPick: () => onOpenDiff(diffOf(path, { mode: 'working' })),
          },
          {
            label: t('files.menu.git.compare'),
            disabled: !single || isDir,
            onPick: () => setDialog({ kind: 'compare', path }),
          },
          {
            label: t('files.menu.git.history'),
            disabled: !single || isDir,
            onPick: () => setDialog({ kind: 'history', path }),
          },
          { label: t('changes.revert'), onPick: () => setDialog({ kind: 'revert', paths }) },
          { label: t('files.menu.git.ignore'), sep: true, onPick: () => ignore(paths) },
        ],
      },
    ]
  }

  /** F2, Del, Shift+F10 and the menu key, on the focused row; arrows are the roving focus's */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    onTreeKeys(e)
    if (e.defaultPrevented || !(e.target instanceof HTMLElement) || e.target instanceof HTMLInputElement) return
    const row = e.target.closest<HTMLElement>('.fnode[data-path]')
    const path = row?.dataset.path
    if (!row || !path) return
    if (e.key === 'F2') {
      e.preventDefault()
      setEdit({ kind: 'rename', path })
    } else if (e.key === 'Delete') {
      e.preventDefault()
      setDialog({ kind: 'delete', paths: scopeOf(path) })
    } else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault()
      const r = row.getBoundingClientRect()
      openRowMenu(path, row.dataset.dir === '1', r.left + 16, r.bottom)
    }
  }

  const trash = (paths: string[]): void => {
    setDialog(null)
    void run(t('files.run.delete'), () => window.api.files.trash(paths)).then((res) => {
      if (res?.ok) setPicked(new Set())
    })
  }

  const revert = (paths: string[]): void => {
    setDialog(null)
    const count = paths.length
    void run(
      t('changes.revert.run'),
      () =>
        window.api.git.revertFiles(
          root,
          paths.map((p) => rel(p)),
        ),
      { done: () => t('changes.revert.done', { count }) },
    )
  }

  const ctx: TreeCtx = {
    root,
    selected,
    changed,
    dirtyDirs,
    listings,
    load,
    shown,
    expanded,
    picked,
    cut: new Set(clip?.mode === 'cut' ? clip.paths : []),
    edit,
    toggle,
    onRowClick,
    onRowMenu,
    commitEdit,
    cancelEdit,
  }

  const list: DirEntry[] = result?.ok ? result.entries : []
  const visible = shown ? list.filter((e) => shown.has(e.path)) : list

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
      <Ctx.Provider value={ctx}>
        <div
          className="files-tree"
          ref={treeRef}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => {
            // a row's own menu stops the event; what reaches here is the space below the rows
            e.preventDefault()
            setPicked(new Set())
            setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'space' } })
          }}
          role="tree"
          aria-multiselectable="true"
          aria-label={t('files.tree.aria')}
        >
          {result === null && <div className="muted pad small">{t('files.loading')}</div>}
          {result?.ok === false && (
            <div className="muted pad small" title={root}>
              {t(FAILED[result.code])}
            </div>
          )}
          {edit?.kind === 'new' && edit.dir === root && <NewRow depth={0} type={edit.type} />}
          {result?.ok && visible.length === 0 && (
            <div className="muted pad small">{filter.trim() ? t('files.noMatches') : t('files.empty')}</div>
          )}
          {visible.map((e) => (
            <FileNode key={e.path} entry={e} depth={0} />
          ))}
        </div>
      </Ctx.Provider>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={itemsFor(menu.target)} onClose={() => setMenu(null)} />}

      {dialog?.kind === 'delete' && (
        <Modal title={t.plural('files.delete.confirm', dialog.paths.length)} onClose={() => setDialog(null)}>
          <p className="hint">{t('files.delete.warn')}</p>
          <ul className="revert-list">
            {dialog.paths.slice(0, 12).map((p) => (
              <li key={p}>{rel(p)}</li>
            ))}
            {dialog.paths.length > 12 && (
              <li className="muted">{t('files.delete.more', { count: dialog.paths.length - 12 })}</li>
            )}
          </ul>
          <div className="modal-actions">
            <button data-testid="modal-cancel" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </button>
            <button className="primary danger" onClick={() => trash(dialog.paths)}>
              {t('common.delete')}
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'revert' && (
        <RevertConfirmModal
          paths={dialog.paths.map((p) => rel(p))}
          onCancel={() => setDialog(null)}
          onConfirm={() => revert(dialog.paths)}
        />
      )}
      {dialog?.kind === 'history' && (
        <FileHistoryModal
          cwd={root}
          path={rel(dialog.path)}
          onClose={() => setDialog(null)}
          onPick={(hash) => {
            setDialog(null)
            onOpenDiff(diffOf(dialog.path, { mode: 'base', baseRef: hash }))
          }}
        />
      )}
      {dialog?.kind === 'compare' && (
        <BranchPickModal
          cwd={root}
          path={rel(dialog.path)}
          onClose={() => setDialog(null)}
          onPick={(ref) => {
            setDialog(null)
            onOpenDiff(diffOf(dialog.path, { mode: 'base', baseRef: ref }))
          }}
        />
      )}
    </aside>
  )
}
