import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangedFile, DiffMode, GitStatusResult, RepoState, Session, Settings } from '../../../shared/types'
import { COMMIT_VIA_SERVICE, COMMIT_VIA_TAB, SERVICE_ARGS } from '../../../shared/types'
import { useT } from '../i18n'
import Modal from '../ui/Modal'
import { useRovingFocus } from '../ui/rows'
import { resultMessage, useGitAction } from '../ui/useGitAction'
import BranchActions from './BranchActions'
import ChangedFileRow from './ChangedFileRow'
import PushModal from './PushModal'

interface Props {
  session: Session
  /** project root: a session may live in a worktree while edits go to the main working tree */
  projectPath: string
  collapsed: boolean
  onToggleCollapsed: (collapsed: boolean) => void
  settings: Settings
  onError: (msg: string) => void
  onInfo: (msg: string | null) => void
  /** the diff opens as a tab next to the agents */
  onOpenMerge: (cwd: string, path: string) => void
  /** open settings on the message-generation tab */
  onOpenCommitSettings: () => void
  /** how to pull and whether to remember it: the same choice the project menu offers */
  onPullStrategy: (strategy: Settings['pullStrategy']) => void
  /** what changed, handed to the file tree so it need not poll git a second time */
  onChangedFiles: (files: Record<string, ChangedFile['status']>) => void
  /** a running agent tab: it can be asked a question through /btw */
  agentTabId: string | null
  onOpenDiff: (spec: {
    cwd: string
    path: string
    oldPath?: string
    status: ChangedFile['status']
    untracked: boolean
    mode: DiffMode
    baseRef?: string
  }) => void
}

const POLL_MS = 4000

/**
 * The changes panel.
 *
 * There used to be a "what are we comparing" switch here: the working tree against HEAD, or
 * against the base branch. It was renamed three times and stayed incomprehensible anyway —
 * because the problem was not its name but the existence of a hidden mode at all: the very
 * same list meant either "this can be committed" or "this is already done".
 *
 * Now the list holds only what can be committed, so every row carries a checkbox and the
 * question "why can I not select this file" never comes up. Commits that are already made are
 * looked at in the push window, where they belong: there you can see what will leave.
 */
export default function ChangesPanel({
  session,
  projectPath,
  settings,
  collapsed,
  onToggleCollapsed,
  onError,
  onInfo,
  onOpenDiff,
  onOpenMerge,
  onOpenCommitSettings,
  onPullStrategy,
  onChangedFiles,
  agentTabId,
}: Props): JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  /** the first poll of this directory is still out: "empty" and "not known yet" differ */
  const [loading, setLoading] = useState(true)
  const [repo, setRepo] = useState<RepoState | null>(null)
  /** the push window: one for both entry points — the ↑ arrow up top and the branch menu */
  const [pushOpen, setPushOpen] = useState(false)
  const [selected, setSelected] = useState<ChangedFile | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [confirmRevert, setConfirmRevert] = useState(false)
  // request token: a slower reply for a previous session must not overwrite the current one
  const reqId = useRef(0)
  /**
   * When the agent tab last printed anything. The panel has no "is the agent busy" prop, so
   * busyness is measured the way the running indicator measures it — by how fresh the output is.
   */
  const lastAgentOutputAt = useRef(0)
  /** which working directory is shown: the session's own or the project root */
  const [scope, setScope] = useState<'session' | 'project'>('session')
  const listRef = useRef<HTMLDivElement>(null)
  const onListKeys = useRovingFocus(listRef, '.change[role="button"]')

  const separate = session.cwd !== projectPath
  const cwd = scope === 'project' && separate ? projectPath : session.cwd
  const baseRef = scope === 'session' ? session.worktree?.baseRef : undefined

  const refresh = useCallback(async () => {
    // a hidden window has nothing to show; git runs are the app's main idle cost
    if (document.hidden) return
    const req = ++reqId.current
    const [res, state] = await Promise.all([
      window.api.git.status(cwd, 'working', baseRef),
      window.api.git.repoState(cwd),
    ])
    if (req !== reqId.current) return
    setStatus(res)
    setLoading(false)
    setRepo(state)
    // the file tree colours its rows from this same status: it needs no git poll of its own
    if (scope === 'session') {
      const map: Record<string, ChangedFile['status']> = {}
      for (const f of res.files) map[f.path] = f.status
      onChangedFiles(map)
    }
    // drop selections for files that are no longer changed
    setChecked((prev) => {
      const paths = new Set(res.files.map((f) => f.path))
      const next = new Set([...prev].filter((p) => paths.has(p)))
      return next.size === prev.size ? prev : next
    })
  }, [cwd, baseRef, scope, onChangedFiles])

  /**
   * Resets that used to sit at the top of the effects below. Done while rendering instead:
   * an effect runs after the browser has already painted, so for one frame the previous
   * directory's file list stood under the new branch name, with its checkboxes still ticked —
   * one wrong click away from committing the wrong repository.
   */
  const listKey = `${cwd}\0${baseRef ?? ''}\0${scope}`
  const [listFor, setListFor] = useState(listKey)
  if (listFor !== listKey) {
    setListFor(listKey)
    setStatus(null)
    setLoading(true)
    setChecked(new Set())
  }
  const [selectedFor, setSelectedFor] = useState(session.id)
  if (selectedFor !== session.id) {
    setSelectedFor(session.id)
    setSelected(null)
  }

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), POLL_MS)
    const onVisible = (): void => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  useEffect(() => {
    if (!agentTabId) return
    const off = window.api.pty.onData((e) => {
      if (e.id === agentTabId) lastAgentOutputAt.current = Date.now()
    })
    return off
  }, [agentTabId])

  const files = status?.files ?? []
  const picked = files.filter((f) => checked.has(f.path))
  const busyOp = Boolean(repo && repo.operation !== 'none')
  const { running, run } = useGitAction({ onError, onInfo, onRefresh: () => void refresh() })
  /** the name of the commit call: the commit button reads it back to know it is the busy one */
  const commitLabel = t('changes.commit')
  const committing = running === commitLabel

  const toggle = (path: string): void =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const toggleAll = (): void =>
    setChecked((prev) => (prev.size === files.length ? new Set() : new Set(files.map((f) => f.path))))

  /**
   * Asking an already running agent through /btw: the question does not interrupt its work,
   * but in that mode it has no tools either — it can neither read the diff nor write a file.
   * So the summary of the changes goes straight into the question, and the answer is asked for
   * wrapped in markers, which we fish back out of the terminal stream.
   */
  const draftViaTab = async (paths: string[]): Promise<void> => {
    if (!agentTabId) {
      onError(t('changes.draft.noTab'))
      return
    }
    // the same threshold the running indicator uses: fresh output means the agent is mid-turn
    if (Date.now() - lastAgentOutputAt.current < 6000) {
      onError(t('changes.draft.tabBusy'))
      return
    }

    const summary = await window.api.git.diffSummary(cwd, paths, 'HEAD')
    const marker = '@@CS@@'
    // the agent's input field has a length limit, so keep the question short
    const LIMIT = 1200
    const head = `/btw ${settings.commitMessage.prompt} ` + t('changes.draft.format', { marker })
    const room = Math.max(120, LIMIT - head.length)
    const compact = summary.replace(/\s*\n\s*/g, ' · ')
    // all on one line: a newline in the input field sends the message
    const question = head + (compact.length > room ? compact.slice(0, room - 1) + '…' : compact)

    const found = new Promise<string | null>((resolve) => {
      let buffer = ''
      let timer: number
      const off = window.api.pty.onData((e) => {
        if (e.id !== agentTabId) return
        // the TUI repaints and rewraps its lines, so strip the escape codes and glue it back
        buffer = (buffer + e.data).slice(-20000)
        // the ESC byte is the point of this regex: it is what starts an ANSI sequence
        // eslint-disable-next-line no-control-regex
        const flat = buffer.replace(/\[[0-9;?]*[a-zA-Z]/g, '').replace(/\s+/g, ' ')
        const parts = flat.split(marker)
        // the first occurrence is our own question; the answer comes after it
        if (parts.length < 5) return
        const answer = parts[3]?.trim()
        if (!answer) return
        off()
        window.clearTimeout(timer)
        resolve(answer)
      })
      timer = window.setTimeout(() => {
        off()
        resolve(null)
      }, settings.commitMessage.timeoutMs)
    })

    window.api.pty.input(agentTabId, question)
    // sent as a separate keypress: that gives the composer time to take the long text
    window.setTimeout(() => agentTabId && window.api.pty.input(agentTabId, '\r'), 250)

    const answer = await found
    if (!answer) {
      onError(t('changes.draft.tabSilent'))
      return
    }
    setMessage(answer)
  }

  // a rejected call must leave neither the button disabled nor the hint on screen: the flag
  // and the hint are both cleared in finally
  const draft = async (): Promise<void> => {
    if (!picked.length || drafting) return
    setDrafting(true)
    try {
      const cfg = settings.commitMessage
      if (cfg.agentId === COMMIT_VIA_SERVICE) {
        onInfo(t('changes.draft.askService'))
        const summary = await window.api.git.diffSummary(
          cwd,
          picked.map((f) => f.path),
          'HEAD',
        )
        // command and profile come from the first claude agent: the service session lives in
        // that same profile
        const base = settings.agents.find((a) => a.preset === 'claude') ?? settings.agents[0]
        const res = await window.api.agents.serviceAsk(
          {
            command: base?.command ?? 'claude',
            args: cfg.args.length ? cfg.args : SERVICE_ARGS,
            env: base?.env ?? {},
            cwd: session.cwd,
          },
          cfg.prompt,
          summary,
          cfg.timeoutMs,
        )
        if (!res.ok || !res.message) {
          onError(resultMessage(t, res, t('changes.draft.serviceSilent')))
          return
        }
        setMessage(res.message)
        return
      }
      if (cfg.agentId === COMMIT_VIA_TAB) {
        onInfo(t('changes.draft.askTab'))
        await draftViaTab(picked.map((f) => f.path))
        return
      }
      const agent = cfg.agentId ? settings.agents.find((a) => a.id === cfg.agentId) : undefined
      const command = agent?.command ?? cfg.command ?? 'claude'
      onInfo(t('changes.draft.generating', { agent: agent?.name ?? command }))
      const res = await window.api.git.draftCommitMessage(
        cwd,
        picked.map((f) => f.path),
        {
          command,
          args: cfg.args,
          env: { ...(agent?.env ?? {}), ...(cfg.env ?? {}) },
          prompt: cfg.prompt,
          timeoutMs: cfg.timeoutMs,
        },
        'HEAD',
      )
      if (!res.ok || !res.message) {
        onError(resultMessage(t, res, t('changes.draft.failed')))
        return
      }
      setMessage(res.message)
    } finally {
      setDrafting(false)
      onInfo(null)
    }
  }

  const doCommit = async (): Promise<void> => {
    if (!picked.length || !message.trim() || committing) return
    const res = await run(
      commitLabel,
      () =>
        window.api.git.commit(
          cwd,
          picked.map((f) => f.path),
          message.trim(),
        ),
      // `resultMessage` keeps the note the main process appends («… already-committed skipped»)
      { done: (r) => resultMessage(t, r) || t('changes.commit.done') },
    )
    if (!res?.ok) return
    setMessage('')
    setChecked(new Set())
  }

  /** leaving an unfinished rebase/merge from the panel itself */
  const resolveOp = async (action: 'continue' | 'skip' | 'abort'): Promise<void> => {
    if (!repo || repo.operation === 'none') return
    const labels = {
      continue: t('changes.run.continue'),
      skip: t('changes.run.skip'),
      abort: t('changes.run.abort'),
    }
    const operation = repo.operation
    const res = await run(labels[action], () => window.api.git.continueOperation(cwd, operation, action), {
      // a stop on a conflict comes back as a note on a successful call: `resultMessage` words it
      done: (r) => resultMessage(t, r) || t('changes.run.done'),
    })
    // a refused continue leaves the repository in a different state than before: re-read it too
    if (!res?.ok) void refresh()
  }

  const revert = async (): Promise<void> => {
    if (!picked.length) return
    const count = picked.length
    const res = await run(
      t('changes.revert.run'),
      () =>
        window.api.git.revertFiles(
          cwd,
          picked.map((f) => f.path),
        ),
      { done: () => t('changes.revert.done', { count }) },
    )
    setConfirmRevert(false)
    if (res?.ok) setChecked(new Set())
  }

  /** the operations name themselves, in git's own words; only «none» has a wording to translate */
  const opName = (op: RepoState['operation']): string =>
    op === 'rebase' ? 'Rebase' : op === 'merge' ? 'Merge' : op === 'cherry-pick' ? 'Cherry-pick' : t('changes.op.other')

  if (collapsed) {
    return (
      <aside className="changes collapsed">
        <button
          className="collapse"
          title={t('changes.show')}
          aria-label={t('changes.show')}
          onClick={() => onToggleCollapsed(false)}
        >
          ⟨
        </button>
      </aside>
    )
  }

  const openFile = (f: ChangedFile): void => {
    setSelected(f)
    if (f.status === 'conflict') {
      onOpenMerge(cwd, f.path)
      return
    }
    onOpenDiff({
      cwd,
      path: f.path,
      // only a rename carries an old path; the key is left out entirely rather than set to
      // undefined, which `exactOptionalPropertyTypes` treats as a different thing
      ...(f.oldPath === undefined ? {} : { oldPath: f.oldPath }),
      status: f.status,
      untracked: f.untracked,
      mode: 'working',
    })
  }

  return (
    <>
      <aside className="changes">
        <div className="changes-head">
          <BranchActions
            session={session}
            onPush={() => setPushOpen(true)}
            pullStrategy={settings.pullStrategy}
            onPullStrategy={onPullStrategy}
            ahead={status?.ahead ?? 0}
            behind={status?.behind ?? 0}
            scope={scope}
            onScope={setScope}
            separate={separate}
            projectPath={projectPath}
            onError={onError}
            onInfo={onInfo}
            onRefresh={() => void refresh()}
          />
          {!session.worktree && status?.branch && (
            <span className="branch-name static" title={cwd}>
              ⑂ {status.branch}
            </span>
          )}
          {/* the exchange with the server: how much of ours has not left and how much of theirs is not in */}
          {status?.upstream ? (
            status.unpushed || status.unpulled ? (
              <span className="sync">
                {status.unpushed ? (
                  <button
                    className="out"
                    onClick={() => setPushOpen(true)}
                    title={t.plural('changes.sync.unpushed', status.unpushed, { upstream: status.upstream })}
                  >
                    ↑{status.unpushed}
                  </button>
                ) : null}
                {status.unpulled ? (
                  <span
                    className="in"
                    title={t.plural('changes.sync.unpulled', status.unpulled, { upstream: status.upstream })}
                  >
                    ↓{status.unpulled}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="muted small" title={t('changes.sync.upToDate', { upstream: status.upstream })}>
                ✓
              </span>
            )
          ) : (
            <button className="link-mute" onClick={() => setPushOpen(true)} title={t('changes.sync.never')}>
              {t('changes.sync.neverShort')}
            </button>
          )}
          <div className="spacer" />
          <button
            className="ghost"
            title={t('common.refresh')}
            aria-label={t('changes.refresh.aria')}
            onClick={() => void refresh()}
          >
            ↻
          </button>
          <button
            className="ghost"
            title={t('changes.collapse')}
            aria-label={t('changes.collapse.aria')}
            onClick={() => onToggleCollapsed(true)}
          >
            ⟩
          </button>
        </div>

        {scope === 'project' && separate && (
          <div className="scope-badge" title={projectPath}>
            <span>{t('changes.scope.badge')}</span>
            <button
              className="ghost"
              title={t('changes.scope.back')}
              aria-label={t('changes.scope.back')}
              onClick={() => setScope('session')}
            >
              ✕
            </button>
          </div>
        )}

        {repo && repo.operation !== 'none' && (
          <div className="repo-op">
            <div className="repo-op-head">
              <span className="what">
                {t('changes.op.stopped', { op: opName(repo.operation) })}
                {repo.conflicted.length ? t('changes.op.conflict') : ''}
                {repo.step ? t('changes.op.step', { step: repo.step }) : ''}
              </span>
            </div>
            {repo.conflicted.length > 0 && (
              <div className="repo-op-files">
                {repo.conflicted.map((f) => (
                  <div key={f} className="conflict-row">
                    <button className="link" onClick={() => onOpenMerge(cwd, f)} title={t('changes.op.openMerge')}>
                      {f}
                    </button>
                    <button
                      className="ghost"
                      title={t('changes.op.takeOurs')}
                      onClick={() => void window.api.git.acceptSide(cwd, f, 'ours').then(() => refresh())}
                    >
                      {t('changes.takeOurs')}
                    </button>
                    <button
                      className="ghost"
                      title={t('changes.op.takeTheirs')}
                      onClick={() => void window.api.git.acceptSide(cwd, f, 'theirs').then(() => refresh())}
                    >
                      {t('changes.takeTheirs')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div
          className="changes-list"
          ref={listRef}
          onKeyDown={onListKeys}
          role="group"
          aria-label={t('changes.list.aria')}
        >
          {status?.error && <div className="muted pad">{status.error}</div>}

          <div className="section-head">
            <label className="check-all" title={t('changes.checkAll')}>
              <input
                type="checkbox"
                aria-label={t('changes.checkAll')}
                checked={files.length > 0 && checked.size === files.length}
                onChange={toggleAll}
              />
            </label>
            <span className="section-title">{t('changes.toCommit')}</span>
            <span className="muted small">{files.length}</span>
          </div>

          {!status?.error && files.length === 0 && loading && (
            <div className="muted pad small">{t('changes.reading')}</div>
          )}

          {!status?.error && files.length === 0 && !loading && (
            <div className="muted pad small">
              {t('changes.empty.in')}
              <code>{scope === 'project' ? t('changes.scope.project') : t('changes.scope.session')}</code>
            </div>
          )}

          {/* the key is the path alone: with the status in it the row was recreated and lost focus */}
          {files.map((f) => (
            <ChangedFileRow
              key={f.path}
              file={f}
              className={selected?.path === f.path ? 'active' : undefined}
              active={selected?.path === f.path}
              onActivate={() => openFile(f)}
              lead={
                <input
                  type="checkbox"
                  checked={checked.has(f.path)}
                  title={t('changes.include')}
                  aria-label={t('changes.include.aria', { path: f.path })}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(f.path)}
                />
              }
              trail={
                <>
                  {f.status === 'conflict' && (
                    <button
                      className="ghost resolve"
                      title={t('changes.resolve')}
                      aria-label={t('changes.resolve.aria', { path: f.path })}
                      onClick={(e) => {
                        e.stopPropagation()
                        void window.api.git.markResolved(cwd, [f.path]).then(() => refresh())
                      }}
                    >
                      ✓
                    </button>
                  )}
                  {f.staged && (
                    <span className="staged" title={t('changes.staged')}>
                      ●
                    </span>
                  )}
                </>
              }
            />
          ))}
        </div>

        {busyOp && repo ? (
          <div className="op-actions">
            <button
              className="primary"
              disabled={repo.conflicted.length > 0}
              title={repo.conflicted.length > 0 ? t('changes.op.continue.blocked') : t('changes.op.continue.title')}
              onClick={() => void resolveOp('continue')}
            >
              {t('changes.op.continue')}
            </button>
            {repo.operation === 'rebase' && (
              <button onClick={() => void resolveOp('skip')} title={t('changes.op.skip.title')}>
                {t('changes.op.skip')}
              </button>
            )}
            <div className="spacer" />
            <button
              className="ghost danger"
              onClick={() => void resolveOp('abort')}
              title={t('changes.op.abort.title')}
            >
              {t('changes.op.abort')}
            </button>
          </div>
        ) : (
          <div className="commit-box">
            <textarea
              rows={3}
              placeholder={
                checked.size
                  ? t('changes.message.placeholder')
                  : files.length
                    ? t('changes.message.pick')
                    : t('changes.message.none')
              }
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void doCommit()
              }}
            />
            <div className="commit-actions">
              <button
                onClick={() => void draft()}
                disabled={!checked.size || drafting}
                title={t('changes.draft.title')}
              >
                {drafting ? '…' : `✨ ${t('changes.draft')}`}
              </button>
              <button
                className="ghost"
                onClick={onOpenCommitSettings}
                title={t('changes.draft.settings')}
                aria-label={t('changes.draft.settings.aria')}
              >
                ⚙
              </button>
              <button
                className="ghost danger"
                data-testid="revert-selected"
                onClick={() => setConfirmRevert(true)}
                disabled={!checked.size}
                title={t('changes.revert.title')}
              >
                ↺ {t('changes.revert')}
              </button>
              <div className="spacer" />
              <button
                className="primary"
                onClick={() => void doCommit()}
                disabled={!checked.size || !message.trim() || committing}
                title={t('changes.commit.title')}
              >
                {committing
                  ? t('changes.commit.busy')
                  : checked.size
                    ? t('changes.commit.n', { n: checked.size })
                    : t('changes.commit')}
              </button>
            </div>
          </div>
        )}
      </aside>

      {pushOpen && status && (
        <PushModal
          cwd={cwd}
          branch={status.branch ?? session.worktree?.branch ?? 'HEAD'}
          upstream={status.upstream ?? null}
          baseRef={baseRef}
          onClose={() => setPushOpen(false)}
          onError={onError}
          onInfo={onInfo}
          onDone={() => void refresh()}
        />
      )}

      {confirmRevert && (
        <Modal title={t.plural('changes.revert.confirm', picked.length)} onClose={() => setConfirmRevert(false)}>
          <p className="hint warn">{t('changes.revert.warn')}</p>
          <ul className="revert-list">
            {picked.slice(0, 12).map((f) => (
              <li key={f.path}>{f.path}</li>
            ))}
            {picked.length > 12 && <li className="muted">{t('changes.revert.more', { count: picked.length - 12 })}</li>}
          </ul>
          <div className="modal-actions">
            <button data-testid="modal-cancel" onClick={() => setConfirmRevert(false)}>
              {t('common.cancel')}
            </button>
            <button className="primary danger" onClick={() => void revert()}>
              {t('changes.revert')}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
