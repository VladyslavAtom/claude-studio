#!/usr/bin/env node
/**
 * The screenshot in the README, made reproducible.
 *
 * It builds a throwaway repository and a throwaway `userData` beside it, points the application
 * at both and lets the harness (`src/main/screenshot.ts`, case `hero`) take one frame. Nothing
 * of the person's own is touched: their projects, their state and their agents are in the real
 * `userData`, and this run never sees it.
 *
 *   node tools/shot.mjs [output.png]     # default: docs/img/screenshot.png
 *
 * The application has to be built first (`npm run build:light`); this does not build it, because
 * on the machine this was written for a build is started by hand.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] ?? join(appDir, 'docs', 'img', 'screenshot.png'))

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
          terminals: [{ id: 't1', kind: 'shell', title: 'jwt-service', startedAt: Date.now() }],
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
  settings: { startup: 'none' },
}
writeFileSync(join(userData, 'state.json'), JSON.stringify(state), { mode: 0o600 })

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
      CS_SHOT_CASE: 'hero',
    },
  })
  mkdirSync(dirname(out), { recursive: true })
  copyFileSync(join(shots, 'hero.png'), out)
  console.log('screenshot:', out)
} finally {
  rmSync(root, { recursive: true, force: true })
}
