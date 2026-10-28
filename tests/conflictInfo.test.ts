import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { conflictInfo } from '../src/main/git/state'

let dir = ''
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('re-merges the stages with their base inside a linked worktree', async () => {
  dir = mkdtempSync(join(tmpdir(), 'cs-conflict-'))
  const repo = join(dir, 'repo')
  const wt = join(dir, 'wt')
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  const sh = (cwd: string, ...args: string[]): void => {
    execFileSync('git', args, { cwd, env, stdio: 'pipe' })
  }
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env })
  writeFileSync(join(repo, 'f'), 'a\nlimit = 100\nz\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-qm', 'base')
  sh(repo, 'worktree', 'add', '-q', '-b', 'side', wt)
  writeFileSync(join(wt, 'f'), 'a\nlimit = 300\nz\n')
  sh(wt, 'commit', '-qam', 'side')
  writeFileSync(join(repo, 'f'), 'a\nlimit = 120\nz\n')
  sh(repo, 'commit', '-qam', 'main')
  expect(() => sh(wt, 'merge', 'main')).toThrow()

  const info = await conflictInfo(wt, 'f')
  expect(info.operation).toBe('merge')
  expect(info.diff3).toMatch(/limit = 300\n\|{7}[^\n]*\nlimit = 100\n={7}\nlimit = 120\n/)
})
