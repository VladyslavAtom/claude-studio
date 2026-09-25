#!/usr/bin/env node
/**
 * Run a command with the load limits this project asks for, on whatever system is running it.
 *
 *   node tools/nice.mjs 0-3 -- electron-vite build
 *
 * `taskset` is Linux-only and `nice` is not everywhere either, so both are used when they are
 * there and skipped when they are not: the command still runs, it simply runs unconstrained.
 * The scripts in package.json used to name `taskset` directly, which made `npm run build:light`
 * and `npm run smoke` fail on macOS before they had started.
 */
import { spawnSync, spawnSync as run } from 'node:child_process'

const argv = process.argv.slice(2)
const split = argv.indexOf('--')
if (split < 1) {
  console.error('usage: node tools/nice.mjs <cpu-list> -- <command> [args…]')
  process.exit(2)
}
const cpus = argv[0]
const command = argv.slice(split + 1)
if (!command.length) {
  console.error('nothing to run')
  process.exit(2)
}

const has = (bin) => run('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }).status === 0

const prefix = []
if (process.platform === 'linux' && has('taskset')) prefix.push('taskset', '-c', cpus)
if (has('nice')) prefix.push('nice', '-n', '15')

const [bin, ...args] = [...prefix, ...command]
const res = spawnSync(bin, args, { stdio: 'inherit', env: process.env })
process.exit(res.status ?? 1)
