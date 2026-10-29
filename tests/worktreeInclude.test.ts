import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyWorktreeInclude, heavyAllowed, includePatterns, isSafeEntry } from '../src/main/git/worktreeInclude'

describe('entry checks', () => {
  it('refuses absolute paths, `..`, and anything inside .git', () => {
    expect(isSafeEntry('.env')).toBe(true)
    expect(isSafeEntry('secret/')).toBe(true)
    expect(isSafeEntry('/etc/passwd')).toBe(false)
    expect(isSafeEntry('../outside')).toBe(false)
    expect(isSafeEntry('a/../../b')).toBe(false)
    expect(isSafeEntry('.git/config')).toBe(false)
    expect(isSafeEntry('')).toBe(false)
  })

  it('enters a heavy directory only when a pattern names it', () => {
    const broad = includePatterns('# local\n.env*\n\n')
    expect(broad).toEqual(['.env*'])
    expect(heavyAllowed('.env', broad)).toBe(true)
    expect(heavyAllowed('node_modules/pkg/.env', broad)).toBe(false)
    expect(heavyAllowed('node_modules/', ['/node_modules/'])).toBe(true)
    expect(heavyAllowed('web/node_modules/', ['web/node_modules'])).toBe(true)
  })
})

describe('copying into a new worktree', () => {
  let dir = ''
  let repo = ''
  let tree = ''
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
  const run = (...args: string[]): string => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' })
  const write = (rel: string, text: string): void => {
    mkdirSync(join(repo, rel, '..'), { recursive: true })
    writeFileSync(join(repo, rel), text)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cs-include-'))
    repo = join(dir, 'repo')
    mkdirSync(repo)
    run('init', '-q', '-b', 'main')
    write('.gitignore', '.env\n.env.*\nsecret/\nnode_modules/\n.worktrees/\nnotes-ignored.txt\n')
    write('config.json', '{"tracked":true}\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
    // what lives only in the root checkout
    write('.env', 'TOKEN=1\n')
    write('secret/key.pem', 'k\n')
    write('node_modules/pkg/.env', 'nested\n')
    write('notes.txt', 'untracked, not ignored\n')
    write('config.json', '{"tracked":"edited"}\n')
    writeFileSync(join(dir, 'outside.txt'), 'outside\n')
    symlinkSync(join(dir, 'outside.txt'), join(repo, '.env.link'))
    write('.worktreeinclude', '.env\n.env.*\nsecret/\nnotes.txt\nconfig.json\n**/.env\n')
    tree = join(repo, '.worktrees', 'wt')
    run('worktree', 'add', '-q', '-b', 'wt', tree)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('copies what is listed and ignored, and nothing else', async () => {
    const res = await copyWorktreeInclude(repo, tree)
    expect(readFileSync(join(tree, '.env'), 'utf8')).toBe('TOKEN=1\n')
    expect(readFileSync(join(tree, 'secret', 'key.pem'), 'utf8')).toBe('k\n')
    // tracked: the worktree keeps the committed version, not the root's edit
    expect(readFileSync(join(tree, 'config.json'), 'utf8')).toBe('{"tracked":true}\n')
    // untracked but not ignored: the list alone does not make it eligible
    expect(existsSync(join(tree, 'notes.txt'))).toBe(false)
    // inside node_modules, which the list never names
    expect(existsSync(join(tree, 'node_modules'))).toBe(false)
    // a link is copied as the link, not through it
    expect(lstatSync(join(tree, '.env.link')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(tree, '.env.link'))).toBe(join(dir, 'outside.txt'))
    expect(res.copied).toBe(3)
    expect(res.skipped).toBeGreaterThan(0)
  })

  it('never overwrites what the worktree already has, and never copies another worktree', async () => {
    writeFileSync(join(tree, '.env'), 'mine\n')
    // a second worktree under the same ignored directory, with a listed file of its own
    const other = join(repo, '.worktrees', 'other')
    run('worktree', 'add', '-q', '-b', 'other', other)
    writeFileSync(join(other, '.env'), 'other\n')
    await copyWorktreeInclude(repo, tree)
    expect(readFileSync(join(tree, '.env'), 'utf8')).toBe('mine\n')
    expect(existsSync(join(tree, '.worktrees'))).toBe(false)
  })

  it('does nothing without a list', async () => {
    rmSync(join(repo, '.worktreeinclude'))
    expect(await copyWorktreeInclude(repo, tree)).toEqual({ copied: 0, skipped: 0 })
    expect(existsSync(join(tree, '.env'))).toBe(false)
  })
})
