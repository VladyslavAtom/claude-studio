import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppMessageCode, Coded, MessageParams } from '../../../shared/types'
import type { T } from '../i18n'
import { useT } from '../i18n'

/**
 * Any answer of the main process that can carry an app-authored sentence: `code` says which
 * sentence, `params` carries its values, and `error`, `output` and `warning` hold the tool's own
 * text, verbatim and untranslated. Written structurally rather than imported so that `OpResult`,
 * `GitOpResult` and `FileContent` all fit without a cast.
 */
export interface CodedResult extends Coded {
  ok: boolean
  error?: string
  output?: string
  warning?: string
}

/** what every git call in `window.api.git` answers with; `url` only comes back from `gh` */
export interface GitActionResult extends CodedResult {
  url?: string
}

interface Reporters {
  onError: (msg: string) => void
  /** the shared status line: a message, or null to clear it */
  onInfo: (msg: string | null) => void
  /** re-read whatever the action changed — branch list, status, commit list */
  onRefresh?: () => void
}

interface RunOptions {
  /** what the status line says on success; default is git's first output line */
  done?: (res: GitActionResult) => string
  /** return true when this failure is dealt with here and no error toast is wanted */
  onFail?: (error: string) => boolean
}

export interface GitActionHandle {
  /** label of the call in flight, or null — buttons key their disabled state off this */
  running: string | null
  busy: boolean
  run: (label: string, fn: () => Promise<GitActionResult>, options?: RunOptions) => Promise<GitActionResult | null>
}

/**
 * How long a finished message stays on the status line. The six call sites this hook replaced
 * used 2500, 3000 and 4000 ms with no reason behind the spread; 3000 was the majority.
 */
const CLEAR_MS = 3000

/** first non-empty line of git's output — where `git commit` puts the part worth showing */
export function firstLine(text: string | undefined): string {
  return text?.split('\n').find((l) => l.trim()) ?? ''
}

/** last non-empty line — where `git push` puts it, after the progress noise */
export function lastLine(text: string | undefined): string {
  const lines = text?.split('\n').filter((l) => l.trim()) ?? []
  return lines[lines.length - 1]?.trim() ?? ''
}

// ---------------------------------------------------------------------------
// Codes into words.
//
// The main process writes no sentences: a failure it decided on itself arrives as a code out of
// `AppMessageCode` plus the values the wording needs. Only the renderer knows the locale, so
// only the renderer can turn one into a sentence — and this is the single place that does it.
// ---------------------------------------------------------------------------

/** a value the code carried, as text; absent values become '' rather than «undefined» */
function str(params: MessageParams | undefined, name: string): string {
  const value = params?.[name]
  return value === undefined ? '' : String(value)
}

/** a value the code carried, as a number: a count that failed to arrive counts as none */
function num(params: MessageParams | undefined, name: string): number {
  const value = Number(params?.[name])
  return Number.isFinite(value) ? value : 0
}

/** the command as the user thinks of it: `git` and its subcommand read as one name */
function commandOf(params: MessageParams | undefined): string {
  const sub = str(params, 'sub')
  const command = str(params, 'command')
  return sub ? `${command} ${sub}` : command
}

type Wording = (t: T, params: MessageParams | undefined) => string

/**
 * Every code, with the key that words it.
 *
 * A `Record` over the whole union on purpose: a code added to `AppMessageCode` and forgotten
 * here fails `tsc` in this file, which is what keeps the map exhaustive. The alternative — a
 * switch with a default — would compile and show the code itself to the user instead.
 */
const WORDING: Record<AppMessageCode, Wording> = {
  'git-output-too-large': (t, p) =>
    t('git.error.outputTooLarge', { command: commandOf(p), limitMb: num(p, 'limitMb') }),
  'git-timeout': (t, p) => t('git.error.timeout', { command: commandOf(p), seconds: num(p, 'seconds') }),
  // the subcommand is left out here: it is the binary that could not be found, not `git status`
  'git-not-found': (t, p) => t('git.error.notFound', { command: str(p, 'command') }),
  'git-spawn-failed': (t, p) => t('git.error.spawnFailed', { command: commandOf(p), reason: str(p, 'reason') }),

  'no-files-selected': (t) => t('git.error.noFilesSelected'),
  'commit-empty-message': (t) => t('git.error.commitEmptyMessage'),
  'commit-already-committed': (t) => t('git.error.commitAlreadyCommitted'),
  'commit-nothing-to-commit': (t) => t('git.error.commitNothingToCommit'),
  'commit-skipped-committed': (t, p) => t.plural('git.note.commitSkipped', num(p, 'count')),

  'no-operation-in-progress': (t) => t('git.error.noOperationInProgress'),
  // which operation stopped is data, and so is whether it had a ref to name: six wordings, one
  // per case, because «Merge «main»» and «Rebase на «main»» are not one sentence with a hole
  'conflict-stop': (t, p) => {
    const files = num(p, 'files')
    const ref = str(p, 'ref')
    if (str(p, 'operation') === 'merge') {
      return ref ? t.plural('git.note.conflict.mergeRef', files, { ref }) : t.plural('git.note.conflict.merge', files)
    }
    if (str(p, 'operation') === 'rebase') {
      return ref ? t.plural('git.note.conflict.rebaseRef', files, { ref }) : t.plural('git.note.conflict.rebase', files)
    }
    return ref ? t.plural('git.note.conflict.pullRef', files, { ref }) : t.plural('git.note.conflict.pull', files)
  },

  'branch-used-by-worktree': (t, p) =>
    t('git.error.branchUsedByWorktree', { branch: str(p, 'branch'), path: str(p, 'path') }),
  'worktree-branch-busy': (t, p) => t('git.error.worktreeBranchBusy', { branch: str(p, 'branch') }),
  'worktree-remove-failed': (t, p) => {
    const leftover = str(p, 'leftover')
    if (leftover === 'both') return t('git.error.worktreeRemoveFailed.both')
    if (leftover === 'dir') return t('git.error.worktreeRemoveFailed.dir')
    return t('git.error.worktreeRemoveFailed.record')
  },
  'worktree-removed-branch-kept': (t) => t('git.warning.worktreeRemovedBranchKept'),

  'no-upstream': (t) => t('git.error.noUpstream'),
  'pr-create-no-url': (t) => t('git.error.prCreateNoUrl'),

  'clone-url-empty': (t) => t('git.error.cloneUrlEmpty'),
  'clone-url-leading-dash': (t) => t('git.error.cloneUrlLeadingDash'),
  'clone-url-helper': (t) => t('git.error.cloneUrlHelper'),
  'clone-url-scheme': (t, p) => t('git.error.cloneUrlScheme', { scheme: str(p, 'scheme') }),
  'clone-url-unrecognised': (t) => t('git.error.cloneUrlUnrecognised'),

  'path-outside-roots': (t) => t('git.error.pathOutsideRoots'),
  'file-too-large': (t, p) => t('git.error.fileTooLarge', { limitMb: num(p, 'limitMb'), sizeKb: num(p, 'sizeKb') }),
  'file-binary': (t) => t('git.error.fileBinary'),
  // worded in the terminal area rather than with the git errors: these two are only ever said
  // about a path clicked in a terminal, and they name what the click could not do
  'terminal-path-gone': (t) => t('terminal.link.gone'),
  'terminal-path-not-a-file': (t) => t('terminal.link.notAFile'),

  // no ref means the files were compared with HEAD alone, and the wording says so
  'draft-no-changes': (t, p) => {
    const ref = str(p, 'ref')
    return ref ? t('git.error.draftNoChangesRef', { ref }) : t('git.error.draftNoChanges')
  },
  'draft-empty-answer': (t) => t('git.error.draftEmptyAnswer'),
  'service-no-answer': (t) => t('git.error.serviceNoAnswer'),
}

/**
 * The sentence for one code. Takes `t` rather than calling `useT()` itself, so it is usable
 * outside a component — in a handler, in a test, wherever the locale is already at hand.
 */
export function appMessage(t: T, code: AppMessageCode, params?: MessageParams): string {
  return WORDING[code](t, params)
}

/**
 * What to show for a result that came back from the main process.
 *
 * A failure's code is the sentence itself; when the tool also said something, that text follows
 * after a colon. A success's code is a note **added** to the tool's line (` · пропущено уже
 * закоммиченных: 2`), because that is how the main process appends it. `fallback` is what to say
 * when the result carries neither a code nor any text of its own.
 */
export function resultMessage(t: T, res: CodedResult, fallback = ''): string {
  const own = (res.error ?? res.warning ?? '').trim()
  if (!res.code) return (res.ok ? firstLine(res.output) : '') || own || fallback
  const sentence = appMessage(t, res.code, res.params)
  const message = res.ok ? (firstLine(res.output) + sentence).trim() : sentence
  return own ? t('git.error.withDetail', { message, detail: own }) : message
}

/**
 * One git call, reported.
 *
 * Every git action in the UI had the same six steps copied around it: mark busy, say what is
 * happening, run, turn the answer into either an error or a result message, clear that message
 * after a while, re-read what changed. Seven copies had drifted apart — three different clear
 * delays, and two of them let a rejected promise leave the button disabled and «…» on screen
 * forever, because they had no try/finally.
 *
 * The reporters are arguments rather than context: these components already receive `onError`
 * and `onInfo` as props, and which status line they write to is the parent's decision.
 */
export function useGitAction({ onError, onInfo, onRefresh }: Reporters): GitActionHandle {
  const [running, setRunning] = useState<string | null>(null)
  const t = useT()
  const latest = useRef({ onError, onInfo, onRefresh, t })
  // written after the commit, not during render: a ref mutated while rendering does not
  // survive a render React decides to throw away
  useEffect(() => {
    latest.current = { onError, onInfo, onRefresh, t }
  })

  /**
   * Pending clear of the status line. Deliberately not cancelled on unmount: a window that
   * closes on success (push) still has to take its own message down afterwards. It is
   * cancelled when the next action starts, so a stale clear cannot wipe a fresher message.
   */
  const clearTimer = useRef(0)

  const run = useCallback(async (label: string, fn: () => Promise<GitActionResult>, options: RunOptions = {}) => {
    const { onError, onInfo, onRefresh, t } = latest.current
    window.clearTimeout(clearTimer.current)
    setRunning(label)
    onInfo(t('git.run.progress', { label }))
    try {
      const res = await fn()
      onInfo(null)
      if (!res.ok) {
        // the app's own refusals arrive as a code and are worded here; git's own text passes through
        const error = resultMessage(t, res, t('git.run.failed', { label }))
        if (!options.onFail?.(error)) onError(error)
        return res
      }
      onInfo(options.done?.(res) || resultMessage(t, res) || t('git.run.done', { label }))
      clearTimer.current = window.setTimeout(() => onInfo(null), CLEAR_MS)
      onRefresh?.()
      return res
    } catch (e) {
      // a rejected call must not leave the button disabled and «…» hanging on screen
      onInfo(null)
      onError(t('git.run.crashed', { label, error: String(e) }))
      return null
    } finally {
      setRunning(null)
    }
  }, [])

  return { running, busy: running !== null, run }
}
