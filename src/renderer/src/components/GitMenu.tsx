import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BranchInfo, Project, PullStrategy } from '../../../shared/types'
import { useT } from '../i18n'
import { formatTime } from '../lib/util'
import Modal from '../ui/Modal'
import { Menu, MenuItem, MenuSep } from '../ui/Menu'
import { useMenu } from '../ui/useMenu'
import type { GitActionResult } from '../ui/useGitAction'
import { useGitAction } from '../ui/useGitAction'
import PullChoiceModal from './PullChoiceModal'
import RenameBranchModal from './RenameBranchModal'

interface Props {
  project: Project
  onError: (msg: string) => void
  onInfo: (msg: string | null) => void
  /** «New session in a worktree from …» opens session creation with that branch as the base */
  onNewWorktree: (baseRef: string) => void
  /** how the project is updated; 'ask' means ask every time */
  pullStrategy: PullStrategy
  onPullStrategy: (strategy: PullStrategy) => void
}

interface Action {
  id: string
  label: string
  hint?: string
  /** the action opens a dialog of its own: fold the menu at once and report no «done» */
  asks?: boolean
  run: () => Promise<GitActionResult>
}

/**
 * Branch menu: search across branches and actions, groups, and a submenu per branch.
 *
 * The three actions at the top are the same operations the session branch menu offers, so they
 * take the same keys in the same order — `git.pull`, `git.push`, `git.createPr`, and further down
 * `git.mergeInto`, `git.rebaseOnto`, `git.rename`.
 */
export default function GitMenu({
  project,
  onError,
  onInfo,
  onNewWorktree,
  pullStrategy,
  onPullStrategy,
}: Props): JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [filter, setFilter] = useState('')
  /** branch name plus the row's coordinates: the submenu is placed over the scrolling list,
      which would otherwise clip it */
  const [submenu, setSubmenu] = useState<{ name: string; top: number; left: number } | null>(null)
  const [asking, setAsking] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  /** the first, force-less delete was refused over unmerged commits — offer -D */
  const [deleteUnmerged, setDeleteUnmerged] = useState(false)

  const closeAll = useCallback((): void => {
    setOpen(false)
    setSubmenu(null)
  }, [])

  const popup = useMenu(open, closeAll, { haspopup: 'dialog', autoFocus: false })
  const branchMenu = useMenu(submenu !== null, () => setSubmenu(null))
  // bound once: reading a member off a handle that carries refs counts as touching a ref
  // during render, whether or not `.current` is what is being read
  const { rootRef: popupRootRef, triggerProps: popupTrigger } = popup
  const { rootRef: branchRootRef } = branchMenu

  const current = branches.find((b) => b.current)?.name ?? null

  const load = useCallback(() => {
    void window.api.git.branchInfo(project.path).then(setBranches)
  }, [project.path])

  useEffect(load, [load])

  // the branch list may have gone stale while the menu was shut
  useEffect(() => {
    if (open) load()
  }, [open, load])

  const { busy, run } = useGitAction({ onError, onInfo, onRefresh: load })

  /** run a branch action and, if git was happy with it, fold the menus away */
  const runAndClose = async (label: string, fn: () => Promise<GitActionResult>): Promise<void> => {
    const res = await run(label, fn)
    if (res?.ok) closeAll()
  }

  /** starting an action: the ones that ask how to do it open their own dialog first */
  const start = (a: Action): void => {
    if (!a.asks) {
      void runAndClose(a.label, a.run)
      return
    }
    setOpen(false)
    setAsking(true)
  }

  /**
   * Deleting a branch: without force first (git branch -d). A refusal over unmerged commits
   * is not an error — we ask again and only then go for -D.
   */
  const doDelete = async (name: string, force: boolean): Promise<void> => {
    let askAgain = false
    const res = await run(
      t('git.run.deleteBranch', { branch: name }),
      () => window.api.git.deleteBranch(project.path, name, force),
      {
        done: () => t('git.run.branchDeleted', { branch: name }),
        onFail: (error) => {
          if (force || !/not fully merged/i.test(error)) return false
          askAgain = true
          setDeleteUnmerged(true)
          return true
        },
      },
    )
    if (askAgain) return
    setDeleting(null)
    setDeleteUnmerged(false)
    if (res?.ok) closeAll()
  }

  const actions: Action[] = useMemo(
    () => [
      {
        id: 'pull',
        label: t('git.pull', { what: t('git.what.project') }),
        hint:
          pullStrategy === 'ask'
            ? t('git.pull.hint.ask')
            : `pull --${pullStrategy === 'merge' ? 'no-rebase' : 'rebase'}`,
        asks: pullStrategy === 'ask',
        run: () => window.api.git.pull(project.path, pullStrategy === 'ask' ? 'rebase' : pullStrategy),
      },
      {
        id: 'push',
        label: t('git.push'),
        hint: current ?? t('git.push.hint.detached'),
        run: async () => {
          // detached HEAD: there is no branch name to push, and `git push -u origin ''`
          // answers with a complaint about the refspec
          if (!current) {
            return { ok: false, error: t('git.push.detachedHead') }
          }
          const hasUpstream = await window.api.git.hasUpstream(project.path)
          return window.api.git.push(project.path, current, !hasUpstream)
        },
      },
      {
        id: 'pr',
        label: t('git.createPr'),
        hint: 'gh',
        run: async () => {
          // base for the PR: the remote HEAD, with the current branch as a fallback
          const base = (await window.api.git.defaultBranch(project.path)) || current || 'main'
          return window.api.git.createPullRequest(project.path, '', '', base)
        },
      },
    ],
    [project.path, current, pullStrategy, t],
  )

  if (!project.isGit) return null

  const q = filter.trim().toLowerCase()
  const matched = branches
    .filter((b) => !b.remote)
    .filter((b) => b.name.toLowerCase().includes(q) || b.subject.toLowerCase().includes(q))
  const local = matched
  const recent = local.filter((b) => !b.current).slice(0, 5)
  const visibleActions = actions.filter((a) => !q || a.label.toLowerCase().includes(q))

  /** the submenu is placed over its row: inside the scrolling list it would be clipped */
  const openSubmenu = (e: { currentTarget: HTMLElement }, name: string, height: number): void => {
    if (submenu?.name === name) {
      setSubmenu(null)
      return
    }
    const row = e.currentTarget.closest('.git-branch')
    if (!row) return
    const r = row.getBoundingClientRect()
    setSubmenu({ name, top: Math.min(r.top, window.innerHeight - height), left: r.left - 306 })
  }

  const branchRow = (b: BranchInfo): JSX.Element => {
    const open = submenu?.name === b.name
    return (
      <div key={b.name} className={'git-branch' + (open ? ' open' : '')} ref={open ? branchRootRef : undefined}>
        <button
          className="pick"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => openSubmenu(e, b.name, 300)}
          title={b.subject}
          disabled={busy}
        >
          <span className="mark">{b.current ? '●' : ''}</span>
          <span className="name">{b.name}</span>
          <span className="muted small">{b.updatedAt ? formatTime(b.updatedAt) : ''}</span>
        </button>
        <button
          className="more"
          title={t('git.branchActions')}
          aria-label={t('git.branchActions.aria', { branch: b.name })}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => openSubmenu(e, b.name, 260)}
        >
          ›
        </button>

        {open && submenu && (
          <Menu
            menu={branchMenu}
            className="git-submenu"
            label={t('git.branchActions.aria', { branch: b.name })}
            style={{ top: submenu.top, left: submenu.left }}
          >
            <MenuItem
              disabled={b.current}
              onClick={() =>
                void runAndClose(t('git.run.checkout', { branch: b.name }), () =>
                  window.api.git.checkout(project.path, b.name),
                )
              }
            >
              {b.current ? t('git.checkout.current', { branch: b.name }) : t('git.checkout', { branch: b.name })}
            </MenuItem>
            <MenuSep />
            <MenuItem onClick={() => onNewWorktree(b.name)}>{t('git.newWorktreeSession', { branch: b.name })}</MenuItem>
            <MenuItem
              onClick={() =>
                void runAndClose(t('git.run.branchFrom', { branch: b.name }), () =>
                  window.api.git.createBranch(project.path, `${b.name}-copy`, b.name),
                )
              }
            >
              {t('git.newBranchFrom', { branch: b.name })}
            </MenuItem>
            <MenuSep />
            <MenuItem
              disabled={b.current}
              onClick={() =>
                void runAndClose(t('git.run.merge', { branch: b.name }), () =>
                  window.api.git.merge(project.path, b.name),
                )
              }
            >
              {t('git.mergeInto', { branch: b.name })}
            </MenuItem>
            <MenuItem
              disabled={b.current}
              onClick={() =>
                void runAndClose(t('git.run.rebase', { branch: b.name }), () =>
                  window.api.git.rebaseOnto(project.path, b.name),
                )
              }
            >
              {t('git.rebaseOnto', { branch: b.name })}
            </MenuItem>
            <MenuSep />
            <MenuItem
              onClick={() => {
                closeAll()
                setRenaming(b.name)
              }}
            >
              {t('git.rename')}
            </MenuItem>
            <MenuItem
              disabled={b.current}
              onClick={() => {
                closeAll()
                setDeleteUnmerged(false)
                setDeleting(b.name)
              }}
            >
              {t('git.deleteBranch')}
            </MenuItem>
          </Menu>
        )}
      </div>
    )
  }

  return (
    <div className="git-menu" ref={popupRootRef}>
      <button
        className={'branch-btn' + (open ? ' open' : '')}
        {...popupTrigger}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title={t('git.menu.title', { project: project.name })}
        aria-label={t('git.menu.aria', { project: project.name, branch: current ?? 'detached' })}
      >
        ⑂ {current ?? 'detached'} ▾
      </button>

      {open && (
        <Menu menu={popup} className="git-popup" role="none">
          <input
            autoFocus
            aria-label={t('git.search')}
            placeholder={t('git.search')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const first = matched[0]
              const firstAction = visibleActions[0]
              if (firstAction && !matched.length) start(firstAction)
              else if (first && !first.current)
                void runAndClose(t('git.run.checkout', { branch: first.name }), () =>
                  window.api.git.checkout(project.path, first.name),
                )
            }}
          />

          {visibleActions.length > 0 && (
            <div className="git-group">
              {visibleActions.map((a) => (
                <button key={a.id} className="git-action" disabled={busy} onClick={() => start(a)}>
                  <span>{a.label}</span>
                  <span className="muted small">{a.hint}</span>
                </button>
              ))}
              <button
                className="git-action"
                onClick={() => {
                  const name = filter.trim()
                  if (!name) {
                    onError(t('git.newBranch.needName'))
                    return
                  }
                  void runAndClose(t('git.run.createBranch', { name }), () =>
                    window.api.git.createBranch(project.path, name),
                  )
                }}
              >
                <span>
                  {filter.trim() ? t('git.newBranch.named', { name: filter.trim() }) : t('git.newBranch.prompt')}
                </span>
                <span className="muted small">{t('git.newBranch.hint')}</span>
              </button>
            </div>
          )}

          <div className="git-list">
            {recent.length > 0 && (
              <>
                <div className="git-caption">{t('git.caption.recent')}</div>
                {recent.map(branchRow)}
              </>
            )}
            <div className="git-caption">{t('git.caption.all')}</div>
            {local.map(branchRow)}
            {matched.length === 0 && <div className="muted pad small">{t('git.noBranches')}</div>}
          </div>
        </Menu>
      )}

      {asking && (
        <PullChoiceModal
          what={t('git.pullChoice.what.project', { name: project.name })}
          onClose={() => setAsking(false)}
          onPick={(strategy, remember) => {
            setAsking(false)
            if (remember) onPullStrategy(strategy)
            void runAndClose(t('git.run.pull'), () => window.api.git.pull(project.path, strategy))
          }}
        />
      )}

      {renaming && (
        <RenameBranchModal
          branch={renaming}
          onClose={() => setRenaming(null)}
          onRename={(to) =>
            void runAndClose(t('git.run.rename'), () => window.api.git.renameBranch(project.path, renaming, to))
          }
        />
      )}

      {deleting && (
        <Modal
          title={t('git.delete.title', { branch: deleting })}
          onClose={() => {
            setDeleting(null)
            setDeleteUnmerged(false)
          }}
        >
          {deleteUnmerged ? (
            <p className="hint warn">{t('git.delete.unmerged', { branch: deleting })}</p>
          ) : (
            <p className="hint">{t('git.delete.hint')}</p>
          )}
          <div className="modal-actions">
            <button
              onClick={() => {
                setDeleting(null)
                setDeleteUnmerged(false)
              }}
            >
              {t('common.cancel')}
            </button>
            <button className="primary danger" disabled={busy} onClick={() => void doDelete(deleting, deleteUnmerged)}>
              {deleteUnmerged ? t('git.delete.force') : t('git.delete.confirm')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
