import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  PullStrategy,
  AgentDef,
  CommitMessageConfig,
  EditorConfig,
  Locale,
  NotificationConfig,
  Settings,
  SleepConfig,
  StartupPolicy,
  StateHealth,
  TerminalConfig,
  ThemeChoice,
} from '../../../shared/types'
import {
  AGENT_PRESETS,
  DEFAULT_SCROLLBACK_LINES,
  THEME_CHOICES,
  COMMIT_ARGS_BY_PRESET,
  COMMIT_VIA_SERVICE,
  COMMIT_VIA_TAB,
  SERVICE_ARGS,
  defaultAgents,
  defaultCommitMessage,
  defaultEditor,
  defaultNotifications,
  defaultSleep,
  defaultTerminal,
} from '../../../shared/types'
import type { T } from '../i18n'
import { LOCALES, LOCALE_NAMES, makeT, useLocale } from '../i18n'
import { formatEnv, parseArgs, parseEnv } from '../lib/agents'
import { dragHandlers } from '../lib/dnd'
import { playChime } from '../lib/notify'
import { pickAgentColor } from '../lib/colors'
import { moveItem, uid } from '../lib/util'
import Modal from '../ui/Modal'
import { Menu, MenuItem } from '../ui/Menu'
import { useMenu } from '../ui/useMenu'
import { useThemePreview } from '../theme/themeContext'

interface Props {
  settings: Settings
  /** which tab the page opens on */
  initialTab?: Tab | undefined
  onClose: () => void
  onSave: (settings: Settings) => void
}

const TAB_IDS = ['agents', 'sleep', 'notifications', 'commits', 'git', 'terminal', 'editor', 'appearance'] as const
type Tab = (typeof TAB_IDS)[number]

/** severity of a health notice: only the colour differs, the layout is the same */
const NOTICE = { warn: { color: 'var(--warn)' }, plain: undefined } as const

/**
 * What `state:health` reports, turned into things worth saying out loud. Two of the three are
 * silent failures the user would otherwise never learn about: a state file that was replaced
 * from a backup looks like "my sessions are gone", and a save that is refused looks like
 * settings that will not stick. The third is about secrecy — agent env values hold API tokens,
 * and on a Linux box without a keyring daemon they are obfuscated, not encrypted.
 */
function healthNotices(health: StateHealth, t: T): { key: string; severity: 'warn' | 'plain'; text: string }[] {
  const out: { key: string; severity: 'warn' | 'plain'; text: string }[] = []
  const { load, encryption, saveBlocked } = health
  /** where the corrupted file went, or where to look for it when the reason is not known */
  const kept = load.reason
    ? t('settings.health.corruptKept', { reason: load.reason })
    : t('settings.health.corruptAside')

  if (saveBlocked || load.recovered === 'too-new') {
    const detail = load.reason ? t('settings.health.details', { reason: load.reason }) : t('settings.health.update')
    out.push({ key: 'blocked', severity: 'warn', text: `${t('settings.health.blocked')} ${detail}` })
  } else if (load.recovered === 'backup') {
    out.push({ key: 'backup', severity: 'warn', text: `${t('settings.health.backup')} ${kept}` })
  } else if (load.recovered === 'empty') {
    out.push({ key: 'empty', severity: 'warn', text: `${t('settings.health.empty')} ${kept}` })
  }

  if (encryption === 'weak') {
    out.push({ key: 'encryption', severity: 'warn', text: t('settings.health.encryptionWeak') })
  } else if (encryption === 'none') {
    out.push({ key: 'encryption', severity: 'warn', text: t('settings.health.encryptionNone') })
  }

  return out
}

/** the hint under a preset in the «add an agent» menu; the preset itself is data, its wording is not */
function presetHint(t: T, preset: (typeof AGENT_PRESETS)[number]['preset']): string {
  return preset === 'claude'
    ? t('settings.preset.claude.hint')
    : preset === 'codex'
      ? t('settings.preset.codex.hint')
      : t('settings.preset.custom.hint')
}

/** Claude and Codex name themselves; only the custom preset has a name to translate */
function presetName(t: T, preset: (typeof AGENT_PRESETS)[number]): string {
  return preset.preset === 'custom' ? t('settings.preset.custom') : preset.name
}

export default function SettingsPage({ settings, initialTab, onClose, onSave }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'agents')
  const [agents, setAgents] = useState<AgentDef[]>(settings.agents.map((a) => ({ ...a })))
  const [commit, setCommit] = useState<CommitMessageConfig>({ ...settings.commitMessage })
  const [sleep, setSleep] = useState<SleepConfig>({ ...settings.sleep })
  const [startup, setStartup] = useState<StartupPolicy>(settings.startup)
  const [pullStrategy, setPullStrategy] = useState<PullStrategy>(settings.pullStrategy)
  const [notifications, setNotifications] = useState<NotificationConfig>({ ...settings.notifications })
  const [editor, setEditor] = useState<EditorConfig>({ ...settings.editor })
  const [terminal, setTerminal] = useState<TerminalConfig>({ ...settings.terminal })
  const [locale, setLocale] = useState<Locale | undefined>(settings.locale)
  const [theme, setTheme] = useState<ThemeChoice | undefined>(settings.theme)
  const previewTheme = useThemePreview()

  // leaving the page without saving drops the preview, like every other unsaved edit here
  useEffect(() => () => previewTheme(null), [previewTheme])
  const [selectedId, setSelectedId] = useState<string>(settings.agents[0]?.id ?? '')
  const [presetMenu, setPresetMenu] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  /**
   * The page speaks the language it is about to save, not the one in context: picking a
   * language switches the page under the cursor, so the choice can be read before it is
   * committed. The rest of the window follows when the settings are saved.
   */
  const appLocale = useLocale()
  const shownLocale = locale ?? appLocale
  const t = useMemo(() => makeT(shownLocale), [shownLocale])
  const presetsMenu = useMenu(presetMenu, () => setPresetMenu(false))
  // bound once: reading a member off a handle that carries refs counts as touching a ref
  // during render, whether or not `.current` is what is being read
  const { rootRef: presetsRootRef, triggerProps: presetsTrigger } = presetsMenu
  /**
   * Fields whose value is parsed as it is typed (env, argument lists) hold the raw text while
   * the field has focus. Otherwise parsing eats what is half-written: a line without «=» drops
   * out of env and a trailing space drops out of the arguments, so a second pair cannot be
   * typed at all.
   */
  const [raw, setRaw] = useState<{ key: string; text: string } | null>(null)
  const selected = agents.find((a) => a.id === selectedId) ?? null
  /** a binary is only checked when it is given as a path: a bare name from PATH cannot be */
  const command = selected?.command ?? ''
  const checkable = command.includes('/')
  const [missingBinary, setMissingBinary] = useState(false)

  /** null until the answer is in: a page with no warnings must not flash one */
  const [health, setHealth] = useState<StateHealth | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.state.health().then((h) => {
      if (alive) setHealth(h)
    })
    return () => {
      alive = false
    }
  }, [])
  const notices = health ? healthNotices(health, t) : []

  useEffect(() => {
    if (!checkable) return
    let alive = true
    void window.api.fs.exists(command).then((ok) => {
      if (alive) setMissingBinary(!ok)
    })
    return () => {
      alive = false
    }
  }, [command, checkable])

  const draft: Settings = {
    ...settings,
    agents,
    commitMessage: commit,
    sleep,
    startup,
    pullStrategy,
    notifications,
    editor,
    terminal,
    // a language nobody has picked stays unwritten: the field's absence is what «follow the
    // system language» is, and writing the resolved value would freeze today's system language
    ...(locale ? { locale } : {}),
    // same shape as the locale, same reason: an absent theme is «follow the system», and
    // writing the resolved one would freeze whatever the system happens to be right now
    ...(theme ? { theme } : {}),
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  const save = (): void => {
    onSave(draft)
    setJustSaved(true)
    window.setTimeout(() => setJustSaved(false), 1500)
  }

  const leave = (): void => {
    if (dirty) setConfirmExit(true)
    else onClose()
  }
  // the handler lives in an effect, so it must not close over a stale `dirty`. Written after
  // the commit rather than during render: a ref mutated while rendering does not survive a
  // render React decides to throw away.
  const leaveRef = useRef(leave)
  useEffect(() => {
    leaveRef.current = leave
  })

  /**
   * Escape closes the page — but only after whatever is open inside it. The exit dialog and
   * the presets menu claim the key for themselves (they do that on their own, as Modal and
   * Menu do). Leaving goes through leave(), so unsaved work is still asked about: Escape used
   * to be caught by App, which closed the page without a word.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // something nested has already handled the key — do not take it
      if (e.key !== 'Escape' || e.defaultPrevented) return
      leaveRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const patch = (id: string, fields: Partial<AgentDef>): void =>
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...fields } : a)))

  /** props for a parse-as-you-type field: show what was typed, hand out what was parsed */
  const rawField = (
    key: string,
    formatted: string,
    apply: (text: string) => void,
  ): {
    value: string
    onChange: (e: { target: { value: string } }) => void
    onBlur: () => void
  } => ({
    value: raw?.key === key ? raw.text : formatted,
    onChange: (e) => {
      setRaw({ key, text: e.target.value })
      apply(e.target.value)
    },
    onBlur: () => setRaw(null),
  })

  /** a preset fixes everything the CLI itself dictates; name, env and extra args stay the user's */
  const addFromPreset = (presetName_: (typeof AGENT_PRESETS)[number]['preset']): void => {
    const p = AGENT_PRESETS.find((x) => x.preset === presetName_)
    if (!p) return
    const taken = agents.filter((a) => a.preset === presetName_).length
    const base = presetName(t, p)
    const agent: AgentDef = {
      id: uid(),
      name: taken ? `${base} ${taken + 1}` : base,
      preset: p.preset,
      command: p.command,
      args: [...p.args],
      resumeArgs: [...p.resumeArgs],
      historyArgs: [...p.historyArgs],
      sessionSource: p.sessionSource,
      extraArgs: [],
      env: {},
      // the dot colour is picked automatically so new agents do not blend into the existing ones
      color: pickAgentColor(agents.map((a) => a.color)),
      enabled: true,
    }
    setAgents((prev) => [...prev, agent])
    setSelectedId(agent.id)
    setPresetMenu(false)
  }

  const removeAgent = (id: string): void =>
    setAgents((prev) => {
      const next = prev.filter((a) => a.id !== id)
      if (id === selectedId) setSelectedId(next[0]?.id ?? '')
      return next
    })

  const resetAll = (): void => {
    setAgents(defaultAgents.map((a) => ({ ...a })))
    setCommit({ ...defaultCommitMessage })
    setSleep({ ...defaultSleep })
    setNotifications({ ...defaultNotifications })
    setEditor({ ...defaultEditor })
    setTerminal({ ...defaultTerminal })
    setStartup('ask')
  }

  return (
    <div className="settings-page">
      <div className="settings-top">
        <button className="ghost" onClick={leave} title={t('settings.back')} aria-label={t('settings.back.aria')}>
          ←
        </button>
        <h1>{t('settings.title')}</h1>
        {dirty && <span className="muted small">{t('settings.unsaved')}</span>}
        <div className="spacer" />
        <button onClick={resetAll}>{t('settings.reset')}</button>
        <button className="primary" onClick={save} disabled={!dirty}>
          {justSaved ? t('settings.saved') : t('settings.save')}
        </button>
        <button onClick={leave}>{t('settings.close')}</button>
      </div>

      <div className="settings-body">
        <nav className="settings-nav">
          {TAB_IDS.map((id) => (
            <button key={id} className={id === tab ? 'active' : ''} onClick={() => setTab(id)}>
              <span className="label">{t(`settings.tab.${id}`)}</span>
              <span className="muted small">{t(`settings.tab.${id}.hint`)}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {/* shown on every tab, not just the agents one: «changes are not being saved» is about
              the whole page, and a warning that hides behind a tab has not warned anybody */}
          {notices.map((n) => (
            <p
              key={n.key}
              className="hint"
              style={NOTICE[n.severity]}
              role={n.severity === 'warn' ? 'alert' : undefined}
            >
              {n.text}
            </p>
          ))}

          {tab === 'agents' && (
            <div className="agents-tab">
              <div className="agent-list">
                {agents.map((a, i) => (
                  <div
                    key={a.id}
                    className={'agent-item' + (a.id === selectedId ? ' active' : '')}
                    onClick={() => setSelectedId(a.id)}
                    {...dragHandlers('agent', i, (from, to) => setAgents((prev) => moveItem(prev, from, to)))}
                  >
                    <span className="dot" style={{ background: a.color }} />
                    <span className="name">{a.name}</span>
                    <input
                      type="checkbox"
                      checked={a.enabled}
                      title={t('settings.agents.enabled')}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patch(a.id, { enabled: e.target.checked })}
                    />
                  </div>
                ))}
                <div className="agent-list-actions">
                  <div className="preset-wrap" ref={presetsRootRef}>
                    <button
                      {...presetsTrigger}
                      onClick={() => setPresetMenu((v) => !v)}
                      title={t('settings.agents.add')}
                      aria-label={t('settings.agents.add')}
                    >
                      +
                    </button>
                    {presetMenu && (
                      <Menu menu={presetsMenu} className="preset-menu" label={t('settings.agents.presets')}>
                        {AGENT_PRESETS.map((p) => (
                          <MenuItem key={p.preset} onClick={() => addFromPreset(p.preset)}>
                            <span className="dot" style={{ background: p.color }} />
                            <span className="preset-main">
                              <span>{presetName(t, p)}</span>
                              <span className="muted small">{presetHint(t, p.preset)}</span>
                            </span>
                          </MenuItem>
                        ))}
                      </Menu>
                    )}
                  </div>
                  <button
                    onClick={() => selected && removeAgent(selected.id)}
                    disabled={!selected}
                    title={t('settings.agents.remove')}
                    aria-label={t('settings.agents.remove.aria')}
                  >
                    −
                  </button>
                </div>
                <p className="hint pad">{t('settings.agents.orderHint')}</p>
              </div>

              <div className="agent-form">
                {!selected && <div className="muted pad">{t('settings.agents.pickOne')}</div>}
                {selected && (
                  <>
                    <div className="two">
                      <label>
                        <span>{t('settings.agents.name')}</span>
                        <input value={selected.name} onChange={(e) => patch(selected.id, { name: e.target.value })} />
                      </label>
                      <label>
                        <span>{t('settings.agents.extraArgs')}</span>
                        <input
                          {...rawField(`${selected.id}:extraArgs`, selected.extraArgs.join(' '), (text) =>
                            patch(selected.id, { extraArgs: parseArgs(text) }),
                          )}
                          placeholder="--model opus --permission-mode plan"
                        />
                      </label>
                    </div>

                    {selected.preset === 'custom' ? (
                      <>
                        <div className="two">
                          <label>
                            <span>{t('settings.agents.command')}</span>
                            <input
                              value={selected.command}
                              placeholder="/path/to/agent"
                              onChange={(e) => patch(selected.id, { command: e.target.value })}
                            />
                          </label>
                          <label>
                            <span>{t('settings.agents.identity')}</span>
                            <select
                              value={selected.sessionSource}
                              onChange={(e) =>
                                patch(selected.id, { sessionSource: e.target.value as AgentDef['sessionSource'] })
                              }
                            >
                              {/* the token is the CLI's own placeholder, not a word of any language */}
                              <option value="uuid">
                                {t('settings.identity.uuid')} {'{session}'}
                              </option>
                              <option value="codex">{t('settings.identity.codex')}</option>
                              <option value="none">{t('settings.identity.none')}</option>
                            </select>
                          </label>
                        </div>

                        <div className="two">
                          <label>
                            <span>{t('settings.agents.args')}</span>
                            <input
                              {...rawField(`${selected.id}:args`, selected.args.join(' '), (text) =>
                                patch(selected.id, { args: parseArgs(text) }),
                              )}
                              placeholder="--session-id {session}"
                            />
                          </label>
                          <label>
                            <span>{t('settings.agents.resumeArgs')}</span>
                            <input
                              {...rawField(`${selected.id}:resumeArgs`, selected.resumeArgs.join(' '), (text) =>
                                patch(selected.id, { resumeArgs: parseArgs(text) }),
                              )}
                              placeholder="--resume {session}"
                            />
                          </label>
                        </div>

                        <label>
                          <span>{t('settings.agents.historyArgs')}</span>
                          <input
                            {...rawField(`${selected.id}:historyArgs`, selected.historyArgs.join(' '), (text) =>
                              patch(selected.id, { historyArgs: parseArgs(text) }),
                            )}
                          />
                        </label>
                      </>
                    ) : (
                      <div className="preset-facts">
                        <div>
                          <span className="muted small">{t('settings.preset.label')}</span>
                          <span>
                            {(() => {
                              const p = AGENT_PRESETS.find((x) => x.preset === selected.preset)
                              return p ? presetName(t, p) : selected.preset
                            })()}
                          </span>
                        </div>
                        <label className="full">
                          <span>{t('settings.preset.binary')}</span>
                          <input
                            value={selected.command}
                            placeholder={AGENT_PRESETS.find((p) => p.preset === selected.preset)?.command}
                            onChange={(e) => patch(selected.id, { command: e.target.value })}
                          />
                        </label>
                        <p className="hint">
                          {t('settings.preset.binaryHint.before')}
                          <code>claude-1</code>
                          {t('settings.preset.binaryHint.after')}{' '}
                          {checkable && missingBinary && <span className="warn">{t('settings.preset.missing')}</span>}
                        </p>
                        <div>
                          <span className="muted small">{t('settings.preset.resume')}</span>
                          <code>{[selected.command, ...selected.resumeArgs].join(' ')}</code>
                        </div>
                        <p className="hint">{presetHint(t, selected.preset)}</p>
                      </div>
                    )}

                    <label>
                      <span>{t('settings.env.label')}</span>
                      <textarea
                        rows={4}
                        placeholder="CLAUDE_CONFIG_DIR=/home/bv/.claude-1"
                        {...rawField(`${selected.id}:env`, formatEnv(selected.env), (text) =>
                          patch(selected.id, { env: parseEnv(text) }),
                        )}
                      />
                    </label>

                    <div className="colors">
                      <span className="muted small">{t('settings.color.label')}</span>
                      <span className="swatch current" style={{ background: selected.color }} />
                      <code className="muted small">{selected.color}</code>
                      <button
                        className="ghost"
                        title={t('settings.color.pick')}
                        onClick={() =>
                          patch(selected.id, {
                            color: pickAgentColor(agents.filter((a) => a.id !== selected.id).map((a) => a.color)),
                          })
                        }
                      >
                        {t('settings.color.another')}
                      </button>
                    </div>

                    <p className="hint">
                      {t('settings.command.final')}{' '}
                      <code>
                        {[selected.command, ...selected.args, ...selected.extraArgs].filter(Boolean).join(' ') || '—'}
                      </code>
                      <br />
                      {t('settings.command.profile.before')}
                      <code>CLAUDE_CONFIG_DIR</code>
                      {t('settings.command.profile.after')}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {tab === 'sleep' && (
            <div className="form-tab">
              <label className="check">
                <input
                  type="checkbox"
                  checked={sleep.enabled}
                  onChange={(e) => setSleep({ ...sleep, enabled: e.target.checked })}
                />
                <span>{t('settings.sleep.enabled')}</span>
              </label>
              <div className="two">
                <label>
                  <span>{t('settings.sleep.minutes')}</span>
                  <input
                    type="number"
                    min={1}
                    value={sleep.minutes}
                    disabled={!sleep.enabled}
                    onChange={(e) => setSleep({ ...sleep, minutes: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </label>
                <label>
                  <span>{t('settings.sleep.startup')}</span>
                  <select value={startup} onChange={(e) => setStartup(e.target.value as StartupPolicy)}>
                    <option value="ask">{t('settings.startup.ask')}</option>
                    <option value="all">{t('settings.startup.all')}</option>
                    <option value="none">{t('settings.startup.none')}</option>
                  </select>
                </label>
              </div>
              <p className="hint">{t('settings.sleep.hint')}</p>
            </div>
          )}

          {tab === 'git' && (
            <div className="form-tab">
              <label>
                <span>{t('settings.git.pullButton')}</span>
                <select value={pullStrategy} onChange={(e) => setPullStrategy(e.target.value as PullStrategy)}>
                  <option value="ask">{t('settings.git.pull.ask')}</option>
                  <option value="rebase">{t('settings.git.pull.rebase')}</option>
                  <option value="merge">{t('settings.git.pull.merge')}</option>
                </select>
              </label>
              <p className="hint">{t('settings.git.hint')}</p>
            </div>
          )}

          {tab === 'notifications' && (
            <div className="form-tab">
              <label className="check">
                <input
                  type="checkbox"
                  checked={notifications.enabled}
                  onChange={(e) => setNotifications({ ...notifications, enabled: e.target.checked })}
                />
                <span>{t('settings.notify.enabled')}</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={notifications.sound}
                  disabled={!notifications.enabled}
                  onChange={(e) => setNotifications({ ...notifications, sound: e.target.checked })}
                />
                <span>{t('settings.notify.sound')}</span>
                <button className="ghost" onClick={() => playChime()} title={t('settings.notify.test.title')}>
                  {t('settings.notify.test')}
                </button>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={notifications.onlyWhenUnfocused}
                  disabled={!notifications.enabled}
                  onChange={(e) => setNotifications({ ...notifications, onlyWhenUnfocused: e.target.checked })}
                />
                <span>{t('settings.notify.unfocused')}</span>
              </label>
              <p className="hint">{t('settings.notify.hint')}</p>
            </div>
          )}

          {tab === 'terminal' && (
            <div className="form-tab">
              <label className="check">
                <input
                  type="checkbox"
                  checked={terminal.scrollbackLines === null}
                  // switching the limit back on lands on the value the terminals had before this
                  // setting existed, rather than on whatever was last typed into a disabled field
                  onChange={(e) => setTerminal({ scrollbackLines: e.target.checked ? null : DEFAULT_SCROLLBACK_LINES })}
                />
                <span>{t('settings.terminal.unlimited')}</span>
              </label>
              <label>
                <span>{t('settings.terminal.lines')}</span>
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={terminal.scrollbackLines ?? DEFAULT_SCROLLBACK_LINES}
                  disabled={terminal.scrollbackLines === null}
                  onChange={(e) => setTerminal({ scrollbackLines: Math.max(100, Number(e.target.value) || 100) })}
                />
              </label>
              <p className="hint">{t('settings.terminal.hint')}</p>
              <p className="hint">{t('settings.terminal.memory')}</p>
            </div>
          )}

          {tab === 'editor' && (
            <div className="form-tab">
              <label className="check">
                <input
                  type="checkbox"
                  checked={editor.autoSave}
                  onChange={(e) => setEditor({ ...editor, autoSave: e.target.checked })}
                />
                <span>{t('settings.editor.autoSave')}</span>
              </label>
              <label>
                <span>{t('settings.editor.delay')}</span>
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={editor.delayMs}
                  disabled={!editor.autoSave}
                  onChange={(e) => setEditor({ ...editor, delayMs: Math.max(100, Number(e.target.value) || 100) })}
                />
              </label>
              <p className="hint">{t('settings.editor.hint')}</p>
            </div>
          )}

          {tab === 'appearance' && (
            <div className="form-tab">
              <label>
                <span>{t('settings.language.label')}</span>
                <select value={shownLocale} onChange={(e) => setLocale(e.target.value as Locale)}>
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {LOCALE_NAMES[l]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">{t('settings.language.hint')}</p>

              <label>
                <span>{t('settings.theme.label')}</span>
                {/* the window repaints as the choice is made, and it does so through the provider
                    rather than here: a preview that paints itself would be a second opinion on
                    what the theme is. Leaving without saving drops it. */}
                <select
                  value={theme ?? 'system'}
                  onChange={(e) => {
                    const picked = e.target.value as ThemeChoice
                    setTheme(picked)
                    previewTheme(picked)
                  }}
                >
                  {THEME_CHOICES.map((c) => (
                    <option key={c} value={c}>
                      {t(`settings.theme.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">{t('settings.theme.hint')}</p>
            </div>
          )}

          {tab === 'commits' && (
            <div className="form-tab">
              <div className="two">
                <label>
                  <span>{t('settings.commit.generator')}</span>
                  <select
                    value={commit.agentId ?? ''}
                    onChange={(e) => {
                      const id = e.target.value || null
                      const agent = agents.find((a) => a.id === id)
                      setCommit({
                        ...commit,
                        agentId: id,
                        // each CLI has its own non-interactive mode — fill in the matching set
                        args: agent ? [...COMMIT_ARGS_BY_PRESET[agent.preset]] : commit.args,
                      })
                    }}
                  >
                    <option value={COMMIT_VIA_SERVICE}>{t('settings.commit.viaService')}</option>
                    <option value={COMMIT_VIA_TAB}>{t('settings.commit.viaTab')}</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.command}
                      </option>
                    ))}
                    <option value="">{t('settings.commit.other')}</option>
                  </select>
                </label>
                <label>
                  <span>{t('settings.commit.timeout')}</span>
                  <input
                    type="number"
                    min={5000}
                    step={5000}
                    value={commit.timeoutMs}
                    onChange={(e) =>
                      setCommit({ ...commit, timeoutMs: Math.max(5000, Number(e.target.value) || 60000) })
                    }
                  />
                </label>
              </div>

              {commit.agentId === COMMIT_VIA_SERVICE && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={commit.warmOnStart !== false}
                    onChange={(e) => setCommit({ ...commit, warmOnStart: e.target.checked })}
                  />
                  <span>{t('settings.commit.warmOnStart')}</span>
                </label>
              )}

              {commit.agentId === COMMIT_VIA_SERVICE && (
                <p className="hint">
                  {t('settings.commit.serviceHint.before')}
                  <code>claude {SERVICE_ARGS.join(' ')}</code>
                  {t('settings.commit.serviceHint.after')}
                </p>
              )}

              {commit.agentId === COMMIT_VIA_TAB && (
                <p className="hint">
                  {t('settings.commit.tabHint.before')}
                  <code>/btw</code>
                  {t('settings.commit.tabHint.after')}
                </p>
              )}

              {!commit.agentId && (
                <label>
                  <span>{t('settings.commit.command')}</span>
                  <input
                    value={commit.command ?? ''}
                    placeholder="claude / codex / /path/to/bin"
                    onChange={(e) => setCommit({ ...commit, command: e.target.value })}
                  />
                </label>
              )}

              {commit.agentId !== COMMIT_VIA_TAB && (
                <label>
                  <span>
                    {commit.agentId === COMMIT_VIA_SERVICE
                      ? t('settings.commit.serviceArgs')
                      : t('settings.commit.nonInteractiveArgs')}
                  </span>
                  <input
                    placeholder="-p --model haiku --effort low"
                    {...rawField('commit:args', commit.args.join(' '), (text) =>
                      setCommit({ ...commit, args: parseArgs(text) }),
                    )}
                  />
                </label>
              )}

              <label>
                <span>{t('settings.commit.prompt')}</span>
                <textarea
                  rows={12}
                  className="prompt-area"
                  value={commit.prompt}
                  onChange={(e) => setCommit({ ...commit, prompt: e.target.value })}
                />
              </label>
              <div className="row">
                <button onClick={() => setCommit({ ...commit, prompt: defaultCommitMessage.prompt })}>
                  {t('settings.commit.resetPrompt')}
                </button>
                <span className="muted small">
                  {commit.agentId === COMMIT_VIA_TAB ? t('settings.commit.note.tab') : t('settings.commit.note')}
                </span>
              </div>

              {commit.agentId !== COMMIT_VIA_TAB && commit.agentId !== COMMIT_VIA_SERVICE && (
                <p className="hint">
                  {t('settings.commit.customHint.a')}
                  <code>CLAUDE_CONFIG_DIR</code>
                  {t('settings.commit.customHint.b')}
                  <code>{'{outfile}'}</code>
                  {t('settings.commit.customHint.c')}
                  <code>codex exec</code>
                  {t('settings.commit.customHint.d')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {confirmExit && (
        <Modal title={t('settings.exit.title')} onClose={() => setConfirmExit(false)}>
          <p className="hint">{t('settings.exit.body')}</p>
          <div className="modal-actions">
            <button onClick={() => setConfirmExit(false)}>{t('settings.exit.back')}</button>
            <button onClick={onClose}>{t('settings.exit.discard')}</button>
            <button
              className="primary"
              onClick={() => {
                save()
                onClose()
              }}
            >
              {t('settings.exit.saveClose')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
