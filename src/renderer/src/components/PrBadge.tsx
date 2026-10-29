import type { JSX } from 'react'
import { useState } from 'react'
import type { CheckOutcome, PrInfo, PrState } from '../../../shared/types'
import type { PluralKey, TKey } from '../i18n'
import { useT } from '../i18n'
import { checksRollup, ROLLUP_MARK } from '../lib/prStatus'
import { Menu, MenuItem, MenuSep } from '../ui/Menu'
import { useMenu } from '../ui/useMenu'

const OUTCOME_MARK: Record<CheckOutcome, string> = { pass: '✓', fail: '✗', pending: '●', skipped: '–' }
const OUTCOMES: readonly CheckOutcome[] = ['fail', 'pending', 'pass', 'skipped']
const STATE_KEY = {
  open: 'changes.pr.state.open',
  draft: 'changes.pr.state.draft',
  merged: 'changes.pr.state.merged',
  closed: 'changes.pr.state.closed',
} as const satisfies Record<PrState, TKey>
const COUNT_KEY = {
  pass: 'changes.pr.checks.pass',
  fail: 'changes.pr.checks.fail',
  pending: 'changes.pr.checks.pending',
  skipped: 'changes.pr.checks.skipped',
} as const satisfies Record<CheckOutcome, PluralKey>

/**
 * A session branch's pull request and its checks. `compact` is the session row's form — the
 * number and one mark; the panel head spells the counts out. Either opens the same popover: the
 * PR link first, then every check with its own link.
 *
 * It sits inside a clickable, draggable session row, so its clicks and keys stop here: opening the
 * popover must not also select the session.
 */
export default function PrBadge(props: { pr: PrInfo | null | undefined; compact?: boolean }): JSX.Element | null {
  // no PR, or nothing known: no badge at all, so the row and the head look as they did before
  return props.pr ? <Badge pr={props.pr} compact={props.compact ?? false} /> : null
}

function Badge({ pr, compact }: { pr: PrInfo; compact: boolean }): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const menu = useMenu<HTMLSpanElement>(open, () => setOpen(false))
  const { rootRef, triggerProps } = menu
  const rollup = checksRollup(pr)
  const state = t(STATE_KEY[pr.state])
  const c = pr.checks
  const counts = c
    ? OUTCOMES.filter((o) => c[o]).map((o) => t.plural(COUNT_KEY[o], c[o]))
    : [t('changes.pr.checks.none')]

  const openUrl = (url: string): void => {
    setOpen(false)
    void window.api.system.openExternal(url)
  }

  return (
    <span
      className="pr-badge-wrap"
      ref={rootRef}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      draggable={false}
    >
      <button
        type="button"
        className={`pr-badge pr-${pr.state} ci-${rollup}${compact ? ' compact' : ''}`}
        data-testid="pr-badge"
        {...triggerProps}
        aria-label={t('changes.pr.aria', { number: pr.number, state })}
        title={`${t('changes.pr.title', { number: pr.number, state })}\n${counts.join(', ')}`}
        onClick={() => setOpen((v) => !v)}
      >
        #{pr.number}
        {!compact && <span className="pr-state">{state}</span>}
        {compact
          ? ROLLUP_MARK[rollup] && <span className="pr-mark">{ROLLUP_MARK[rollup]}</span>
          : c &&
            OUTCOMES.filter((o) => o !== 'skipped' && c[o]).map((o) => (
              <span key={o} className={`pr-count ci-${o}`}>
                {OUTCOME_MARK[o]}
                {c[o]}
              </span>
            ))}
      </button>
      {open && (
        <Menu menu={menu} className="pr-popover" label={t('changes.pr.title', { number: pr.number, state })}>
          <MenuItem data-testid="pr-open" onClick={() => openUrl(pr.url)}>
            {t('changes.pr.open', { number: pr.number })}
          </MenuItem>
          <div className="pr-summary muted small">{counts.join(' · ')}</div>
          {c && c.items.length > 0 && <MenuSep />}
          {c?.items.map((check, i) => (
            <MenuItem
              key={`${check.name}-${i}`}
              className={`pr-check ci-${check.outcome}`}
              disabled={!check.url}
              title={check.url ?? t('changes.pr.check.noLink', { name: check.name })}
              onClick={() => check.url && openUrl(check.url)}
            >
              <span className="pr-mark">{OUTCOME_MARK[check.outcome]}</span> {check.name}
            </MenuItem>
          ))}
          {c?.truncated && (
            <div className="pr-summary muted small">{t('changes.pr.checks.truncated', { count: c.items.length })}</div>
          )}
        </Menu>
      )}
    </span>
  )
}
