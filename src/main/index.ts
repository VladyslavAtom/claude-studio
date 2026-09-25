import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import { CHANNELS } from '../shared/channels'
import { hookPaths } from './agentHooks'
import * as agentTools from './agentTools'
import * as ipcAgents from './ipc/agents'
import * as ipcFiles from './ipc/files'
import * as ipcGit from './ipc/git'
import * as ipcPty from './ipc/pty'
import * as ipcSystem from './ipc/system'
import * as ptys from './pty'
import { shutdownService } from './serviceAgent'
import { isSafeExternalUrl } from './urls'

let mainWindow: BrowserWindow | null = null

/**
 * The live window, or null. `mainWindow` is cleared on `closed`, but between `close` and
 * `closed` (and in diagnostic runs, which close the window themselves) the object is already
 * destroyed and a call to any of its methods throws — hence `isDestroyed` is asked as well.
 */
function liveWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

// the debounced state:save in the renderer (App.tsx) defers the write by 400ms — without this
// flag a quit in the middle of that window loses the last mutation of the state
let quitReady = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1c1f21',
    title: 'Claude Studio',
    // the window and taskbar icon: in development the path leads into the sources, in a build into the resources
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  const win = mainWindow

  // The default Electron menu binds Ctrl+Shift+I and Ctrl+Shift+C to DevTools —
  // and Ctrl+Shift+C is exactly what one presses to copy from a terminal.
  // Native editing shortcuts inside inputs keep working without a menu.
  Menu.setApplicationMenu(null)
  const devTools = process.env.ELECTRON_RENDERER_URL || process.env.CS_DEV === '1'
  win.webContents.on('before-input-event', (event, input) => {
    if (!devTools || input.type !== 'keyDown' || input.key !== 'F12') return
    event.preventDefault()
    liveWindow()?.webContents.toggleDevTools()
  })

  win.on('ready-to-show', () => liveWindow()?.show())
  win.on('close', (event) => {
    // both a click on the cross and app.quit() (Cmd+Q, the menu) go through closing the window —
    // both are caught at once, giving the renderer a chance to flush its deferred state write
    if (quitReady) return
    event.preventDefault()
    win.webContents.send(CHANNELS.app.beforeQuit)
    setTimeout(() => {
      if (quitReady) return
      quitReady = true
      liveWindow()?.close()
    }, 2000)
  })
  // On macOS `window-all-closed` deliberately does not quit the app, so the window goes away
  // while the process lives on: without this `mainWindow` stays a reference to a destroyed
  // object, and app:isFocused, a click on a notification and app:quitReady all throw.
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    // A backstop, not the way links are opened: the renderer asks `shell:openExternal` directly.
    // This handler cannot serve xterm, which calls `window.open()` with no address and assigns
    // `location.href` to the window it gets back — denied here, that returns null and the link
    // silently goes nowhere. Every http(s) link in the terminal was dead this way.
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  /**
   * The renderer's warnings and errors go to the same log as main's.
   *
   * Without this they live in devtools, which nobody has open when a fault appears an hour into
   * a session — and the report that reaches us is «it stopped working», with nothing to read.
   * Only warn and error: `console.log` in a renderer is somebody's debugging, not a record.
   */
  win.webContents.on('console-message', (details) => {
    if (details.level !== 'warning' && details.level !== 'error') return
    console.error(`[renderer] ${details.message}`)
  })

  win.webContents.on('will-navigate', (event) => {
    // an SPA has no reason to navigate the frame itself: loadURL/loadFile never reach here
    // (Electron does not send will-navigate for programmatic navigation), so any attempt is a
    // jump along somebody else's link out of the page's content
    event.preventDefault()
  })
  win.webContents.on('did-finish-load', () => {
    const live = liveWindow()
    if (!live) return
    ptys.setSender(live.webContents)
    // the same window carries the requests agents make through their tool
    agentTools.setSender(live.webContents)
    if (process.env.CS_SMOKE === '1') {
      void import('./smoke').then(({ runSmoke }) => {
        const target = liveWindow()
        if (target) void runSmoke(target)
      })
    }
    if (process.env.CS_DIAG === '1') {
      live.webContents.on('console-message', (_e, level, message) => {
        if (level >= 2) console.log('[diag] console:', message.slice(0, 300))
      })
      setTimeout(() => {
        void liveWindow()
          ?.webContents.executeJavaScript(
            "JSON.stringify({ text: document.body.innerText.slice(0, 200), nodes: document.querySelectorAll('*').length, projects: document.querySelectorAll('.project-tabs .tab').length })",
          )
          .then((r) => {
            console.log('[diag] dom:', r)
            app.quit()
          })
      }, 4000)
    }
    if (process.env.CS_SHOT) {
      const dir = process.env.CS_SHOT
      void import('./screenshot').then(({ runScreenshots }) => {
        const target = liveWindow()
        if (target) void runScreenshots(target, dir)
      })
    }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcSystem.register({
    window: liveWindow,
    quitReady: () => {
      quitReady = true
      liveWindow()?.close()
    },
  })
  ipcGit.register()
  ipcFiles.register()
  ipcAgents.register()
  ipcPty.register()
}

// dev: run against a throwaway state dir (screenshots, smoke runs)
if (process.env.CS_USERDATA) app.setPath('userData', process.env.CS_USERDATA)

// two windows would fight over state.json and over the agents' conversation ids;
// diagnostic runs (smoke, screenshots) are exempt so they can run alongside a real window
const soloGuard = !process.env.CS_USERDATA && !process.env.CS_SMOKE && !process.env.CS_SHOT
if (soloGuard && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = liveWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

app.whenReady().then(() => {
  registerIpc()
  // writes the hook overlay and the notify program, and sweeps the reports of the previous run;
  // not awaited, because the first tab cannot start before the renderer has asked for the paths
  void hookPaths()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  ptys.killAll()
  shutdownService()
})
