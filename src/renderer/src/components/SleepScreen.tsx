import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useT } from '../i18n'
import { useThemed } from '../theme/themeContext'
import { TERMINAL_THEMES } from '../theme/terminal'

interface Props {
  /** the tab's last screen, as the escapes `SerializeAddon` wrote for it */
  snapshot: string
  /** the tab's name, as the strip shows it */
  title: string
  /** an agent keeps its conversation across the sleep; a shell has nothing to keep */
  isAgent: boolean
  onWake: () => void
}

/**
 * What a sleeping tab shows: the screen it had when its process was killed, and the way back.
 *
 * A frozen screen instead of a card, because the card threw away everything the tab was about —
 * the answer half-read, the question the agent asked, the failure it stopped on. It is the same
 * output rendered by the same terminal, colours included, and there is no other way to keep
 * those: plain text turns an agent's output into a grey wall, which reads as breakage.
 *
 * That leaves one obligation. A dead screen must never be mistaken for a live one, and the way
 * back must not be something to go looking for — so a bar sits above it and says both, in words
 * and with the same `z` the tab strip uses. A bar rather than a button floating over the screen:
 * an overlay covers the output it is explaining, and a busy screen is exactly where a small
 * button goes unnoticed. The bar is always in the same place, whatever the screen underneath
 * looks like, and it costs the top two rows of an old screen.
 *
 * The terminal here is a viewer:
 *
 * - it is never handed to `pty.start`, so there is no process on the other end of it;
 * - `disableStdin` makes xterm drop every keystroke instead of sending it into the void, and
 *   nothing subscribes to `onData` anyway;
 * - the cursor is hidden with `\x1b[?25l` after the screen is written — a blinking cursor is the
 *   one thing that says «this terminal is waiting for you», and it is not;
 * - the textarea is taken out of the tab order: it is not a control, and stopping at it with the
 *   keyboard would only be a place where typing does nothing.
 *
 * Selection is left working on purpose — a person who came back to read the last screen usually
 * wants a line out of it.
 */
export default function SleepScreen({ snapshot, title, isAgent, onWake }: Props): JSX.Element {
  const t = useT()
  const palette = useThemed(TERMINAL_THEMES)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

  // read by the effect below, which must not re-run when the theme changes: rebuilding would
  // rewrite the whole screen. Declared first so that on mount it has already run.
  const latestPalette = useRef(palette)
  useEffect(() => {
    latestPalette.current = palette
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", "DejaVu Sans Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      // there is nothing to type into and nothing to wait for
      disableStdin: true,
      cursorBlink: false,
      // the bar above costs a row or two, so the top of the captured screen scrolls off; keeping
      // a little scrollback lets it be scrolled back into view instead of being lost
      scrollback: 200,
      allowProposedApi: true,
      theme: latestPalette.current,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    // no WebGL renderer here: one static screen is not worth a texture atlas and a GL context,
    // and this pane is built and torn down every time a tab is looked at while it sleeps
    try {
      fit.fit()
    } catch {
      // not laid out yet — the screen is written into the size xterm defaulted to
    }
    // The captured screen was serialised at the live pane's size, and this one is a couple of
    // rows shorter. Same columns, so nothing rewraps; the rows it cannot hold scroll off the
    // top, which is the right end to lose — what a person came back for is the last thing the
    // process said.
    term.write(snapshot + '\x1b[?25l')
    if (term.textarea) term.textarea.tabIndex = -1
    termRef.current = term

    const ro = new ResizeObserver(() => {
      if (!host.isConnected || host.clientWidth === 0) return
      try {
        fit.fit()
      } catch {
        /* ignore transient layout errors */
      }
    })
    ro.observe(host)

    return () => {
      ro.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [snapshot])

  // the theme can be switched while a tab sleeps; recolour the instance rather than rebuild it,
  // for the same reason as in TerminalPane — a rebuild would repaint the screen from scratch
  const applied = useRef(palette)
  useEffect(() => {
    const term = termRef.current
    if (!term || applied.current === palette) return
    applied.current = palette
    term.options.theme = { ...palette }
  }, [palette])

  return (
    <div className="sleep-screen">
      <div className="sleep-bar">
        <span className="zzz">z</span>
        <span className="what">
          {isAgent ? t('terminal.sleep.frozenAgent', { title }) : t('terminal.sleep.frozen', { title })}
        </span>
        <button className="primary" onClick={onWake}>
          {t('terminal.sleep.wake')}
        </button>
      </div>
      <div className="sleep-host" data-testid="sleep-screen" ref={hostRef} />
    </div>
  )
}
