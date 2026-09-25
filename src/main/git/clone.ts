/** clone: the repository address is typed by a person, so the check comes first and the spawn after. */
import { basename, join } from 'node:path'
import type { AppMessage, OpResult } from '../../shared/types'
import { fail, git, refuse } from './exec'

const CLONE_SCHEMES = ['https', 'http', 'ssh', 'git']

/**
 * The address is pasted by a person, and git accepts far more than a URL here: `ext::sh -c …`
 * makes it run a shell command, any `<helper>::<address>` picks a remote helper, and a string
 * starting with `-` is read as an option — `--upload-pack=<command>` runs that command too.
 * So only ordinary transports get through; everything else is rejected before the spawn.
 */
function cloneUrlError(url: string): AppMessage | null {
  if (!url) return { code: 'clone-url-empty' }
  if (url.startsWith('-')) return { code: 'clone-url-leading-dash' }
  if (/^[a-z][a-z0-9+.-]*::/i.test(url)) return { code: 'clone-url-helper' }
  // the group cannot be empty when the pattern matches, so a scheme here is always a real one
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)?.[1]
  if (scheme) {
    if (CLONE_SCHEMES.includes(scheme.toLowerCase())) return null
    return { code: 'clone-url-scheme', params: { scheme } }
  }
  if (url.startsWith('/')) return null // local repository
  // scp-style `host:path`, with or without a user: `git@github.com:u/r`, `github.com:u/r`.
  // The `<helper>::` form is already rejected above, so a single colon here is safe.
  if (/^[^/\s:]+:(?!:)/.test(url)) return null
  return { code: 'clone-url-unrecognised' }
}

export async function clone(url: string, parentDir: string, name?: string): Promise<OpResult & { path?: string }> {
  const src = url.trim()
  const bad = cloneUrlError(src)
  if (bad) return refuse(bad)
  const target = join(parentDir, name || basename(src.replace(/\.git$/, '')))
  // `--` stays even after the check: the target directory must not be read as an option either
  const r = await git(parentDir, ['clone', '--', src, target], 900_000)
  if (r.code !== 0) return fail(r)
  return { ok: true, path: target }
}
