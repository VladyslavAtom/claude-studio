/**
 * The draft of a commit message. It lives next to `serviceAgent.ts` rather than in the git
 * layer: this is the launch of an arbitrary user CLI (a one-off process, the diff on stdin, the
 * answer on stdout or in a temporary file) — the same task the service session has, only over a
 * different transport. All that is needed from git here is the diff of the selected files.
 *
 * Spawn is its own on purpose: `run()` in git/exec is for git and gh (buffer policy by
 * subcommand, cleaned git environment), while this one needs the agent environment and feeds
 * the diff through stdin.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CommitDraftConfig, Coded } from '../shared/types'
import { cleanAgentEnv } from './env'
import { BUFFER_SMALL, git, literal, literals } from './git/exec'

/**
 * The diff of the selected paths for the draft message. Exactly what the panel shows is taken:
 * in «vs base» mode the edits may already be committed, and `git diff HEAD` is then empty.
 */
async function diffForMessage(cwd: string, files: string[], ref = 'HEAD'): Promise<string> {
  const tracked = await git(cwd, ['diff', ref, '--', ...literals(files)])
  let out = tracked.stdout
  for (const file of files) {
    const known = await git(cwd, ['ls-files', '--error-unmatch', '--', literal(file)])
    if (known.code === 0) continue
    const untracked = await git(cwd, ['diff', '--no-index', '--', '/dev/null', join(cwd, file)])
    out += untracked.stdout
  }
  return out
}

export async function draftCommitMessage(
  cwd: string,
  files: string[],
  cfg: CommitDraftConfig,
  ref = 'HEAD',
): Promise<Coded & { ok: boolean; message?: string; error?: string }> {
  let diff = await diffForMessage(cwd, files, ref)
  if (!diff.trim() && ref !== 'HEAD') diff = await diffForMessage(cwd, files, 'HEAD')
  if (!diff.trim()) {
    // HEAD is a git object and stays HEAD in every locale; the sentence around it is the renderer's
    return { ok: false, code: 'draft-no-changes', ...(ref === 'HEAD' ? {} : { params: { ref } }) }
  }
  // this marker goes into the diff handed to the model, not on screen: it is part of the prompt
  // payload and deliberately follows no interface locale
  const capped = diff.length > 60_000 ? diff.slice(0, 60_000) + '\n… (diff truncated)' : diff

  return new Promise((resolve) => {
    // tools like codex write their own log to stdout, so an answer in a file is accepted too
    const outfile = cfg.args.some((a) => a.includes('{outfile}'))
      ? join(tmpdir(), `cs-commit-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
      : null
    const args = cfg.args.map((a) => a.replace('{outfile}', outfile ?? ''))

    const child = execFile(
      cfg.command,
      [...args, cfg.prompt],
      { cwd, maxBuffer: BUFFER_SMALL, timeout: cfg.timeoutMs ?? 60_000, env: { ...cleanAgentEnv(), ...cfg.env } },
      async (err, stdout, stderr) => {
        let text = (stdout ?? '').trim()
        if (outfile) {
          try {
            text = (await fs.readFile(outfile, 'utf8')).trim()
          } catch {
            /* the tool did not create the file */
          }
          void fs.rm(outfile, { force: true })
        }
        if (text) return resolve({ ok: true, message: text })
        // the CLI's own complaint travels verbatim; «it said nothing at all» is ours to name
        const said = (stderr || (err ? String(err) : '')).trim()
        resolve(said ? { ok: false, error: said } : { ok: false, code: 'draft-empty-answer' })
      },
    )
    child.stdin?.end(capped)
  })
}
