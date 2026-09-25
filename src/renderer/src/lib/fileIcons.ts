import type { ChangeStatus } from '../../../shared/types'

export interface FileBadge {
  /** a short label instead of a picture: at 12 px it reads better than any icon */
  text: string
  /** the colour class: the colours come from the syntax highlighting, so a type is recognised the same way */
  cls: string
}

/** every Dockerfile variant shares one badge, matched by prefix rather than by whole name */
const DOCKERFILE: FileBadge = { text: '⛴', cls: 'docker' }

const BY_EXT: Record<string, FileBadge> = {
  ts: { text: 'TS', cls: 'ts' },
  tsx: { text: 'TS', cls: 'ts' },
  mts: { text: 'TS', cls: 'ts' },
  cts: { text: 'TS', cls: 'ts' },
  js: { text: 'JS', cls: 'js' },
  jsx: { text: 'JS', cls: 'js' },
  mjs: { text: 'JS', cls: 'js' },
  cjs: { text: 'JS', cls: 'js' },
  py: { text: 'PY', cls: 'py' },
  pyi: { text: 'PY', cls: 'py' },
  rs: { text: 'RS', cls: 'rs' },
  go: { text: 'GO', cls: 'go' },
  json: { text: '{}', cls: 'json' },
  jsonc: { text: '{}', cls: 'json' },
  lock: { text: '⚿', cls: 'muted' },
  toml: { text: 'TL', cls: 'conf' },
  ini: { text: 'IN', cls: 'conf' },
  cfg: { text: 'CF', cls: 'conf' },
  conf: { text: 'CF', cls: 'conf' },
  yml: { text: 'YM', cls: 'yaml' },
  yaml: { text: 'YM', cls: 'yaml' },
  md: { text: 'M↓', cls: 'md' },
  mdx: { text: 'M↓', cls: 'md' },
  txt: { text: '≡', cls: 'muted' },
  css: { text: 'CS', cls: 'css' },
  scss: { text: 'CS', cls: 'css' },
  less: { text: 'CS', cls: 'css' },
  html: { text: '<>', cls: 'html' },
  htm: { text: '<>', cls: 'html' },
  vue: { text: '<>', cls: 'html' },
  svg: { text: '◨', cls: 'img' },
  png: { text: '◨', cls: 'img' },
  jpg: { text: '◨', cls: 'img' },
  jpeg: { text: '◨', cls: 'img' },
  gif: { text: '◨', cls: 'img' },
  webp: { text: '◨', cls: 'img' },
  ico: { text: '◨', cls: 'img' },
  sh: { text: '$_', cls: 'sh' },
  bash: { text: '$_', cls: 'sh' },
  zsh: { text: '$_', cls: 'sh' },
  fish: { text: '$_', cls: 'sh' },
  sql: { text: 'SQ', cls: 'conf' },
  db: { text: '▤', cls: 'muted' },
  sqlite: { text: '▤', cls: 'muted' },
  jsonl: { text: '▤', cls: 'muted' },
  csv: { text: '▤', cls: 'muted' },
  pdf: { text: '▤', cls: 'muted' },
  zip: { text: '▤', cls: 'muted' },
}

/** files whose meaning is carried by the whole name, not by the extension */
const BY_NAME: Record<string, FileBadge> = {
  dockerfile: DOCKERFILE,
  makefile: { text: 'MK', cls: 'conf' },
  'package.json': { text: '{}', cls: 'json' },
  '.gitignore': { text: '⑂', cls: 'muted' },
  '.gitattributes': { text: '⑂', cls: 'muted' },
  '.dockerignore': { text: '⛴', cls: 'muted' },
  '.editorconfig': { text: 'CF', cls: 'conf' },
}

export function fileBadge(name: string): FileBadge {
  const lower = name.toLowerCase()
  const byName = BY_NAME[lower]
  if (byName) return byName
  if (lower.startsWith('dockerfile')) return DOCKERFILE
  // .env, .env.local, .env.prod.example — all of them are one breed of file
  if (lower === '.env' || lower.startsWith('.env.')) return { text: 'EN', cls: 'conf' }
  const dot = lower.lastIndexOf('.')
  const ext = dot > 0 ? lower.slice(dot + 1) : ''
  return BY_EXT[ext] ?? { text: '≡', cls: 'muted' }
}

/** row colour by the file's git status — as in an IDE: what changed is visible without opening a diff */
export function statusClass(status: ChangeStatus | undefined): string {
  if (!status) return ''
  if (status === 'untracked' || status === 'added') return ' added'
  if (status === 'deleted') return ' deleted'
  if (status === 'conflict') return ' conflict'
  return ' modified'
}
