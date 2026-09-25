import type { JSX } from 'react'
import { useState } from 'react'
import type { PullStrategy, Session } from '../../../shared/types'
import { useT } from '../i18n'
import { Menu, MenuItem, MenuSep } from '../ui/Menu'
import { useMenu } from '../ui/useMenu'
import type { GitActionResult } from '../ui/useGitAction'
import { lastLine, resultMessage, useGitAction } from '../ui/useGitAction'
import PullChoiceModal from './PullChoiceModal'
import RenameBranchModal from './RenameBranchModal'

interface Props {
  session: Session
  ahead: number
  behind: number
  /** which directory is on screen: the session's own or the shared project one */
  scope: 'session' | 'project'
  onScope: (scope: 'session' | 'project') => void
  /** the session has a directory of its own — only then is there anything to switch */
  separate: boolean
  projectPath: string
  pullStrategy: PullStrategy
  onPullStrategy: (strategy: PullStrategy) => void
  /** push goes through the shared window: show what will leave before it does */
  onPush: () => void
  onError: (msg: string) => void
  onInfo: (msg: string | null) => void
  onRefresh: () => void
}

/**
 * The session's branch menu. Its entries and their wording repeat the project menu: the same
 * action must carry the same name, or it reads as two different ones — which is why every entry
 * here takes the key the project menu takes (`git.pull`, `git.push`, `git.createPr`,
 * `git.mergeInto`, `git.rebaseOnto`, `git.rename`), in that order. Only what belongs to the
 * session is local to this menu — switching which directory is shown.
 */
export default function BranchActions({
  session,
  ahead,
  behind,
  scope,
  onScope,
  separate,
  projectPath,
  pullStrategy,
  onPullStrategy,
  onPush,
  onError,
  onInfo,
  onRefresh,
}: Props): JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const menu = useMenu(open, () => setOpen(false))
  // bound once: reading a member off a handle that carries refs counts as touching a ref
  // during render, whether or not `.current` is what is being read
  const { rootRef, triggerProps } = menu
  const { busy, run: runGit } = useGitAction({ onError, onInfo, onRefresh })

  const worktree = session.worktree

  /** every entry here folds the menu first, and `gh` answers with a URL rather than output */
  const run = async (label: string, fn: () => Promise<GitActionResult>): Promise<void> => {
    setOpen(false)
    // push puts the line worth showing last; an app-authored note replaces it when there is one
    await runGit(label, fn, { done: (res) => res.url ?? (res.code ? resultMessage(t, res) : lastLine(res.output)) })
  }

  if (!worktree) return null

  /**
   * «Pull — update the branch» without an upstream is not an error: a session branch has usually
   * not been pushed yet, and updating it means taking from its base, not from a branch that
   * does not exist on the server. Otherwise git answers «There is no tracking information for
   * the current branch», which is true and useless.
   */
  const runPull = async (strategy: 'merge' | 'rebase'): Promise<void> => {
    const hasUpstream = await window.api.git.hasUpstream(session.cwd)
    if (hasUpstream) {
      await run(t('git.run.pull'), () => window.api.git.pull(session.cwd, strategy))
      return
    }
    await run(t('git.run.pullFrom', { ref: worktree.baseRef }), () =>
      window.api.git.syncWithBase(session.cwd, worktree.baseRef, strategy),
    )
  }

  const pull = (): void => {
    if (pullStrategy === 'ask') {
      setOpen(false)
      setAsking(true)
      return
    }
    void runPull(pullStrategy)
  }

  const branchLabel = t('git.branchLabel', { branch: worktree.branch })
  const baseLine = behind
    ? t.plural('git.title.base', behind, { ref: worktree.baseRef })
    : t('git.title.baseCurrent', { ref: worktree.baseRef })

  return (
    <div className="branch-actions" ref={rootRef}>
      <button
        className="branch-name"
        {...triggerProps}
        aria-label={t('git.branchMenu.aria', { branch: worktree.branch })}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        title={`${branchLabel}\n${baseLine}\n${t('git.title.folder', { path: session.cwd })}`}
      >
        ⑂ <span className="own">{worktree.branch}</span>
        <span className="base">
          ← {worktree.baseRef}
          {behind ? ` −${behind}` : ''}
        </span>
        ▾
      </button>
      {open && (
        <Menu menu={menu} className="branch-actions-menu" label={branchLabel}>
          <MenuItem onClick={pull}>
            {t('git.pull', { what: t('git.what.branch') })}{' '}
            <span className="muted small">
              {pullStrategy === 'ask'
                ? t('git.pull.hint.ask')
                : `pull --${pullStrategy === 'merge' ? 'no-rebase' : 'rebase'}`}
            </span>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false)
              onPush()
            }}
          >
            {t('git.push')} <span className="muted small">{ahead ? `+${ahead}` : 'origin'}</span>
          </MenuItem>
          <MenuItem
            onClick={() =>
              void run(t('git.run.createPr'), () =>
                window.api.git.createPullRequest(session.cwd, session.name, '', worktree.baseRef),
              )
            }
          >
            {t('git.createPr')} <span className="muted small">gh</span>
          </MenuItem>

          <MenuSep />
          <MenuItem
            onClick={() =>
              void run(t('git.run.mergeBase'), () =>
                window.api.git.syncWithBase(session.cwd, worktree.baseRef, 'merge'),
              )
            }
          >
            {t('git.mergeInto', { branch: worktree.baseRef })}
          </MenuItem>
          <MenuItem
            onClick={() =>
              void run(t('git.run.rebaseBase'), () =>
                window.api.git.syncWithBase(session.cwd, worktree.baseRef, 'rebase'),
              )
            }
          >
            {t('git.rebaseOnto', { branch: worktree.baseRef })}{' '}
            <span className="muted small">{behind ? `-${behind}` : t('git.rebase.hint.upToDate')}</span>
          </MenuItem>

          <MenuSep />
          <MenuItem
            onClick={() => {
              setOpen(false)
              setRenaming(true)
            }}
          >
            {t('git.rename')}
          </MenuItem>
          {separate && (
            <MenuItem
              data-testid="scope-toggle"
              onClick={() => {
                onScope(scope === 'session' ? 'project' : 'session')
                setOpen(false)
              }}
              title={scope === 'session' ? projectPath : session.cwd}
            >
              {scope === 'session' ? t('git.scope.showProject') : t('git.scope.showSession')}
            </MenuItem>
          )}
        </Menu>
      )}

      {asking && (
        <PullChoiceModal
          what={t('git.pullChoice.what.branch', { branch: worktree.branch })}
          onClose={() => setAsking(false)}
          onPick={(strategy, remember) => {
            setAsking(false)
            if (remember) onPullStrategy(strategy)
            void runPull(strategy)
          }}
        />
      )}

      {renaming && (
        <RenameBranchModal
          branch={worktree.branch}
          onClose={() => setRenaming(false)}
          onRename={(to) =>
            void run(t('git.run.rename'), () => window.api.git.renameBranch(session.cwd, worktree.branch, to))
          }
        />
      )}
    </div>
  )
}
