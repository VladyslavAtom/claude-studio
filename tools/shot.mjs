#!/usr/bin/env node
/**
 * The screenshot in the README, made reproducible.
 *
 * It builds a throwaway repository and a throwaway `userData` beside it, points the application
 * at both and lets the harness (`src/main/screenshot.ts`, case `hero`) take one frame. Nothing
 * of the person's own is touched: their projects, their state and their agents are in the real
 * `userData`, and this run never sees it.
 *
 *   node tools/shot.mjs                      # the diff frame -> docs/img/screenshot.png
 *   node tools/shot.mjs agent                # an agent at work -> docs/img/screenshot-agent.png
 *
 * The `agent` scene starts the real Claude CLI in the throwaway repository and gives it a task,
 * so it needs `claude` on PATH and costs one short turn.
 *
 * The application has to be built first (`npm run build:light`); this does not build it, because
 * on the machine this was written for a build is started by hand.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const scene = args[0] === 'agent' ? 'agent' : args[0] === 'image' ? 'image' : 'diff'
const out = resolve(
  args[1] ??
    join(
      appDir,
      'docs',
      'img',
      scene === 'agent' ? 'screenshot-agent.png' : scene === 'image' ? 'screenshot-image.png' : 'screenshot.png',
    ),
)

if (!existsSync(join(appDir, 'out', 'main', 'index.js'))) {
  console.error('build first: npm run build:light')
  process.exit(1)
}

const root = mkdtempSync(join(tmpdir(), 'cs-shot-'))
const repo = join(root, 'jwt-service')
const userData = join(root, 'userData')
mkdirSync(join(repo, 'src', 'lib'), { recursive: true })
mkdirSync(userData, { recursive: true })

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })

writeFileSync(
  join(repo, 'README'),
  ['# jwt-service', '', 'Token issuing and verification.', '', '- `src/lib/jwt.ts` — sign and verify', ''].join('\n'),
)
writeFileSync(
  join(repo, 'src', 'lib', 'jwt.ts'),
  `import { createHmac, timingSafeEqual } from 'node:crypto'

export interface Claims {
  sub: string
  exp: number
}

const b64 = (input: Buffer | string) => Buffer.from(input).toString('base64url')

export function sign(claims: Claims, secret: string): string {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64(JSON.stringify(claims))
  const mac = createHmac('sha256', secret).update(\`\${head}.\${body}\`).digest()
  return \`\${head}.\${body}.\${b64(mac)}\`
}

export function verify(token: string, secret: string, now = Date.now()): Claims | null {
  const [head, body, mac] = token.split('.')
  if (!head || !body || !mac) return null
  const expected = createHmac('sha256', secret).update(\`\${head}.\${body}\`).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString())
  return claims.exp * 1000 <= now ? null : claims
}
`,
)
writeFileSync(join(repo, 'src', 'index.ts'), "export { sign, verify } from './lib/jwt'\n")
// a picture in the repository: the `image` case opens it from the tree
copyFileSync(join(appDir, 'resources', 'icon-256.png'), join(repo, 'logo.png'))

git('init', '-q', '-b', 'main')
git('config', 'user.email', 'dev@example.com')
git('config', 'user.name', 'dev')
git('add', '-A')
git('commit', '-qm', 'jwt: sign and verify')

// the changes the panel shows: an edit in the middle of the file, and a new file
writeFileSync(
  join(repo, 'src', 'lib', 'jwt.ts'),
  readFileSync(join(repo, 'src', 'lib', 'jwt.ts'), 'utf8')
    .replace(
      'export function verify(token: string, secret: string, now = Date.now()): Claims | null {',
      `/** \`leeway\` covers the clock skew between the issuer and us: without it a token that is\n * one second old on a machine one second behind is refused. */\nexport function verify(token: string, secret: string, now = Date.now(), leeway = LEEWAY_MS): Claims | null {`,
    )
    .replace(
      '  return claims.exp * 1000 <= now ? null : claims',
      '  // the check used to be `<`, which let a token through on the millisecond it expired\n  return claims.exp * 1000 + leeway <= now ? null : claims',
    )
    .replace(
      "const b64 = (input: Buffer | string) => Buffer.from(input).toString('base64url')",
      "const b64 = (input: Buffer | string) => Buffer.from(input).toString('base64url')\n\n/** clock skew allowed on expiry, in milliseconds */\nexport const LEEWAY_MS = 30_000",
    ),
)
writeFileSync(join(repo, 'src', 'lib', 'keys.ts'), 'export const ROTATION_DAYS = 30\n')

const state = {
  version: 3,
  projects: [
    {
      id: 'p1',
      name: 'jwt-service',
      path: repo,
      isGit: true,
      sessions: [
        {
          id: 's1',
          name: 'Expiry check',
          cwd: repo,
          terminals:
            scene === 'agent'
              ? [
                  {
                    id: 't1',
                    kind: 'agent',
                    agentId: 'claude',
                    title: 'Claude',
                    agentSessionId: randomUUID(),
                    // the task the tab is started with: the frame shows an agent already working
                    startPrompt:
                      'Read src/lib/jwt.ts and say in three short lines what this module does and what the expiry check depends on. Do not edit anything.',
                    startedAt: Date.now(),
                  },
                ]
              : [{ id: 't1', kind: 'shell', title: 'jwt-service', startedAt: Date.now() }],
          activeTerminalId: 't1',
          createdAt: Date.now(),
          runs: [],
        },
      ],
      activeSessionId: 's1',
    },
  ],
  closedProjects: [],
  activeProjectId: 'p1',
  // the agent scene has to bring its tab up at startup; the diff scene must not start anything
  settings: { startup: scene === 'agent' ? 'all' : 'none' },
}
writeFileSync(join(userData, 'state.json'), JSON.stringify(state), { mode: 0o600 })

/**
 * The agent scene runs the real CLI, and a frame of it must not carry the person's own machine
 * into a public README: the shell prompt names the host, and the CLI's status line carries their
 * plan and their usage. So the tab gets `sh` (a bare `$` prompt) and a config directory of its
 * own — the credentials are copied in so the CLI is signed in, and nothing else is.
 */
function neutralAgentEnv() {
  if (scene !== 'agent') return {}
  const config = join(root, 'claude-config')
  mkdirSync(config, { recursive: true })
  const credentials = join(homedir(), '.claude', '.credentials.json')
  if (existsSync(credentials)) copyFileSync(credentials, join(config, '.credentials.json'), 0)
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ includeCoAuthoredBy: false }), { mode: 0o600 })
  return { SHELL: '/bin/sh', CLAUDE_CONFIG_DIR: config }
}

const shots = join(root, 'shots')
try {
  execFileSync(join(appDir, 'node_modules', 'electron', 'dist', 'electron'), ['.'], {
    cwd: appDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_DISABLE_SANDBOX: '1',
      CS_USERDATA: userData,
      CS_SHOT: shots,
      ...neutralAgentEnv(),
      CS_SHOT_CASE: scene === 'agent' ? 'heroAgent' : scene === 'image' ? 'image' : 'hero',
    },
  })
  mkdirSync(dirname(out), { recursive: true })
  copyFileSync(join(shots, scene === 'agent' ? 'heroAgent.png' : scene === 'image' ? 'image.png' : 'hero.png'), out)
  console.log('screenshot:', out)
} finally {
  rmSync(root, { recursive: true, force: true })
}
