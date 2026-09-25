import { clipboard, dialog, ipcMain, Notification, shell, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { CHANNELS } from '../../shared/channels'
import type { AppState, StateHealth } from '../../shared/types'
import { registerStateRoots } from '../projectRoots'
import { encryptionStatus, lastLoadOutcome, loadState, savesBlocked, saveState } from '../store'
import { isSafeExternalUrl } from '../urls'

export interface SystemDeps {
  /** the live window or null: a BrowserWindow must not be touched after it closes */
  window: () => BrowserWindow | null
  /** the renderer has flushed the deferred state — closing may go ahead */
  quitReady: () => void
}

/**
 * The fallback path to the clipboard under Wayland. Under Wayland Chromium sometimes hands the
 * compositor neither the text nor the primary selection — the «copied» text then arrives
 * nowhere, and what was in the buffer before stays there. wl-clipboard talks to the compositor
 * directly; when it is not installed nothing is done at all — the ordinary path keeps working.
 */
function wlClipboard(argv: string[], input?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const [command, ...args] = argv
    if (!command) return resolve(null)
    try {
      const child = spawn(command, args, {
        stdio: input === undefined ? ['ignore', 'pipe', 'ignore'] : ['pipe', 'pipe', 'ignore'],
      })
      let out = ''
      child.stdout?.on('data', (d: Buffer) => {
        out += d.toString()
      })
      // a spawn that fails is the one failure the caller cannot tell from a successful copy:
      // both leave it with null, and null is also «there was nothing in the buffer»
      child.on('error', (err) => {
        console.error(`[clipboard] ${command} did not start: ${err.message}`)
        resolve(null)
      })
      child.on('close', (code) => {
        if (code !== 0) console.error(`[clipboard] ${command} exited ${code}`)
        resolve(code === 0 ? out : null)
      })
      if (input !== undefined) {
        child.stdin?.end(input)
      }
    } catch {
      resolve(null)
    }
  })
}

/**
 * Wayland is the case where Chromium's own clipboard is not the system's. On X11 it works, and
 * wl-clipboard is not installed there anyway.
 */
function onWayland(): boolean {
  return process.platform === 'linux' && Boolean(process.env.WAYLAND_DISPLAY)
}

/** state, dialogs, the clipboard, notifications and quitting — everything about the app itself */
export function register(deps: SystemDeps): void {
  ipcMain.handle(CHANNELS.state.load, async () => {
    const state = await loadState()
    registerStateRoots(state)
    return state
  })
  ipcMain.handle(CHANNELS.state.save, (_e, state: AppState) => {
    registerStateRoots(state)
    return saveState(state)
  })
  // how the state on disk is doing: what the last load had to recover from, what the env values
  // are encrypted with, and whether saving is refused. Settings shows it; nothing depends on it.
  ipcMain.handle(CHANNELS.state.health, (): StateHealth => ({
    load: lastLoadOutcome(),
    encryption: encryptionStatus(),
    saveBlocked: savesBlocked(),
  }))

  // the caption is the renderer's: it is the side that knows the locale, and both call sites
  // already pass one in. Without a caption the platform dialog uses its own, in the system's
  // language — a better fallback than a sentence this side would have to invent
  ipcMain.handle(CHANNELS.dialog.pickDirectory, async (_e, title?: string) => {
    const res = await dialog.showOpenDialog({
      ...(title ? { title } : {}),
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: homedir(),
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle(CHANNELS.shell.openPath, (_e, path: string) => shell.openPath(path))

  /**
   * A link clicked in the terminal. The address comes from an agent's output, so it is checked
   * here and not only in the renderer: the renderer is the side that handles untrusted text.
   * Answers whether it was opened, so the caller can say "not a link we open" rather than fail
   * in silence — which is what the previous route did.
   */
  ipcMain.handle(CHANNELS.shell.openExternal, async (_e, url: string) => {
    if (!isSafeExternalUrl(url)) return false
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle(CHANNELS.shell.showItemInFolder, (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle(CHANNELS.app.homeDir, () => homedir())

  ipcMain.handle(CHANNELS.app.notify, (_e, title: string, body: string) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent: true })
    n.on('click', () => {
      // the click can arrive after the window has closed — a notification lives a life of its own
      const win = deps.window()
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.focus()
    })
    n.show()
  })

  ipcMain.handle(CHANNELS.clipboard.write, async (_e, text: string, selection: boolean) => {
    const kind = selection && process.platform === 'linux' ? 'selection' : 'clipboard'
    clipboard.writeText(text, kind)
    if (!onWayland()) return
    // Measured on this desktop: under Wayland Chromium's write never reaches the compositor, and
    // a read straight after it returns Chromium's own cache — so the app agreed with itself while
    // every other window still held the previous contents. wl-clipboard is therefore not a
    // fallback here but the path that works, and it is taken without asking Chromium first: the
    // question the old check asked could only ever be answered yes.
    await wlClipboard(['wl-copy', ...(kind === 'selection' ? ['--primary'] : [])], text)
  })
  ipcMain.handle(CHANNELS.clipboard.read, async (_e, selection: boolean) => {
    const kind = selection && process.platform === 'linux' ? 'selection' : 'clipboard'
    // same isolation the other way round: Chromium answers with what this application last put
    // there, not with what another window has copied since. The compositor is asked first, and
    // Chromium is the fallback for when wl-clipboard is not installed.
    if (onWayland()) {
      const fromCompositor = await wlClipboard([
        'wl-paste',
        '--no-newline',
        ...(kind === 'selection' ? ['--primary'] : []),
      ])
      if (fromCompositor !== null) return fromCompositor
    }
    return clipboard.readText(kind)
  })

  ipcMain.handle(CHANNELS.app.isFocused, () => Boolean(deps.window()?.isFocused()))

  // the renderer calls this once it has flushed the deferred state in answer to app:beforeQuit
  ipcMain.handle(CHANNELS.app.quitReady, () => deps.quitReady())
}
