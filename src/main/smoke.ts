/**
 * Dev smoke check: exercises the git/worktree/diff path against a throwaway repo and
 * verifies the renderer actually painted. Enabled only with CS_SMOKE=1.
 */
import { app, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as git from './git'
import * as ptys from './pty'
import { listExternalSessions, sessionExists, sessionTitle } from './agentSessions'

/** waits for a match to show up in the terminal buffer; hands back whatever it has once the time is up */
function waitForOutput(id: string, re: RegExp, ms: number): Promise<string> {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms
    const timer = setInterval(() => {
      const acc = ptys.bufferOf(id)
      if (re.test(acc) || Date.now() > deadline) {
        clearInterval(timer)
        resolve(acc)
      }
    }, 100)
  })
}

export async function runSmoke(win: BrowserWindow): Promise<void> {
  const log = (...a: unknown[]): void => console.log('[smoke]', ...a)
  const repo = join(tmpdir(), `cs-smoke-${process.pid}`)

  await fs.mkdir(repo, { recursive: true })
  await git.git(repo, ['init', '-q', '-b', 'main'])
  await git.git(repo, ['config', 'user.email', 'smoke@test'])
  await git.git(repo, ['config', 'user.name', 'Smoke'])
  await fs.writeFile(join(repo, 'a.txt'), 'line1\nline2\n')
  await git.git(repo, ['add', '-A'])
  await git.git(repo, ['commit', '-qm', 'init'])

  log('repoRoot:', await git.repoRoot(repo))
  log('branch:', await git.currentBranch(repo))

  const wtPath = join(repo, '.worktrees', 'feature')
  const added = await git.addWorktree({
    repoPath: repo,
    worktreePath: wtPath,
    branch: 'claude/feature',
    baseRef: 'main',
  })
  log('worktreeAdd:', JSON.stringify(added))

  // committed change + working change + untracked file inside the worktree
  await fs.writeFile(join(wtPath, 'a.txt'), 'line1\nline2 changed\n')
  await git.git(wtPath, ['commit', '-aqm', 'edit a'])
  await fs.writeFile(join(wtPath, 'a.txt'), 'line1\nline2 changed\nline3\n')
  await fs.writeFile(join(wtPath, 'new.txt'), 'brand new\n')

  const working = await git.status(wtPath, 'working')
  log('status working:', JSON.stringify(working.files))
  const base = await git.status(wtPath, 'base', 'main')
  log('status base:', JSON.stringify(base.files), 'ahead', base.ahead, 'behind', base.behind)

  const d1 = await git.fileDiff(wtPath, 'a.txt', 'base', 'main', false)
  log('diff a.txt (base) lines:', d1.split('\n').length, '| has +line3:', d1.includes('+line3'))
  const d2 = await git.fileDiff(wtPath, 'new.txt', 'working', undefined, true)
  log('diff new.txt (untracked) has +brand new:', d2.includes('+brand new'))

  // commit-message draft: stand-in command that echoes instead of calling a real agent
  const draft = await git.draftCommitMessage(wtPath, ['a.txt', 'new.txt'], {
    command: 'sh',
    args: ['-c', 'cat > /dev/null; echo "feat: smoke message"'],
    env: {},
    prompt: 'ignored',
  })
  log('draftCommitMessage:', JSON.stringify(draft))

  // the answer in a file: that is how codex exec works, its stdout being taken up by a log
  const viaFile = await git.draftCommitMessage(wtPath, ['a.txt', 'new.txt'], {
    command: 'sh',
    args: ['-c', 'cat > /dev/null; echo "через файл" > "$1"', 'sh', '{outfile}'],
    env: {},
    prompt: 'ignored',
  })
  log('draftCommitMessage через {outfile}:', JSON.stringify(viaFile))

  const committed = await git.commit(wtPath, ['a.txt', 'new.txt'], 'feat: smoke message')
  log('commit:', JSON.stringify(committed))
  const afterCommit = await git.status(wtPath, 'working')
  log('status after commit:', JSON.stringify(afterCommit.files))

  await fs.writeFile(join(wtPath, 'a.txt'), 'line1\nline2 changed\nline3\nline4\n')
  await fs.writeFile(join(wtPath, 'scratch.txt'), 'temp\n')
  const reverted = await git.revertFiles(wtPath, ['a.txt', 'scratch.txt'])
  const afterRevert = await git.status(wtPath, 'working')
  log('revertFiles:', JSON.stringify(reverted), '| dirty after revert:', JSON.stringify(afterRevert.files))

  // draft-base: the description of changes that are already committed is taken against the base
  const draftBase = await git.draftCommitMessage(
    wtPath,
    ['a.txt'],
    { command: 'sh', args: ['-c', 'wc -c | tr -d " \n"'], env: {}, prompt: 'ignored' },
    'main',
  )
  log('draft-base (файл закоммичен, режим vs base):', JSON.stringify(draftBase))
  const draftHead = await git.draftCommitMessage(
    wtPath,
    ['a.txt'],
    { command: 'sh', args: ['-c', 'wc -c | tr -d " \n"'], env: {}, prompt: 'ignored' },
    'HEAD',
  )
  log('draft-head (тот же файл, режим vs HEAD):', JSON.stringify(draftHead))

  // commit-base: the «vs base» list holds a path that is already committed — it must not sink the commit
  await fs.mkdir(join(wtPath, 'docs'), { recursive: true })
  await fs.writeFile(join(wtPath, 'docs', 'old.md'), 'к удалению\n')
  await git.git(wtPath, ['add', '-A'])
  await git.git(wtPath, ['commit', '-qm', 'добавлен old.md'])
  await git.git(wtPath, ['rm', '-q', 'docs/old.md'])
  await git.git(wtPath, ['commit', '-qm', 'удалён old.md'])
  await fs.writeFile(join(wtPath, 'a.txt'), 'изменено руками\n')
  const mixed = await git.commit(wtPath, ['docs/old.md', 'a.txt'], 'смешанный набор путей')
  log('commit-base (закоммиченный + живой путь):', JSON.stringify(mixed))

  const branched = await git.createBranch(wtPath, 'claude/smoke-2')
  log('createBranch:', JSON.stringify(branched), '->', await git.currentBranch(wtPath))
  const back = await git.checkout(wtPath, 'claude/feature')
  log('checkout back:', JSON.stringify(back), '->', await git.currentBranch(wtPath))

  // nested-worktree: edits inside a nested worktree must not reach the status of the root
  await fs.writeFile(join(wtPath, 'in-worktree.txt'), 'только в worktree\n')
  const rootStatus = await git.status(repo, 'working')
  log('nested-worktree: файлов в корне:', rootStatus.files.map((f) => f.path).join(', ') || 'пусто')
  const wtStatus = await git.status(wtPath, 'working')
  log('nested-worktree: файлов в worktree:', wtStatus.files.map((f) => f.path).join(', ') || 'пусто')
  await fs.rm(join(wtPath, 'in-worktree.txt'), { force: true })

  const excluded = await fs.readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')
  log('exclude has /.worktrees/:', excluded.includes('/.worktrees/'))

  const removed = await git.removeWorktree(repo, wtPath, 'claude/feature')
  log('worktreeRemove:', JSON.stringify(removed))

  // pty: spawn a shell, run a command through it, read it back out of the replay buffer
  const termId = 'smoke-term'
  ptys.setSender(win.webContents)
  ptys.start({ id: termId, cwd: repo, kind: 'shell', cols: 80, rows: 24, initialCommand: 'echo SMOKE_PTY_$((6*7))' })
  const ptyOut = await waitForOutput(termId, /SMOKE_PTY_42/, 5000)
  log('pty echoed:', ptyOut.includes('SMOKE_PTY_42'))
  ptys.kill(termId)

  // agent session markers must not leak from the app's own environment into terminals
  process.env.CLAUDE_CODE_CHILD_SESSION = '1'
  process.env.CLAUDECODE = '1'
  const envId = 'smoke-env'
  ptys.start({
    id: envId,
    cwd: repo,
    kind: 'shell',
    cols: 80,
    rows: 24,
    initialCommand: 'echo MARKERS=$(env | grep -cE "^(CLAUDECODE|CLAUDE_CODE_CHILD_SESSION)=")',
  })
  const envOut = await waitForOutput(envId, /MARKERS=\d/, 5000)
  log('markers leaked into terminal:', /MARKERS=0/.test(envOut) ? 'нет' : (envOut.match(/MARKERS=\d/)?.[0] ?? '?'))
  ptys.kill(envId)

  // external sessions: what the agents themselves recorded for a project path
  const extPath = process.env.CS_EXT_PROJECT
  if (extPath) {
    const claudeDirEnv = process.env.CS_EXT_CLAUDE_DIR
    const ext = await listExternalSessions(extPath, [
      // an unset CS_EXT_CLAUDE_DIR means «no profile named», which is the key being absent
      { agentId: 'claude', kind: 'claude', ...(claudeDirEnv ? { configDir: claudeDirEnv } : {}) },
      { agentId: 'codex', kind: 'codex' },
    ])
    log('external sessions for', extPath, ':', ext.length)
    for (const e of ext.slice(0, 4)) log('   ', e.agentId, '|', e.id.slice(0, 8), '|', e.title, '|', e.cwd)
    log('unique ids:', new Set(ext.map((e) => e.id)).size === ext.length)
  }

  // resuming must only happen for conversations that really exist
  const claudeDir = process.env.CS_EXT_CLAUDE_DIR
  if (claudeDir) {
    const bogus = await sessionExists('claude', 'af6e4f8f-4fd6-413c-8a67-55db0900e8a5', claudeDir)
    log('sessionExists(несуществующая беседа):', bogus)
  }

  // an end-to-end check: a conversation is started with a fixed id and proved to be resumable
  if (process.env.CS_RESUME_CHECK === '1') {
    const { randomUUID } = await import('node:crypto')
    const sid = randomUUID()
    const dir = process.env.CS_EXT_CLAUDE_DIR
    log('resume-check: беседа', sid, 'существует до запуска:', await sessionExists('claude', sid, dir))
    const rid = 'smoke-resume'
    ptys.start({
      id: rid,
      cwd: repo,
      kind: 'agent',
      cols: 100,
      rows: 30,
      initialCommand: `claude --session-id ${sid} -p 'ответь одним словом: ok'`,
      env: dir ? { CLAUDE_CONFIG_DIR: dir } : {},
    })
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      if (await sessionExists('claude', sid, dir)) break
    }
    log('resume-check: беседа появилась в хранилище:', await sessionExists('claude', sid, dir))
    // the title shows up a little later than the conversation file itself
    let title: string | null = null
    for (let i = 0; i < 20 && !title; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      title = await sessionTitle('claude', sid, dir)
    }
    log('resume-check: имя беседы от агента:', title ?? 'не появилось')
    ptys.kill(rid)
  }

  // a conversation must be found without a profile being named too: wrappers like claude-1 set it themselves
  const anyId = process.env.CS_ANY_SESSION_ID
  if (anyId) {
    log('profiles: без configDir найдена:', await sessionExists('claude', anyId))
    log('profiles: заголовок без configDir:', (await sessionTitle('claude', anyId)) ?? 'нет')
  }

  // service-ask: the warmed-up session answers and is reused by the second request
  if (process.env.CS_SERVICE_CHECK === '1') {
    const { ask, serviceAlive, shutdownService } = await import('./serviceAgent')
    const cfg = { command: 'claude', args: ['--model', 'haiku', '--effort', 'low'], env: {}, cwd: repo }
    const t0 = Date.now()
    const first = await ask(cfg, 'Верни короткое сообщение коммита.', 'M docs/plan.md; D docs/old.md', 90_000)
    const t1 = Date.now()
    const second = await ask(cfg, 'Верни короткое сообщение коммита.', 'M src/app.ts', 90_000)
    const t2 = Date.now()
    log('service-ask первый:', JSON.stringify(first), `${t1 - t0} мс`)
    log('service-ask второй:', JSON.stringify(second), `${t2 - t1} мс`)
    log('service-ask процесс жив:', serviceAlive())
    shutdownService()
  }

  const rendered = await win.webContents.executeJavaScript(
    "document.querySelector('.empty-project h1')?.textContent ?? document.body.innerText.slice(0, 80)",
  )
  log('renderer painted:', JSON.stringify(rendered))

  await fs.rm(repo, { recursive: true, force: true })
  log('done')
  app.quit()
}
