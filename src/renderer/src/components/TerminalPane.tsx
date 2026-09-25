import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { PtyDataEvent, PtyStartOptions, TerminalKind } from '../../../shared/types'
import { useT } from '../i18n'
import { middleCloseRecently } from '../lib/dnd'
import { isKey } from '../lib/keys'
import { createPathLinks } from '../lib/termLinks'
import { fileUrlToPath } from '../lib/termPaths'
import { useThemed } from '../theme/themeContext'
import { TERMINAL_THEMES } from '../theme/terminal'

/**
 * Fit the terminal to its host and report the resulting size — or report nothing.
 *
 * A background pane renders with `display: none`, so its host has a zero box. FitAddon measures
 * that, gives up, and `term.cols`/`term.rows` stay at xterm's untouched default of 80×24.
 * Handing those to `pty.start` is not harmless: on re-attach main reads them as a real size,
 * resizes the live pty and SIGWINCHes the agent, which redraws its TUI into 80 columns. So an
 * unmeasured pane sends no size at all and main leaves the pty as it is. Nothing is lost by
 * waiting — the moment the pane is shown, the effect below refits it and `term.onResize` sends
 * the true size through `pty.resize`.
 */
function fitToHost(host: HTMLElement, fit: FitAddon, term: Terminal): { cols: number; rows: number } | undefined {
  if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return undefined
  try {
    fit.fit()
  } catch {
    // host not laid out yet: still no size worth reporting
    return undefined
  }
  return { cols: term.cols, rows: term.rows }
}

/**
 * TRANSITIONAL. `PtyStartOptions` in src/shared/types.ts still declares `cols` and `rows` as
 * required, so "send no size" cannot be spelled out against it. The change is asked for and
 * belongs to whoever owns shared/ and main/pty.ts; once cols/rows are optional there, this
 * alias and the cast below both go, and so does main's `cols !== 80 || rows !== 24` sniff,
 * which is a guess at what this function now states outright.
 */
type StartOptions = Omit<PtyStartOptions, 'cols' | 'rows'> & { cols?: number; rows?: number }
const startPty = window.api.pty.start as unknown as (opts: StartOptions) => ReturnType<typeof window.api.pty.start>

/**
 * xterm's own ceiling on `scrollback`, and what «no limit» is spelled as when it reaches xterm.
 *
 * Read out of the installed @xterm/xterm rather than assumed: the option goes through
 * `Math.min(value, 4294967295)` and throws below zero, and the buffer caps its line count at the
 * same `MAX_BUFFER_SIZE`. So `Infinity` would in fact survive the clamp — it is not passed
 * anyway, because a value that is silently rewritten on the way in is a value nobody can read
 * back and recognise.
 *
 * At this size V8 hands the line array back in dictionary mode instead of allocating it (a
 * measured 0.03 ms for the array against 223 ms for a fast-mode 2^25 one, which would also have
 * cost 256 MB of empty slots up front). The price is ~0.7 µs per line stored instead of ~0.04 —
 * next to nothing against the parsing and painting of that same line, and paid only for the
 * lines that actually arrive.
 */
const XTERM_MAX_SCROLLBACK = 4_294_967_295

/** the setting, in the units and the spelling xterm takes */
function xtermScrollback(lines: number | null): number {
  return lines === null ? XTERM_MAX_SCROLLBACK : Math.max(0, Math.floor(lines))
}

/**
 * Copy the whole output of a tab. Selecting it with the mouse in an agent tab is awkward: the
 * TUI turns mouse mode on and keeps the events (selecting needs Shift held), and long output
 * repaints itself underneath. So there is a direct way to take the entire scrollback.
 *
 * Takes the terminal as an argument rather than reading it from a ref, because the keyboard
 * handler inside the mount effect already has it in hand.
 *
 * It walks the whole buffer, so what it costs follows the scrollback setting: at the old fixed
 * 5000 lines that was a few hundred kilobytes, and with no limit it is however much the tab has
 * printed. Deliberately left as it is — the whole point of the action is that it copies
 * everything, and a cap would quietly hand back less than the name promises. It is a keystroke a
 * person makes on purpose, once, not something on the output path.
 */
function copyAll(term: Terminal): void {
  const buffer = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buffer.length; i++) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
  }
  // a tail of blank lines is the unfilled screen, not output
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop()
  const text = lines.join('\n')
  if (!text) return
  void window.api.clipboard.write(text)
}

/** is there anything on the screen at all — a pane that never ran anything shows a blank one */
function hasVisibleText(term: Terminal): boolean {
  const buffer = term.buffer.active
  for (let i = 0; i < term.rows; i++) {
    const line = buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? ''
    if (line.trim()) return true
  }
  return false
}

/**
 * The last screen of this terminal, as the escapes that repaint it — what a sleeping tab shows
 * in place of the card.
 *
 * Taken on the way out and nowhere else: sleep kills the process and main drops its scrollback
 * with it, so after the fact there is nothing left to serialise. That puts this on a cleanup
 * path, where an exception would abandon the rest of the teardown — hence the catch, and hence
 * the empty string as the answer to everything that goes wrong. A tab with no screen worth
 * showing falls back to the card, which is the honest thing to show.
 *
 * `scrollback: 0` asks for the viewport alone: the whole scrollback is neither wanted nor cheap.
 * For a TUI agent the answer also carries the alternate screen it is really drawing on, which is
 * what makes the frozen screen look like the tab did.
 *
 * `excludeModes` is on, and that is the one deliberate departure from a faithful copy. The modes
 * include mouse tracking, and replaying it would have the frozen screen grab the pointer and
 * refuse a selection — on a terminal that can no longer answer a mouse report. What is left is a
 * screen a person can read and copy from.
 *
 * A pane that was never shown has no measured size, and its terminal is xterm's untouched 80×24;
 * serialising that is harmless, it is the buffer that is read and not the layout.
 */
function snapshotOf(term: Terminal, serialize: SerializeAddon): string {
  try {
    if (!hasVisibleText(term)) return ''
    return serialize.serialize({ scrollback: 0, excludeModes: true })
  } catch {
    return ''
  }
}

interface Props {
  id: string
  cwd: string
  kind: TerminalKind
  /** command typed into the shell on spawn; undefined for a plain shell */
  command?: string | undefined
  env?: Record<string, string> | undefined
  /** agent tabs take part in the idle-sleep policy */
  sleepable?: boolean | undefined
  /** lines of output kept to scroll back through; null is the setting's «no limit» */
  scrollbackLines: number | null
  active: boolean
  /**
   * Clear the scrollback when this number changes; 0 means it has never been asked for.
   *
   * A counter and not a callback because the direction is the other way round: the tab strip
   * has no way to reach the xterm instance, which is born and dies inside the effect below and
   * is never handed out. Every other traffic between the two is a callback going out, held in
   * `latest`; an imperative handle would be a second, opposite channel — a prop the pane
   * *observes* stays inside the one data flow the rest of the component already uses, and needs
   * no ref to survive a re-render.
   */
  clearSeq: number
  onExit?: (code: number) => void
  /** OSC title the process sets; agents put the current task summary there */
  onTitle?: (title: string) => void
  /** last command line typed in this terminal (shell tabs use it as their name) */
  onCommand?: (command: string) => void
  /** terminal rang the bell — agents do it when they finish or need an answer */
  onBell?: () => void
  /** output arrived (throttled): drives the running/idle indicator */
  onActivity?: () => void
  /** user typed something: clears the attention flag */
  onInput?: () => void
  /** the user reached into this pane at all — a click counts as having seen it, like typing does */
  onSeen?: () => void
  /**
   * The agent refused to start over its conversation id: 'in-use' means the conversation
   * exists and must be resumed, 'missing' means it is gone and we have to start afresh.
   */
  onSessionError?: (kind: 'in-use' | 'missing') => void
  /**
   * A file path printed in the output was clicked. The path is already absolute; `line` is the
   * `:42` the output appended when it named a place in the file. The pane cannot open it itself
   * — it knows neither the project nor the session an editor tab would belong to.
   */
  onOpenPath?: (path: string, line?: number) => void
  /**
   * What was on the screen when this pane went away — sleep, close or a switch to another
   * session, the pane cannot tell them apart and does not need to. A sleeping tab shows it back;
   * for a tab that closes it costs one string that its own bookkeeping throws away.
   */
  onSnapshot?: (text: string) => void
}

export default function TerminalPane({
  id,
  cwd,
  kind,
  command,
  env,
  sleepable,
  scrollbackLines,
  active,
  clearSeq,
  onExit,
  onTitle,
  onCommand,
  onSessionError,
  onBell,
  onActivity,
  onInput,
  onSeen,
  onOpenPath,
  onSnapshot,
}: Props): JSX.Element {
  const t = useT()
  const palette = useThemed(TERMINAL_THEMES)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** right-button menu: window coordinates, or null while it is closed */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  /** the path link under the pointer: window coordinates plus what a click would open */
  const [linkAt, setLinkAt] = useState<{ x: number; y: number; path: string; line?: number } | null>(null)

  /**
   * Everything the terminal effect reads but must not re-run for.
   *
   * The effect owns a pty, and a pty is identified by `id` alone — main keys its table on it,
   * and the buffer, the scrollback and the running process all hang off that entry. Re-running
   * the effect therefore means disposing a live terminal and building a new one, so `[id]` is
   * the only honest dependency list. What the linter wanted added divides in two, and neither
   * half belongs in the deps:
   *
   * `cwd`, `kind`, `command`, `env`, `sleepable` are spawn arguments. They are read once, on
   * the call that creates the pty, and main ignores them on every later call for the same id —
   * it returns the existing buffer instead. Re-running on a change would tear down the visible
   * terminal to reattach to a process that is not affected by the change. A genuine respawn is
   * already a remount: TerminalArea keys the pane `id:nonce` and bumps the nonce.
   *
   * `onExit` is a callback fired from a subscription that outlives every render, exactly like
   * `onTitle`, `onCommand`, `onBell`, `onActivity`, `onInput` and `onSessionError`. Those six
   * were already held in refs; `onExit` was called straight from the closure, so it stayed
   * pinned to the props of the first render. Today the parent happens to pass a closure over
   * nothing but stable values, which is why the bug has never shown — it is the same latent
   * defect as the other six, and it is fixed the same way rather than left to chance.
   * `onOpenPath` joins them: a link provider is built once, with the terminal, and the link it
   * hands to xterm is clicked long after the render that supplied the callback. So does
   * `onSnapshot`, which is the extreme case of the same thing — it is called from the effect's
   * own cleanup, at the one moment no render can be in flight.
   *
   * `t` is here for the same reason as the callbacks: the two status lines the effect writes
   * into the terminal are worded through it, and switching the language must not tear the pty
   * down. What is already on screen keeps the wording it was written with — it is scrollback,
   * not markup, and nothing can go back and re-render a line the terminal has already taken.
   *
   * `palette` is read once, to construct the terminal. A later theme change is pushed into the
   * live instance by the effect below instead — see there for why a remount is not an option.
   * `scrollbackLines` is here for exactly the same reason and is pushed the same way.
   *
   * Filled from an effect, not during render: a ref written while rendering does not survive
   * a render React throws away.
   */
  const live = {
    command,
    cwd,
    env,
    kind,
    palette,
    scrollbackLines,
    sleepable,
    t,
    onExit,
    onTitle,
    onCommand,
    onBell,
    onActivity,
    onInput,
    onSessionError,
    onOpenPath,
    onSnapshot,
  }
  const latest = useRef(live)
  useEffect(() => {
    latest.current = live
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    /**
     * A link that was clicked, wherever it came from.
     *
     * `file:` goes to the application's own editor — the same place a bare path in the output
     * goes — and everything else to the desktop browser, where main has the final say on the
     * scheme. Neither may go through `window.open()`: xterm's own handlers call it with no
     * address and then assign `location.href` to the window they get back, and our window-open
     * policy denies that (it is shown `about:blank`, which is nothing it can vet), so the call
     * returns null and the click does nothing at all.
     */
    const openLink = (uri: string): void => {
      const path = fileUrlToPath(uri)
      if (path) {
        latest.current.onOpenPath?.(path, undefined)
        return
      }
      void window.api.system.openExternal(uri)
    }

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", "DejaVu Sans Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: xtermScrollback(latest.current.scrollbackLines),
      allowProposedApi: true,
      theme: latest.current.palette,
      /**
       * OSC 8 hyperlinks — the terminal standard for marking text up as a link, which the agent
       * CLIs use. xterm surfaces them only through this handler; without one it offers a
       * `confirm()` and then that same dead `window.open()`. `allowNonHttpProtocols` is what
       * lets a `file:` link through to us at all: xterm drops every non-web scheme silently
       * otherwise, and a file is exactly what an agent links to most.
       */
      linkHandler: {
        allowNonHttpProtocols: true,
        activate: (_event, uri) => openLink(uri),
      },
    })
    const fit = new FitAddon()
    const searchAddon = new SearchAddon()
    const serializeAddon = new SerializeAddon()
    term.loadAddon(fit)
    term.loadAddon(searchAddon)
    term.loadAddon(serializeAddon)
    // plain http(s) in the text, as opposed to text marked up as a link; the addon's own handler
    // is the dead `window.open()` route, so it is replaced rather than configured
    term.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)))
    searchRef.current = searchAddon
    term.open(host)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // no GL context available -> xterm falls back to the DOM renderer
    }
    termRef.current = term
    fitRef.current = fit
    const size = fitToHost(host, fit, term)

    /**
     * File paths in the output, linked.
     *
     * Registered after `WebLinksAddon` and not instead of it: xterm asks its providers in the
     * order they were added and takes the first that claims the cell, so http(s) stays the web
     * addon's and everything below is asked about what is left. The matcher refuses a
     * `scheme://` of its own accord as well, so neither can shadow the other by accident.
     *
     * The home directory is needed for `~` and arrives asynchronously; until it does, a `~`
     * path simply is not linked, which is better than resolving it against nothing.
     */
    let home: string | null = null
    void window.api.system.homeDir().then((dir) => {
      home = dir
    })
    const pathLinks = createPathLinks(term, {
      cwd: () => latest.current.cwd,
      home: () => home,
      isFile: (path) => window.api.fs.isFile(path),
      open: (path, line) => latest.current.onOpenPath?.(path, line),
      hover: (event, path, line) => setLinkAt({ x: event.clientX, y: event.clientY, path, line }),
      leave: () => setLinkAt(null),
    })
    const pathLinkSub = term.registerLinkProvider(pathLinks.provider)

    // events can arrive before pty:start resolves; queue them and drop what the replayed buffer already covers
    const queued: PtyDataEvent[] = []
    let attached = false
    let lastActivity = 0
    let recent = ''
    const startedAt = Date.now()
    const offData = window.api.pty.onData((e) => {
      if (e.id !== id) return
      if (!attached) queued.push(e)
      else term.write(e.data)
      // the error messages arrive in the first seconds after start
      if (Date.now() - startedAt < 20_000) {
        recent = (recent + e.data).slice(-4000)
        if (/Session ID .* is already in use/i.test(recent)) {
          recent = ''
          latest.current.onSessionError?.('in-use')
        } else if (/No conversation found with session ID/i.test(recent)) {
          recent = ''
          latest.current.onSessionError?.('missing')
        }
      }
      const now = Date.now()
      if (now - lastActivity > 1500) {
        lastActivity = now
        latest.current.onActivity?.()
      }
    })
    const offExit = window.api.pty.onExit((e) => {
      if (e.id !== id) return
      // the escapes grey the line out; only the words between them are language
      term.write(`\r\n\x1b[90m${latest.current.t('terminal.exit.code', { code: e.exitCode })}\x1b[0m\r\n`)
      latest.current.onExit?.(e.exitCode)
    })

    const spawn = latest.current
    void startPty({
      id,
      cwd: spawn.cwd,
      kind: spawn.kind,
      ...(size ?? {}),
      // left out entirely rather than set to undefined: with exactOptionalPropertyTypes the
      // two are different things
      ...(spawn.command === undefined ? {} : { initialCommand: spawn.command }),
      ...(spawn.env === undefined ? {} : { env: spawn.env }),
      sleepable: Boolean(spawn.sleepable),
    }).then((res) => {
      if (res.buffer) term.write(res.buffer)
      attached = true
      for (const e of queued) if (e.seq > res.seq) term.write(e.data)
      queued.length = 0
      if (!res.alive) term.write(`\r\n\x1b[90m${latest.current.t('terminal.exit.notStarted')}\x1b[0m\r\n`)
      term.focus()
    })

    // terminal clipboard: Ctrl+C stays SIGINT for the agent, copying lives on Ctrl+Shift+C
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.ctrlKey && e.shiftKey && isKey(e, 'c')) {
        e.preventDefault()
        /**
         * Nothing selected copies nothing. This used to fall back to the whole scrollback, on
         * the reasoning that a key which leaves the clipboard untouched reads as a broken key.
         * That was wrong twice over: every terminal there is does nothing here, so nothing is
         * what the key is expected to do — and once the scrollback became unlimited the
         * fallback put an entire session's history into the clipboard. Which is what «copying
         * stopped working» turned out to be: not a key that did nothing, but a key that copied
         * megabytes of old output over what was wanted. The whole output still has a chord of
         * its own, Ctrl+Shift+A, where it is asked for rather than guessed at.
         */
        const sel = term.getSelection()
        if (sel) void window.api.clipboard.write(sel)
        return false
      }
      if ((e.ctrlKey && e.shiftKey && isKey(e, 'v')) || (e.shiftKey && e.key === 'Insert')) {
        // Chromium reads Ctrl+Shift+V and Shift+Insert as "paste" on its own and fires a
        // native paste event at xterm's hidden input. Without preventDefault both paths ran
        // and the text was pasted twice — so the browser's is killed and ours is kept.
        e.preventDefault()
        // term.paste wraps the text in a bracketed paste itself when the application has asked
        // for that mode; without it a multi-line paste is executed line by line in a shell, and
        // sent on the first Enter in an agent's composer
        void window.api.clipboard.read().then((text) => text && term.paste(text))
        return false
      }
      // Ctrl+Shift+A — the whole output of the tab: selecting it with the mouse inside a TUI
      // is painful
      if (e.ctrlKey && e.shiftKey && isKey(e, 'a')) {
        e.preventDefault()
        copyAll(term)
        return false
      }
      if (e.ctrlKey && e.key === 'Insert') {
        e.preventDefault()
        const sel = term.getSelection()
        if (sel) void window.api.clipboard.write(sel)
        return false
      }
      /**
       * Shift+Enter is a newline, not a send.
       *
       * A terminal has no way to say «Shift was held» on Return: the classic encoding has no
       * room for a modifier there, so both arrive as CR and the program cannot tell them apart.
       * The convention that grew around that is to send ESC CR — what Alt+Enter sends — and the
       * agent CLIs read it as «insert a line». It is what `/terminal-setup` writes into the
       * terminals it supports, and it is why a composer sends the message on Shift+Enter in
       * every terminal where nobody has.
       *
       * Sent straight to the pty rather than left to xterm, which would emit a plain CR.
       */
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Enter') {
        e.preventDefault()
        latest.current.onInput?.()
        window.api.pty.input(id, '\x1b\r')
        return false
      }
      return true
    })

    /**
     * X11/Wayland convention: a selection lands in PRIMARY, middle click pastes it.
     *
     * Coalesced, because this fires on every change of the selection — once per cell while a drag
     * is in progress — and under Wayland each write spawns a `wl-copy` that has to stay alive to
     * serve the text. Publishing the selection mid-drag serves no one: only what the button was
     * released on is worth having.
     */
    let selectionTimer: number | null = null
    const selectionSub = term.onSelectionChange(() => {
      if (selectionTimer !== null) window.clearTimeout(selectionTimer)
      selectionTimer = window.setTimeout(() => {
        selectionTimer = null
        const sel = term.getSelection()
        if (sel) void window.api.clipboard.write(sel, true)
      }, 250)
    })
    /**
     * Chromium pastes PRIMARY on a middle click by itself, and `preventDefault` on the press does
     * not call that off — so the text arrived twice, once from here and once from the browser.
     * Ours is the one worth keeping: it goes through the clipboard IPC, which under Wayland falls
     * back to wl-clipboard when Chromium hands back nothing. So the browser's copy is cancelled in
     * the paste handler below, and this is the mark it looks for.
     */
    let pastedAt = 0
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 1) return
      e.preventDefault()
      pastedAt = Date.now()
      void window.api.clipboard.read(true).then((text) => text && term.paste(text))
    }
    host.addEventListener('mousedown', onMouseDown)

    // right button: a terminal has no system menu, yet copying through one is the habit
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      setMenuAt({ x: e.clientX, y: e.clientY, hasSelection: Boolean(term.getSelection()) })
    }
    host.addEventListener('contextmenu', onContextMenu)

    // a middle click on a neighbouring tab closes it, but Chromium also pastes the primary
    // selection into the focused terminal — that paste is what gets cancelled here
    const onPaste = (e: ClipboardEvent): void => {
      // either the middle click closed a neighbouring tab, or it was ours and we have already
      // pasted; both leave Chromium about to paste the same text a second time
      if (!middleCloseRecently() && Date.now() - pastedAt > 300) return
      e.preventDefault()
      e.stopPropagation()
    }
    host.addEventListener('paste', onPaste, true)

    const inputSub = term.onData((data) => {
      latest.current.onInput?.()
      window.api.pty.input(id, data)
    })
    const bellSub = term.onBell(() => latest.current.onBell?.())
    const resizeSub = term.onResize(({ cols, rows }) => window.api.pty.resize(id, cols, rows))
    // agents repaint their title constantly; only surface real changes, and rarely
    let lastTitle = ''
    let lastTitleAt = 0
    const titleSub = term.onTitleChange((title) => {
      const now = Date.now()
      if (title === lastTitle || now - lastTitleAt < 2000) return
      lastTitle = title
      lastTitleAt = now
      latest.current.onTitle?.(title)
    })
    const offCommand = window.api.pty.onCommand((e) => {
      if (e.id === id) latest.current.onCommand?.(e.command)
    })

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
      offData()
      offExit()
      offCommand()
      host.removeEventListener('mousedown', onMouseDown)
      host.removeEventListener('contextmenu', onContextMenu)
      host.removeEventListener('paste', onPaste, true)
      pathLinkSub.dispose()
      pathLinks.dispose()
      selectionSub.dispose()
      // a pending selection write would fire into a disposed terminal
      if (selectionTimer !== null) window.clearTimeout(selectionTimer)
      inputSub.dispose()
      bellSub.dispose()
      resizeSub.dispose()
      titleSub.dispose()
      searchRef.current = null
      // while the instance is still alive: after `dispose` there is no buffer left to read, and
      // main has thrown its own copy away by the time anyone asks for the screen back
      latest.current.onSnapshot?.(snapshotOf(term, serializeAddon))
      serializeAddon.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // `id` is the whole dependency list on purpose — see `latest` above for why the spawn
    // options and the callbacks are read through a ref instead
  }, [id])

  /**
   * Repaint the running terminal when the theme changes.
   *
   * The palette cannot be a dependency of the effect above: that effect owns the pty attachment,
   * and re-running it disposes the terminal, drops the subscriptions and re-attaches — a theme
   * switch would flush the visible buffer of every open tab. Assigning `term.options.theme`
   * instead reaches the same instance: xterm hands the colours to its theme service, and both
   * renderers (WebGL and the DOM fallback) rebuild their atlas from it. Scrollback, selection,
   * cursor position and the process all stay as they are.
   *
   * Two details of xterm's API decide the shape of this. It compares the theme by reference, so
   * the new palette has to arrive as a fresh object — a mutated one is silently ignored. And the
   * assignment costs a texture-atlas rebuild, so the palette the constructor was already given
   * is remembered and not written back: without that, opening a tab would re-theme it in the
   * same breath as attaching the pty and replaying its buffer.
   */
  const applied = useRef(palette)
  useEffect(() => {
    const term = termRef.current
    if (!term || applied.current === palette) return
    applied.current = palette
    term.options.theme = { ...palette }
  }, [palette])

  /**
   * Push a changed scrollback limit into the running terminal.
   *
   * Same discipline as the theme above and for the same reason: the mount effect owns the pty
   * attachment, so this must not be a dependency of it — re-running it to change a number would
   * dispose the terminal and replay the buffer of every open tab. Assigning `term.options.scrollback`
   * reaches the live instance: xterm's buffer set listens for that option and resizes its line
   * list, keeping what still fits. The process, the selection and the cursor are untouched.
   *
   * The applied value is remembered, so the pane does not re-write the number its constructor was
   * already given — that assignment reallocates the line array, and doing it on mount would make
   * every newly opened tab pay for it.
   *
   * Lowering the limit throws away the lines above it, here and in main both. That is what
   * lowering it is for, and it is the one direction of this setting that loses anything.
   */
  const appliedScrollback = useRef(scrollbackLines)
  useEffect(() => {
    const term = termRef.current
    if (!term || appliedScrollback.current === scrollbackLines) return
    appliedScrollback.current = scrollbackLines
    term.options.scrollback = xtermScrollback(scrollbackLines)
  }, [scrollbackLines])

  /**
   * Drop the scrollback of the running terminal when the tab strip asks for it.
   *
   * `clear`, not `reset`: it keeps the line the cursor is on and throws away what is above,
   * which leaves an agent looking at the screen it was drawing on. `reset` would take the
   * current screen with it, along with the modes the TUI has set, and the tab would be blank
   * until something repainted it.
   *
   * The ref starts at the value the pane was mounted with, so a remount — a restart, a return to
   * this session — does not re-run a request that has already been served on a terminal which no
   * longer has anything to clear. Same guard as the palette above, for the same reason: the
   * effect has to tell "a new request" from "the value I was born with".
   */
  const clearedSeq = useRef(clearSeq)
  useEffect(() => {
    if (clearedSeq.current === clearSeq) return
    clearedSeq.current = clearSeq
    termRef.current?.clear()
  }, [clearSeq])

  // a hidden pane has zero size: refit and refocus when it comes back
  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => {
      try {
        fitRef.current?.fit()
        termRef.current?.focus()
      } catch {
        /* ignore */
      }
    }, 0)
    return () => window.clearTimeout(t)
  }, [active])

  // Ctrl+F searches the scrollback of the visible terminal
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && isKey(e, 'f')) {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        searchRef.current?.clearDecorations()
        termRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, searchOpen])

  const copyAllHere = (): void => {
    const term = termRef.current
    if (term) copyAll(term)
  }

  const copySelection = (): void => {
    const term = termRef.current
    if (!term) return
    const sel = term.getSelection()
    if (sel) void window.api.clipboard.write(sel)
    else copyAll(term)
  }

  const paste = (): void => {
    void window.api.clipboard.read().then((text) => text && termRef.current?.paste(text))
  }

  const find = (dir: 1 | -1): void => {
    const addon = searchRef.current
    if (!addon || !query) return
    if (dir === 1) addon.findNext(query)
    else addon.findPrevious(query)
  }

  return (
    <div
      className="term-wrap"
      style={{ display: active ? 'block' : 'none' }}
      // capture, because xterm handles the press on its own element to start a selection and
      // this must not depend on whether it lets the event through. A hidden pane cannot be
      // clicked, so «the user reached into this tab» needs no further test.
      onMouseDownCapture={() => onSeen?.()}
    >
      {searchOpen && (
        <div className="term-search">
          <input
            autoFocus
            placeholder={t('terminal.search.placeholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              searchRef.current?.findNext(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') find(e.shiftKey ? -1 : 1)
              if (e.key === 'Escape') {
                setSearchOpen(false)
                termRef.current?.focus()
              }
            }}
          />
          <button className="ghost" onClick={() => find(-1)} title={t('terminal.search.prev')}>
            ↑
          </button>
          <button className="ghost" onClick={() => find(1)} title={t('terminal.search.next')}>
            ↓
          </button>
          <button className="ghost" onClick={copyAllHere} title={t('terminal.search.copyAll')}>
            {t('terminal.search.copyAllLabel')}
          </button>
          <button
            className="ghost"
            title={t('terminal.search.close')}
            aria-label={t('terminal.search.close')}
            onClick={() => {
              setSearchOpen(false)
              termRef.current?.focus()
            }}
          >
            ×
          </button>
        </div>
      )}
      {menuAt && (
        <>
          <div
            className="term-menu-catch"
            onMouseDown={() => setMenuAt(null)}
            onContextMenu={(e) => e.preventDefault()}
          />
          <div className="term-menu" style={{ left: menuAt.x, top: menuAt.y }}>
            <button
              onClick={() => {
                copySelection()
                setMenuAt(null)
              }}
            >
              {menuAt.hasSelection ? t('terminal.menu.copy') : t('terminal.menu.copyAll')}
              <span className="muted small">Ctrl+Shift+C</span>
            </button>
            {menuAt.hasSelection && (
              <button
                onClick={() => {
                  copyAllHere()
                  setMenuAt(null)
                }}
              >
                {t('terminal.menu.copyAll')} <span className="muted small">Ctrl+Shift+A</span>
              </button>
            )}
            <button
              onClick={() => {
                paste()
                setMenuAt(null)
              }}
            >
              {t('terminal.menu.paste')} <span className="muted small">Ctrl+Shift+V</span>
            </button>
            <div className="sep" />
            <button
              onClick={() => {
                setMenuAt(null)
                setSearchOpen(true)
              }}
            >
              {t('terminal.menu.find')} <span className="muted small">Ctrl+F</span>
            </button>
          </div>
        </>
      )}
      {/* the hint follows the pointer, so it is kept clear of the right edge by hand: a fixed
          box positioned at the cursor is the one case a stylesheet cannot clamp */}
      {linkAt && (
        <div
          className="term-link-hint"
          style={{ left: Math.max(4, Math.min(linkAt.x + 12, window.innerWidth - 340)), top: linkAt.y + 18 }}
        >
          {linkAt.line === undefined
            ? t('terminal.link.open', { path: linkAt.path })
            : t('terminal.link.openAt', { path: linkAt.path, line: linkAt.line })}
        </div>
      )}
      <div className="term-host" ref={hostRef} />
    </div>
  )
}
