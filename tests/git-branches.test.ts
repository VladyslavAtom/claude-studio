import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { askToStash, checkout, createBranch, dirtyTreeRefusal } from '../src/main/git/branches'
import { commit } from '../src/main/git/commit'

describe('dirtyTreeRefusal', () => {
  it('recognises the refusals of checkout, merge and rebase over uncommitted edits', () => {
    expect(
      dirtyTreeRefusal('error: Your local changes to the following files would be overwritten by checkout:\n\tf'),
    ).toBe(true)
    expect(
      dirtyTreeRefusal('error: Your local changes to the following files would be overwritten by merge:\n\tf'),
    ).toBe(true)
    expect(dirtyTreeRefusal('error: cannot rebase: You have unstaged changes.')).toBe(true)
    expect(dirtyTreeRefusal('error: cannot rebase: Your index contains uncommitted changes.')).toBe(true)
  })

  it('leaves untracked files in the way and other failures alone: a stash would not help', () => {
    expect(
      dirtyTreeRefusal('error: The following untracked working tree files would be overwritten by checkout:'),
    ).toBe(false)
    expect(dirtyTreeRefusal("error: pathspec 'nope' did not match any file(s) known to git")).toBe(false)
  })
})

describe('askToStash', () => {
  it('turns a dirty-tree refusal into a code, and passes everything else through', () => {
    const dirty = { ok: false, error: 'error: cannot rebase: You have unstaged changes.' }
    expect(askToStash(dirty, 'rebase', 'main')).toEqual({
      ok: false,
      code: 'dirty-tree',
      params: { operation: 'rebase', ref: 'main' },
    })
    const other = { ok: false, error: 'fatal: invalid upstream' }
    expect(askToStash(other, 'rebase', 'main')).toBe(other)
  })
})

describe('in a repository', () => {
  let dir = ''
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
  const sh = (...args: string[]): string => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cs-branches-'))
    sh('init', '-q', '-b', 'main')
    sh('config', 'user.name', 't')
    sh('config', 'user.email', 't@t')
    writeFileSync(join(dir, 'f'), 'a\n')
    writeFileSync(join(dir, 'g'), 'x\n')
    sh('add', '.')
    sh('commit', '-qm', 'a')
    sh('checkout', '-qb', 'other')
    writeFileSync(join(dir, 'f'), 'b\n')
    sh('commit', '-qam', 'b')
    sh('checkout', '-q', 'main')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('checkout over a conflicting edit asks first, and with autostash brings the edit along', async () => {
    writeFileSync(join(dir, 'g'), 'mine\n')
    writeFileSync(join(dir, 'f'), 'c\n')
    expect(await checkout(dir, 'other')).toMatchObject({ ok: false, code: 'dirty-tree' })

    // the edit to g does not touch the branch difference; the one to f does, and conflicts
    const res = await checkout(dir, 'other', true)
    expect(res).toEqual({ ok: true, code: 'autostash-conflict' })
    expect(sh('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('other')
    expect(readFileSync(join(dir, 'g'), 'utf8')).toBe('mine\n')
    expect(sh('stash', 'list')).toContain('claude-studio autostash')
  })

  it('checkout with autostash and no conflict leaves the stash list as it was', async () => {
    writeFileSync(join(dir, 'g'), 'mine\n')
    expect(await checkout(dir, 'other', true)).toEqual({ ok: true })
    expect(readFileSync(join(dir, 'g'), 'utf8')).toBe('mine\n')
    expect(sh('stash', 'list')).toBe('')
  })

  it('refuses a branch name that git would read as an option', async () => {
    expect(await createBranch(dir, '-x')).toEqual({ ok: false, code: 'ref-leading-dash', params: { ref: '-x' } })
  })

  it('a commit rejected by a hook leaves the index as it was', async () => {
    writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho rejected >&2\nexit 1\n')
    chmodSync(join(dir, '.git', 'hooks', 'pre-commit'), 0o755)
    writeFileSync(join(dir, 'f'), 'c\n')
    const res = await commit(dir, ['f'], 'msg')
    expect(res).toMatchObject({ ok: false, code: 'commit-failed', error: 'rejected' })
    expect(sh('diff', '--cached', '--name-only')).toBe('')
    expect(sh('status', '--porcelain')).toBe(' M f\n')
  })
})
