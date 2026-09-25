import type { ChangeStatus } from '../../../shared/types'
import type { T, TKey } from '../i18n'

/** the single letter in the file list — the same one git shows, and not language */
export const STATUS_LABEL: Record<ChangeStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: '?',
  conflict: 'U',
}

/**
 * The letter says nothing when it is read aloud, so the row's name spells the status out.
 * The wording lives in the catalogue; this map only says which key each status takes, which
 * keeps it a plain module — the caller already has a `t` and hands it over.
 */
const STATUS_KEY = {
  added: 'changes.status.added',
  modified: 'changes.status.modified',
  deleted: 'changes.status.deleted',
  renamed: 'changes.status.renamed',
  untracked: 'changes.status.untracked',
  conflict: 'changes.status.conflict',
} as const satisfies Record<ChangeStatus, TKey>

/** what goes into the row's name: «modified: src/app.ts» */
export function statusTitle(t: T, status: ChangeStatus): string {
  return t(STATUS_KEY[status])
}
