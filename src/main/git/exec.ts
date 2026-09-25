/**
 * The single spawn point of the git layer, plus the pathspec quoting every caller depends on.
 *
 * Two invariants hold across the whole `src/main/git` module, and both are load-bearing:
 *
 *  1. Every spawn goes through `run()` here — never a fresh `execFile` next to the call site.
 *     Only this function applies the buffer policy, the timeout and the cleaned environment;
 *     a hand-rolled spawn inherits GIT_DIR/GIT_WORK_TREE from the surrounding agent terminal
 *     and silently retargets another repository.
 *  2. Every user-supplied path goes through `literal()` (or `literals()`) at every pathspec
 *     position. Git reads path arguments as globs, so an unquoted name reverts or commits
 *     files nobody selected.
 */
import { execFile } from 'node:child_process'
import type { AppMessage, Coded } from '../../shared/types'
import { cleanGitEnv } from '../env'

/**
 * The output limit of a single command. The buffer is held in memory for every process that
 * runs, and status polls go often and in batches, so the large allowance goes only to what
 * really prints a patch: diff, show and a log with `-p`. The rest (status, log, rev-list,
 * for-each-ref, worktree list) get by on the small limit.
 */
export const BUFFER_SMALL = 8 * 1024 * 1024
export const BUFFER_LARGE = 64 * 1024 * 1024

const PATCH_COMMANDS = new Set(['diff', 'show', 'format-patch', 'cat-file'])

/** first non-flag in argv: the subcommand, used for buffer choice and error messages */
function subcommandOf(args: string[]): string {
  return args.find((a) => !a.startsWith('-')) ?? ''
}

function maxBufferFor(args: string[]): number {
  const sub = subcommandOf(args)
  if (sub && PATCH_COMMANDS.has(sub)) return BUFFER_LARGE
  if (args.some((a) => a === '-p' || a === '--patch')) return BUFFER_LARGE
  return BUFFER_SMALL
}

export interface GitRunResult {
  stdout: string
  stderr: string
  code: number
  /** set when the process never ran to completion */
  problem?: 'spawn' | 'timeout' | 'maxbuffer'
  /**
   * Why it never ran, in the app's own words. The wording lives in the renderer: this side
   * cannot know the locale, and `stderr` here is either empty or holds git's own text, which is
   * passed through untranslated.
   */
  message?: AppMessage
}

/**
 * One spawn point for git and gh. Everything goes through it so that the buffer policy, the
 * timeout and the cleaned environment stay the same everywhere: a hand-rolled execFile next
 * to it inherits GIT_DIR/GIT_WORK_TREE from the surrounding agent terminal and silently
 * retargets another repository.
 */
export function run(
  command: string,
  cwd: string,
  args: string[],
  timeout: number,
  env: Record<string, string>,
): Promise<GitRunResult> {
  const maxBuffer = maxBufferFor(args)
  const sub = subcommandOf(args) || command
  return new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer, timeout, env }, (err, stdout, stderr) => {
      const outText = stdout ?? ''
      const errOut = (stderr ?? '').trim()
      const code = (err as { code?: unknown } | null)?.code
      // node cuts a buffer overflow short silently: stdout arrives truncated and the code
      // arrives as an ordinary error. Such a «result» must not be parsed, so it is said outright
      if (err && code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        const limitMb = Math.round(maxBuffer / (1024 * 1024))
        return resolve({
          stdout: '',
          stderr: '',
          code: 1,
          problem: 'maxbuffer',
          message: { code: 'git-output-too-large', params: { command, sub, limitMb } },
        })
      }
      // A process that failed to spawn or was killed by node has no exit code at all: `code`
      // is a string (ENOENT) or null, and stderr is empty. Falling through to `err ? 1 : 0`
      // would hand the caller code 1 with nothing to show — a blank toast.
      if (err && typeof code !== 'number') {
        const killed = (err as { killed?: boolean }).killed === true
        const message: AppMessage = killed
          ? { code: 'git-timeout', params: { command, sub, seconds: Math.round(timeout / 1000) } }
          : code === 'ENOENT'
            ? { code: 'git-not-found', params: { command, sub } }
            : {
                code: 'git-spawn-failed',
                params: { command, sub, reason: typeof code === 'string' ? code : err.message },
              }
        return resolve({ stdout: outText, stderr: errOut, code: 1, problem: killed ? 'timeout' : 'spawn', message })
      }
      resolve({ stdout: outText, stderr: stderr ?? '', code: err ? (code as number) : 0 })
    })
  })
}

/** `env` adds to the cleaned environment, it does not replace it */
export function git(
  cwd: string,
  args: string[],
  timeout = 120_000,
  env?: Record<string, string>,
): Promise<GitRunResult> {
  return run('git', cwd, args, timeout, { ...cleanGitEnv(), GIT_OPTIONAL_LOCKS: '0', ...env })
}

/**
 * Git reads every path argument as a pathspec, and a pathspec is a glob: `a[1].txt` matches
 * `a1.txt` too. The paths here are file names a person ticked in the panel, so each one goes
 * through this — otherwise reverting one file discards another file's uncommitted work and a
 * commit picks up files nobody selected.
 *
 * Limit: the paths still travel in argv, so a very long selection (tens of thousands of files)
 * can hit the exec limit. `--pathspec-from-file` would lift it, but neither `diff` nor `clean`
 * accepts that option, so the two commands most exposed here would keep the limit anyway.
 */
export const literal = (path: string): string => `:(literal)${path}`
export const literals = (paths: string[]): string[] => paths.map(literal)

/** failure text: git writes it to stderr, but some subcommands report it on stdout */
export const errText = (r: GitRunResult): string => (r.stderr || r.stdout).trim()

/**
 * A failed call, ready to be returned. Two things can be wrong at once and they are kept apart:
 * git's own complaint travels verbatim in `error` (English plumbing — untranslatable, and worth
 * showing exactly as printed), while anything this application had to say about the failure
 * travels as a `code` the renderer puts into words. A spawn that never happened has only the
 * code; an ordinary non-zero exit has only the text.
 */
export function fail(r: GitRunResult): { ok: false } & Coded & { error?: string } {
  const text = errText(r)
  return { ok: false, ...(text ? { error: text } : {}), ...(r.message ?? {}) }
}

/** the same, for an app-authored refusal with no tool output behind it at all */
export const refuse = (message: AppMessage): { ok: false } & Coded => ({ ok: false, ...message })

/** git's closing line of output («Fast-forward», «1 file changed …»); empty when it printed nothing */
export const lastLine = (text: string): string => text.trim().split('\n').at(-1) ?? ''
