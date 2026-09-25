/**
 * GitHub CLI. Not part of the git layer: `gh` is a separate tool with its own auth and its own
 * failure modes, and only the spawn wrapper is shared with git — without the cleaned
 * environment a GIT_DIR left by an agent terminal would point «gh pr create» at another repo.
 */
import type { OpResult } from '../shared/types'
import { cleanGitEnv } from './env'
import { fail, refuse, run } from './git/exec'

export async function createPullRequest(
  cwd: string,
  title: string,
  body: string,
  baseRef: string,
): Promise<OpResult & { url?: string }> {
  const args = ['pr', 'create', '--fill', '--base', baseRef]
  if (title) args.push('--title', title)
  if (body) args.push('--body', body)
  // gh goes through the same runner as git: without the cleaned environment a GIT_DIR left by
  // an agent terminal would point «gh pr create» at another repository
  const r = await run('gh', cwd, args, 300_000, cleanGitEnv())
  const url = r.stdout
    .trim()
    .split('\n')
    .find((l) => l.startsWith('http'))
  if (url) return { ok: true, url }
  // gh's own complaint when it made one; otherwise all we know is that no URL came back
  const failed = fail(r)
  return failed.error || failed.code ? failed : refuse({ code: 'pr-create-no-url' })
}
