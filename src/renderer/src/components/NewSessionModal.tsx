import type { JSX } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentDef, Project } from '../../../shared/types'
import { useT } from '../i18n'
import { autoBranch, worktreePathFor } from '../lib/sessionDefaults'
import Modal from '../ui/Modal'
import { Menu, MenuItem } from '../ui/Menu'
import { useMenu } from '../ui/useMenu'

export interface NewSessionResult {
  name: string
  /**
   * the name is still the generated one — nobody typed over it, so the agent's terminal title
   * may take it over later. Reported here because only this window knows whether it was touched;
   * matching the name against a pattern would break the moment the wording changes with the locale.
   */
  nameAuto: boolean
  createWorktree: boolean
  branch: string
  baseRef: string
  worktreePath: string
  /** agent launched in the session's first terminal; null = plain shell */
  agentId: string | null
  /** first task, handed to the agent as its initial prompt */
  startPrompt: string
}

interface Props {
  project: Project
  agents: AgentDef[]
  /** base for the worktree, when the session is opened from a branch menu */
  initialBase?: string | undefined
  onCancel: () => void
  onConfirm: (res: NewSessionResult) => void
}

/**
 * The new-session window.
 *
 * The git side is folded down to one question — where the agent works — plus a summary line.
 * The branch, the base and the directory used to hang there as three required fields although
 * they are rarely touched. The summary is always visible: the window must not hide which
 * directory the work happens in or what it forks from.
 */
export default function NewSessionModal({ project, agents, initialBase, onCancel, onConfirm }: Props): JSX.Element {
  const t = useT()
  const nextIndex = project.sessions.length + 1
  const [name, setName] = useState(() => t('sessions.defaultName', { n: nextIndex }))
  const [nameTouched, setNameTouched] = useState(false)
  const [isolated, setIsolated] = useState(project.isGit)
  const [advanced, setAdvanced] = useState(false)
  const [branch, setBranch] = useState('')
  const [branchTouched, setBranchTouched] = useState(false)
  const [pathTouched, setPathTouched] = useState(false)
  const [worktreePath, setWorktreePath] = useState('')
  /** from the root's current branch, or from one picked by hand */
  const [baseMode, setBaseMode] = useState<'current' | 'custom'>(initialBase ? 'custom' : 'current')
  const [customBase, setCustomBase] = useState(initialBase ?? '')
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [branches, setBranches] = useState<{ name: string; remote: boolean }[]>([])
  /** the base list is ours, not a datalist: that one filtered against the field's own text */
  const [baseOpen, setBaseOpen] = useState(false)
  const [baseTyped, setBaseTyped] = useState(false)
  /** names already taken: the repository's branches and the branches of other worktrees */
  const [takenBranches, setTakenBranches] = useState<Set<string>>(new Set())
  /** git will not hand over a branch another worktree holds: warn before «Create» is pressed */
  const [busyBranch, setBusyBranch] = useState<string | null>(null)
  const enabledAgents = agents.filter((a) => a.enabled)
  const [agentId, setAgentId] = useState<string | null>(enabledAgents[0]?.id ?? null)
  const [startPrompt, setStartPrompt] = useState('')

  useEffect(() => {
    if (!project.isGit) return
    void window.api.git.branchInfo(project.path).then((list) => {
      setBranches(list.map((b) => ({ name: b.name, remote: b.remote })))
      setTakenBranches((prev) => new Set([...prev, ...list.filter((b) => !b.remote).map((b) => b.name)]))
    })
    void window.api.git.worktrees(project.path).then((list) => {
      setTakenBranches(
        (prev) => new Set([...prev, ...list.map((w) => w.branch).filter((b): b is string => Boolean(b))]),
      )
    })
    void window.api.git.currentBranch(project.path).then((b) => setCurrentBranch(b ?? null))
  }, [project.path, project.isGit])

  const baseRef = baseMode === 'current' ? (currentBranch ?? 'HEAD') : customBase.trim() || 'HEAD'

  /** the main branch comes first: it is the usual fork point when the current one will not do */
  const baseOptions = useMemo(() => {
    const weight = (n: string): number =>
      n === 'main' || n === 'master' ? 0 : n === 'origin/main' || n === 'origin/master' ? 1 : n.includes('/') ? 3 : 2
    const sorted = [...branches].sort((a, b) => weight(a.name) - weight(b.name))
    const q = baseTyped ? customBase.trim().toLowerCase() : ''
    return q ? sorted.filter((b) => b.name.toLowerCase().includes(q)) : sorted
  }, [branches, baseTyped, customBase])

  /** the filter can leave no bases at all: an empty list is neither drawn nor given the keys */
  const baseListOpen = baseOpen && baseOptions.length > 0
  const baseMenu = useMenu<HTMLLabelElement>(baseListOpen, () => setBaseOpen(false), {
    haspopup: 'listbox',
    // focus stays in the field: the list only suggests, typing can carry on
    autoFocus: false,
  })
  // bound once: reading a member off a handle that carries refs counts as touching a ref
  // during render, whether or not `.current` is what is being read
  const { rootRef: baseRootRef, triggerProps: baseTrigger, onKeyDown: baseKeys } = baseMenu

  // the same naming a session opened by an agent gets: one helper, `lib/sessionDefaults`
  const suggestedBranch = useMemo(
    () => autoBranch({ name: nameTouched ? name : null, task: startPrompt }, takenBranches),
    [nameTouched, name, startPrompt, takenBranches],
  )

  const effectiveBranch = branchTouched ? branch : suggestedBranch
  const autoPath = useMemo(() => worktreePathFor(project.path, effectiveBranch), [project.path, effectiveBranch])
  /** the directory may be left over from a removed worktree: git refuses to put a new one there */
  const [freePath, setFreePath] = useState<string | null>(null)

  useEffect(() => {
    if (!project.isGit || !isolated || pathTouched) return
    let alive = true
    void (async () => {
      let candidate = autoPath
      for (let i = 2; i < 20 && (await window.api.fs.exists(candidate)); i++) candidate = `${autoPath}-${i}`
      if (alive) setFreePath(candidate)
    })()
    return () => {
      alive = false
    }
  }, [project.isGit, isolated, pathTouched, autoPath])

  const effectivePath = pathTouched ? worktreePath : (freePath ?? autoPath)

  // The warning only applies to a name typed by hand: an auto-generated one is already free.
  // The gate is applied where `busyBranch` is read rather than by clearing it from the effect —
  // an effect whose only job is to unset state costs a second render and buys nothing.
  const warnOnBusy = project.isGit && isolated && branchTouched
  useEffect(() => {
    if (!warnOnBusy) return
    let alive = true
    void window.api.git.worktrees(project.path).then((list) => {
      if (!alive) return
      const taken = list.find((w) => w.branch === effectiveBranch)
      setBusyBranch(taken ? taken.path : null)
    })
    return () => {
      alive = false
    }
  }, [project.path, warnOnBusy, effectiveBranch])

  const submit = (): void => {
    if (!name.trim()) return
    onConfirm({
      name: name.trim(),
      nameAuto: !nameTouched,
      createWorktree: isolated && project.isGit,
      branch: effectiveBranch.trim(),
      baseRef,
      worktreePath: effectivePath.trim(),
      agentId,
      startPrompt: startPrompt.trim(),
    })
  }

  const shortPath = effectivePath.startsWith(project.path + '/')
    ? effectivePath.slice(project.path.length + 1)
    : effectivePath

  return (
    <Modal title={t('modals.newSession.title')} onClose={onCancel}>
      <label>
        <span>{t('modals.newSession.name')}</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setNameTouched(true)
            setName(e.target.value)
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>

      <label>
        <span>{t('modals.newSession.firstTab')}</span>
        <div className="agent-picker">
          {enabledAgents.map((a) => (
            <button
              key={a.id}
              className={'pick' + (agentId === a.id ? ' active' : '')}
              onClick={() => setAgentId(a.id)}
              title={[a.command, ...a.args].filter(Boolean).join(' ')}
            >
              <span className="dot" style={{ background: a.color }} />
              {a.name}
            </button>
          ))}
          <button className={'pick' + (agentId === null ? ' active' : '')} onClick={() => setAgentId(null)}>
            <span className="dot" />
            Shell
          </button>
        </div>
      </label>

      <label>
        <span>{t('modals.newSession.task')}</span>
        <textarea
          rows={3}
          placeholder={t('modals.newSession.task.placeholder')}
          value={startPrompt}
          onChange={(e) => setStartPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
          }}
        />
      </label>

      {project.isGit ? (
        <div className="where">
          <span className="muted small">{t('modals.newSession.where')}</span>

          <label className="check">
            <input type="radio" checked={isolated} onChange={() => setIsolated(true)} />
            <span>{t('modals.newSession.isolated')}</span>
          </label>

          {isolated && (
            <div className="where-detail">
              {/* the line reads through two <code> elements: every piece carries its own spaces */}
              <div className="summary">
                {t('modals.newSession.summary.branch')}
                <code>{effectiveBranch}</code>
                {t('modals.newSession.summary.from')}
                <code>{baseRef}</code>
                {baseMode === 'current' && (
                  <span className="muted small">{t('modals.newSession.summary.current')}</span>
                )}
                <button className="link" onClick={() => setAdvanced((v) => !v)}>
                  {advanced ? t('modals.newSession.collapse') : t('modals.newSession.configure')}
                </button>
              </div>
              <div className="summary muted small">
                {t('modals.newSession.summary.dir')}
                <code>{shortPath}</code>
              </div>

              {warnOnBusy && busyBranch && (
                <p className="hint warn">
                  {t('modals.newSession.busyBranch', { branch: effectiveBranch, path: busyBranch })}
                </p>
              )}

              {advanced && (
                <div className="nested">
                  <label>
                    <span>{t('modals.newSession.branch')}</span>
                    <input
                      value={effectiveBranch}
                      onChange={(e) => {
                        setBranchTouched(true)
                        setBranch(e.target.value)
                      }}
                    />
                  </label>

                  <span className="muted small">{t('modals.newSession.base')}</span>
                  <label className="check">
                    <input
                      type="radio"
                      checked={baseMode === 'current'}
                      onChange={() => setBaseMode('current')}
                      disabled={!currentBranch}
                    />
                    <span>
                      {t('modals.newSession.base.current')}
                      <code>{currentBranch ?? t('modals.newSession.base.unknown')}</code>
                    </span>
                  </label>
                  <label className="check">
                    <input type="radio" checked={baseMode === 'custom'} onChange={() => setBaseMode('custom')} />
                    <span>{t('modals.newSession.base.custom')}</span>
                  </label>

                  {baseMode === 'custom' && (
                    <label className="base-pick" ref={baseRootRef}>
                      <input
                        {...baseTrigger}
                        aria-label={t('modals.newSession.base.aria')}
                        value={customBase}
                        placeholder={t('modals.newSession.base.placeholder')}
                        onFocus={() => {
                          setBaseTyped(false)
                          setBaseOpen(true)
                        }}
                        onChange={(e) => {
                          setBaseTyped(true)
                          setBaseOpen(true)
                          setCustomBase(e.target.value)
                        }}
                        // arrow-down leads out of the field into the list, which then walks itself
                        onKeyDown={baseKeys}
                      />
                      {baseListOpen && (
                        <Menu
                          menu={baseMenu}
                          className="base-list"
                          role="listbox"
                          label={t('modals.newSession.base.list')}
                        >
                          {baseOptions.map((b) => (
                            <MenuItem
                              key={b.name}
                              role="option"
                              aria-selected={b.name === customBase}
                              className={b.name === customBase ? 'active' : ''}
                              onClick={() => {
                                setCustomBase(b.name)
                                setBaseTyped(false)
                                setBaseOpen(false)
                              }}
                            >
                              <span className="name">{b.name}</span>
                              {b.remote && <span className="muted small">remote</span>}
                            </MenuItem>
                          ))}
                        </Menu>
                      )}
                    </label>
                  )}

                  <label>
                    <span>{t('modals.newSession.dir')}</span>
                    <input
                      value={effectivePath}
                      onChange={(e) => {
                        setPathTouched(true)
                        setWorktreePath(e.target.value)
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          <label className="check">
            <input type="radio" checked={!isolated} onChange={() => setIsolated(false)} />
            <span>{t('modals.newSession.inPlace')}</span>
          </label>
          {!isolated && <p className="hint warn">{t('modals.newSession.inPlace.warn', { path: project.path })}</p>}
        </div>
      ) : (
        <p className="hint">{t('modals.newSession.notGit')}</p>
      )}

      <div className="modal-actions">
        <button data-testid="modal-cancel" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="primary" onClick={submit}>
          {t('modals.newSession.create')}
        </button>
      </div>
    </Modal>
  )
}
