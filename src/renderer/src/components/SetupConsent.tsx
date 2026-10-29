import type { JSX } from 'react'
import { useState } from 'react'
import { WORKTREE_CONFIG_FILE } from '../../../shared/types'
import type { WorktreeSetupTab } from '../../../shared/types'
import { useT } from '../i18n'
import { resultMessage } from '../ui/useGitAction'

interface Props {
  setup: WorktreeSetupTab
  /** approved in main: the tab may now run the script */
  onApproved: () => void
  onSkip: () => void
  onError: (msg: string) => void
}

/**
 * What a setup tab shows instead of a terminal until the person has seen the script. Running it
 * is running the repository's code, so the exact text is on screen, and the approval goes through
 * main — which re-reads the file and records the hash — rather than being a flag the tab sets.
 */
export default function SetupConsent({ setup, onApproved, onSkip, onError }: Props): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)

  const approve = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.git.worktreeApproveScripts(setup.repoPath, setup.hash)
      if (r.ok) onApproved()
      else onError(resultMessage(t, r))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup-consent" data-testid="setup-consent">
      <p>{t('terminal.setup.ask', { file: WORKTREE_CONFIG_FILE })}</p>
      <pre className="setup-script">{setup.script}</pre>
      <p className="hint">{t('terminal.setup.askApprove')}</p>
      <div className="modal-actions">
        <button data-testid="setup-skip" onClick={onSkip} disabled={busy}>
          {t('terminal.setup.skip')}
        </button>
        <button className="primary" data-testid="setup-run" onClick={() => void approve()} disabled={busy}>
          {t('terminal.setup.run')}
        </button>
      </div>
    </div>
  )
}
