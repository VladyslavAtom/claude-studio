/**
 * What a new session is called, forks into and lives in when nobody has typed anything.
 *
 * These were the new-session window's own helpers. They moved here because a session is now
 * opened from two places — the window, and an agent asking for one through its tool
 * (`main/agentTools`) — and a second copy of the naming would have drifted away from the first
 * at the next edit: the branch of a session an agent opened must read like the branch of one the
 * person opened.
 */
import { join, slugify } from './util'

/** branch name from the first words of the task: the only meaningful text the window holds */
export function branchFromTask(task: string): string | null {
  const slug = slugify(task.split(/[.!?\n]/)[0] ?? '')
  if (!slug) return null
  const short = slug.split('-').filter(Boolean).slice(0, 5).join('-')
  return short.length >= 3 ? short : null
}

/** the fallback when neither the name nor the task says anything a branch can be made of */
export function stamp(now = new Date()): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
}

/**
 * «Session 1» means nothing in a branch name, so the task is what names the branch; a name the
 * person typed over outranks it, and the date is the last resort.
 *
 * `taken` is the repository's own branches plus the branches other worktrees hold: git would
 * refuse a name that is already there, and the person would have to type another one.
 */
export function autoBranch(vars: { name: string | null; task: string }, taken: ReadonlySet<string>): string {
  const typed = vars.name ? slugify(vars.name) : ''
  const base = typed || branchFromTask(vars.task) || stamp()
  let candidate = `claude/${base}`
  for (let i = 2; taken.has(candidate); i++) candidate = `claude/${base}-${i}`
  return candidate
}

/** where a session's worktree goes: inside the project, named after the branch without its prefix */
export function worktreePathFor(projectPath: string, branch: string): string {
  return join(projectPath, '.worktrees', slugify(branch.replace(/^claude\//, '')))
}
