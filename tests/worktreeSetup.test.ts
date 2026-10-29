import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isTrusted, trustWorktree, withTrustedWorktree } from '../src/main/claudeTrust'
import {
  hashConfig,
  isApproved,
  parseScriptsConfig,
  readScriptsConfig,
  recordApproval,
  runTeardown,
} from '../src/main/worktreeScripts'
import {
  PORT_BASE,
  PORT_BLOCK,
  setupCommandLine,
  withWorktreeEnv,
  worktreeEnv,
  worktreePort,
} from '../src/shared/worktreeSetup'

describe('the port block', () => {
  it('is stable for a path, inside 50000..59990, and a multiple of the block', () => {
    const port = worktreePort('/home/u/repo/.worktrees/feature')
    expect(worktreePort('/home/u/repo/.worktrees/feature')).toBe(port)
    expect(port).toBeGreaterThanOrEqual(PORT_BASE)
    expect(port).toBeLessThanOrEqual(PORT_BASE + 999 * PORT_BLOCK)
    expect((port - PORT_BASE) % PORT_BLOCK).toBe(0)
    expect(worktreePort('/home/u/repo/.worktrees/other')).not.toBe(port)
  })

  it('names the worktree, its root and branch; the tab’s own env wins', () => {
    const wt = { path: '/r/.worktrees/x', branch: 'claude/x', baseRef: 'main' }
    expect(worktreeEnv('/r', wt)).toEqual({
      CLAUDE_STUDIO_PORT: String(worktreePort('/r/.worktrees/x')),
      CLAUDE_STUDIO_PORT_COUNT: '10',
      CLAUDE_STUDIO_WORKTREE: '/r/.worktrees/x',
      CLAUDE_STUDIO_ROOT: '/r',
      CLAUDE_STUDIO_BRANCH: 'claude/x',
    })
    expect(withWorktreeEnv({ CLAUDE_STUDIO_PORT: '3000' }, '/r', wt)?.CLAUDE_STUDIO_PORT).toBe('3000')
    expect(withWorktreeEnv(undefined, '/r', undefined)).toBeUndefined()
  })

  it('quotes the setup script as one shell word', () => {
    const line = setupCommandLine(`echo 'hi' && touch "$CLAUDE_STUDIO_WORKTREE/x"`)
    expect(line.startsWith('exec sh -c ')).toBe(true)
    const out = execFileSync('sh', ['-c', line.replace(/^exec /, '') + ' ; echo done'], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_STUDIO_WORKTREE: tmpdir() },
    })
    expect(out).toBe('hi\ndone\n')
  })
})

describe('the scripts config', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cs-scripts-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('takes non-empty strings and ignores the rest', () => {
    expect(parseScriptsConfig('{"scripts":{"setup":"npm ci","teardown":"","run":"x"}}')).toEqual({ setup: 'npm ci' })
    expect(parseScriptsConfig('{}')).toEqual({})
    expect(() => parseScriptsConfig('[]')).toThrow()
  })

  it('reads none, invalid, or the scripts with the hash of the file', async () => {
    expect((await readScriptsConfig(dir)).kind).toBe('none')
    writeFileSync(join(dir, '.claude-studio.json'), '{ broken')
    expect((await readScriptsConfig(dir)).kind).toBe('invalid')
    const text = '{"scripts":{"setup":"npm ci"}}'
    writeFileSync(join(dir, '.claude-studio.json'), text)
    expect(await readScriptsConfig(dir)).toEqual({ kind: 'ok', config: { setup: 'npm ci' }, hash: hashConfig(text) })
  })

  it('keeps approvals per repository and per hash', async () => {
    const file = join(dir, 'state', 'approved.json')
    expect(await isApproved(file, '/r', 'h1')).toBe(false)
    await recordApproval(file, '/r', 'h1')
    expect(await isApproved(file, '/r', 'h1')).toBe(true)
    expect(await isApproved(file, '/r', 'h2')).toBe(false)
    expect(await isApproved(file, '/other', 'h1')).toBe(false)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('reports a failing teardown, and does not run one for a directory that is gone', async () => {
    const failed = await runTeardown(dir, 'echo boom >&2; exit 3', {})
    expect(failed).toEqual({
      code: 'worktree-teardown-failed',
      params: { reason: 'exit', exit: 3 },
      detail: 'boom',
    })
    expect(await runTeardown(dir, 'true', {})).toBeNull()
    expect(await runTeardown(join(dir, 'gone'), 'exit 1', {})).toBeNull()
  })
})

describe('trust in .claude.json', () => {
  it('follows the root up its parents, and leaves an untrusted root alone', () => {
    const config = { projects: { '/home/u': { hasTrustDialogAccepted: true } } }
    expect(isTrusted(config, '/home/u/repo')).toBe(true)
    expect(isTrusted(config, '/srv/repo')).toBe(false)
    expect(withTrustedWorktree(config, ['/srv/repo'], '/srv/repo/.worktrees/x')).toBeNull()
  })

  it('adds the one key and keeps everything else, the worktree’s own entry included', () => {
    const config = {
      numStartups: 7,
      projects: {
        '/r': { hasTrustDialogAccepted: true, allowedTools: ['a'] },
        '/r/.worktrees/x': { lastCost: 1 },
      },
    }
    expect(withTrustedWorktree(config, ['/r'], '/r/.worktrees/x')).toEqual({
      numStartups: 7,
      projects: {
        '/r': { hasTrustDialogAccepted: true, allowedTools: ['a'] },
        '/r/.worktrees/x': { lastCost: 1, hasTrustDialogAccepted: true },
      },
    })
  })

  describe('on disk', () => {
    let dir = ''
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'cs-trust-'))
      mkdirSync(join(dir, 'repo', '.worktrees', 'x'), { recursive: true })
    })
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it('writes the worktree when the root is trusted, then has nothing more to do', async () => {
      const root = join(dir, 'repo')
      const tree = join(root, '.worktrees', 'x')
      const file = join(dir, '.claude.json')
      writeFileSync(file, JSON.stringify({ keep: true, projects: { [root]: { hasTrustDialogAccepted: true } } }))
      expect(await trustWorktree(file, root, tree)).toBe('trusted')
      const written = JSON.parse(readFileSync(file, 'utf8'))
      expect(written.keep).toBe(true)
      expect(written.projects[tree]).toEqual({ hasTrustDialogAccepted: true })
      expect(await trustWorktree(file, root, tree)).toBe('already')
    })

    it('never touches a file it cannot parse, nor one where the root is untrusted', async () => {
      const root = join(dir, 'repo')
      const tree = join(root, '.worktrees', 'x')
      const file = join(dir, '.claude.json')
      writeFileSync(file, '{ half a fi')
      expect(await trustWorktree(file, root, tree)).toBe('unreadable')
      expect(readFileSync(file, 'utf8')).toBe('{ half a fi')
      writeFileSync(file, '{"projects":{}}')
      expect(await trustWorktree(file, root, tree)).toBe('root-untrusted')
      expect(readFileSync(file, 'utf8')).toBe('{"projects":{}}')
      expect(await trustWorktree(join(dir, 'missing.json'), root, tree)).toBe('root-untrusted')
    })
  })
})
