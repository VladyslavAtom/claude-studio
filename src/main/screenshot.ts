/**
 * Dev helper: captures the window through Electron itself (Wayland screenshot tools
 * return blank frames for GPU-composited windows). Enabled with CS_SHOT=<output dir>.
 */
import { app, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function capture(win: BrowserWindow, dir: string, name: string): Promise<void> {
  const image = await win.webContents.capturePage()
  await fs.writeFile(join(dir, name), image.toPNG())
  console.log('[shot]', name)
}

const js = (win: BrowserWindow, code: string): Promise<unknown> => win.webContents.executeJavaScript(code)

/**
 * How the harness finds elements: CSS selectors, test ids and — for fixture files only — names.
 *
 * Controls used to be found by their Russian labels, which tied the harness to one locale: with
 * an English default every one of those lookups would come back empty. They are found by
 * `data-testid` now, so the wording of a button is free to change in any language without a
 * single edit here.
 */
const SEL = {
  change: '.change',
  changeCheckbox: '.change input[type=checkbox]',
  fileNode: '.fnode.file',
  dirNode: '.fnode.dir',
  branchButton: '.branch-btn',
  branchActions: '.branch-actions button',
  gitMore: '.git-branch .more',
  branchActionsTrigger: '.branch-actions .branch-name',
  settings: '.project-tabs .settings',
  settingsNav: '.settings-nav button',
  presetToggle: '.preset-wrap > button',
  termTab: '.term-tab',
  editorClose: '.editor-head .ghost',
  addSession: '.sessions .add',
} as const

/**
 * The controls the harness clicks, by the `data-testid` the renderer puts on them. A test id is
 * not a label: it never changes with the locale, and it is not read out to anybody.
 *
 * Until every attribute below is actually on its element, the click quietly does nothing and the
 * screenshot after it shows the screen before it — the harness cannot tell an absent attribute
 * from a control that was not there anyway. The comment on each entry says which element it
 * belongs on.
 */
const TID = {
  /** «Leave them asleep» in the startup question (StartupModal) */
  startupKeepAsleep: 'startup-keep-asleep',
  /** «⌛ N» in the tab strip, the run history (TerminalArea) */
  runHistory: 'run-history',
  /** «⌕ agents» in the session list header (SessionList) */
  agentHistoryOpen: 'agent-history-open',
  /** «↺ Revert» in the commit box (ChangesPanel) */
  revertSelected: 'revert-selected',
  /** the «no» button of a confirmation dialog — «Cancel» */
  modalCancel: 'modal-cancel',
  /** the button that closes a dialog which asks nothing — «Close» */
  modalClose: 'modal-close',
  /** the shown-directory switch, which now lives inside the session's branch menu (BranchActions) */
  scopeToggle: 'scope-toggle',
} as const

/**
 * Names of files in the throwaway repository the harness works on. These are fixture data, not
 * interface text: they read the same whatever language the window is in.
 */
const FILES = {
  readme: 'README',
  srcDir: 'src',
  libDir: 'lib',
  jwtFile: 'jwt.ts',
} as const

/** a click on the element carrying this test id */
function clickTestId(win: BrowserWindow, id: string): Promise<unknown> {
  return js(win, `document.querySelector('[data-testid=${JSON.stringify(id)}]')?.click()`)
}

/** a click on the first `sel` element whose text contains `text` — for file names, not for labels */
function clickByText(win: BrowserWindow, sel: string, text: string): Promise<unknown> {
  return js(
    win,
    `[...document.querySelectorAll(${JSON.stringify(sel)})].find((n) => n.textContent.includes(${JSON.stringify(text)}))?.click()`,
  )
}

/**
 * The question asked at startup («how to open the sessions») covers the window, so every case starts
 * with it. These two lines used to be copied out eight times.
 */
async function dismissStartup(win: BrowserWindow, settle = 700): Promise<void> {
  await clickTestId(win, TID.startupKeepAsleep)
  await wait(settle)
}

/** a single case to reproduce: CS_SHOT_CASE=<key> */
type ShotCase = (win: BrowserWindow, dir: string) => Promise<void>

const CASES: Record<string, ShotCase> = {
  /**
   * The frame in the README: one project, one session, the changes panel and a diff. Driven by
   * `tools/shot.mjs`, which builds the throwaway repository and the throwaway `userData` it
   * needs — the harness itself never sets a scene of its own.
   */
  hero: async (win, dir) => {
    await dismissStartup(win, 900)
    // the file tree is left closed on purpose: it narrows the diff, and the diff is the point
    await js(win, `document.querySelector('${SEL.change}')?.click()`)
    await wait(1800)
    await capture(win, dir, 'hero.png')
  },

  /**
   * The second frame in the README: an agent tab with the task it was started with. The scene is
   * `tools/shot.mjs agent`, which puts a real claude tab into the throwaway state — the CLI is
   * given time to answer, because a frame of an empty terminal says nothing about the product.
   */
  heroAgent: async (win, dir) => {
    await dismissStartup(win, 900)
    await wait(45_000)
    await capture(win, dir, 'heroAgent.png')
  },

  filetabs: async (win, dir) => {
    await dismissStartup(win)
    await js(win, `document.querySelector('${SEL.change}')?.click()`)
    await wait(1500)
    await js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }))`)
    await wait(700)
    await clickByText(win, SEL.fileNode, FILES.readme)
    await wait(1500)
    console.log(
      '[shot] tabs:',
      await js(win, `JSON.stringify([...document.querySelectorAll('.term-tab .tab-title')].map((n) => n.textContent))`),
    )
    console.log(
      '[shot] body:',
      await js(
        win,
        `(() => {
      const ed = document.querySelector('.editor-overlay')
      const df = document.querySelector('.diff-overlay')
      const r = (el) => el ? [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)] : null
      return JSON.stringify({ editor: r(ed), diff: r(df) })
    })()`,
      ),
    )
    await capture(win, dir, 'case-file-tabs.png')
  },

  gitmenu: async (win, dir) => {
    await dismissStartup(win)
    await js(win, `document.querySelector('${SEL.branchButton}')?.click()`)
    await wait(900)
    await js(win, `[...document.querySelectorAll('${SEL.gitMore}')][1]?.click()`)
    await wait(600)
    console.log(
      '[shot] menu:',
      await js(
        win,
        `(() => {
      const p = document.querySelector('.git-popup')
      const sub = document.querySelector('.git-submenu')
      if (!p) return 'the menu did not open'
      const pr = p.getBoundingClientRect()
      const sr = sub?.getBoundingClientRect()
      return JSON.stringify({
        actions: p.querySelectorAll('.git-action').length,
        branches: p.querySelectorAll('.git-branch').length,
        popup: [Math.round(pr.width), Math.round(pr.height)],
        submenu: sr
          ? {
              w: Math.round(sr.width),
              items: sub.querySelectorAll('button').length,
              onScreen: sr.left >= 0,
              hits: (() => { const el = document.elementFromPoint(sr.left + 20, sr.top + 20); return el ? el.className + '/' + el.tagName : 'nothing' })(),
              rect: [Math.round(sr.left), Math.round(sr.top)],
              parentOverflow: getComputedStyle(sub.parentElement.parentElement).overflowY,
            }
          : null,
      })
    })()`,
      ),
    )
    await capture(win, dir, 'case-git-menu.png')
  },

  scope: async (win, dir) => {
    await dismissStartup(win, 900)
    const probe = `(() => JSON.stringify({
      watched: document.querySelector('.changes-sub .watched')?.textContent,
      branch: document.querySelector('.changes-sub .branch')?.textContent,
      files: [...document.querySelectorAll('.change .path')].map((n) => n.textContent),
    }))()`
    console.log('[shot] worktree scope:', await js(win, probe))
    // the switch is one menu item stating the direction, not an on/off pair, so the branch menu
    // has to be opened first and there is no «active» item to read back
    await js(win, `document.querySelector('${SEL.branchActionsTrigger}')?.click()`)
    await wait(300)
    await clickTestId(win, TID.scopeToggle)
    await wait(2500)
    console.log('[shot] project scope:', await js(win, probe))
    const state = await js(
      win,
      `(async () => { const s = await window.api.state.load(); const p = s.projects[0]; return JSON.stringify({ root: p.path, cwd: p.sessions[0].cwd }) })()`,
    )
    const { root, cwd } = JSON.parse(state as string)
    console.log(
      '[shot] ipc root:',
      await js(
        win,
        `(async () => JSON.stringify((await window.api.git.status(${JSON.stringify(root)}, 'working')).files.map((f) => f.path)))()`,
      ),
    )
    console.log(
      '[shot] ipc worktree:',
      await js(
        win,
        `(async () => JSON.stringify((await window.api.git.status(${JSON.stringify(cwd)}, 'working')).files.map((f) => f.path)))()`,
      ),
    )
    await capture(win, dir, 'case-scope.png')
  },

  narrowdiff: async (win, dir) => {
    win.setSize(760, 620)
    await wait(500)
    await dismissStartup(win)
    await js(win, `document.querySelector('${SEL.change}')?.click()`)
    await wait(1200)
    console.log(
      '[shot] diff overlay:',
      await js(
        win,
        `(() => {
      const o = document.querySelector('.diff-overlay')
      if (!o) return 'not in the DOM'
      const r = o.getBoundingClientRect()
      const rows = o.querySelectorAll('.diff-table tr').length
      return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), rows })
    })()`,
      ),
    )
    console.log('[shot] changes list:', await js(win, `document.querySelectorAll('${SEL.change}').length`))
    await capture(win, dir, 'case-narrow-diff.png')
  },

  autosave: async (win, dir) => {
    await dismissStartup(win, 600)
    await js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }))`)
    await wait(800)
    await clickByText(win, SEL.fileNode, FILES.readme)
    await wait(1500)
    // type into the editor and wait for the autosave, without touching Ctrl+S
    await js(
      win,
      `(() => {
      const view = document.querySelector('.cm-content')
      view?.focus()
      document.execCommand('insertText', false, '\na line from the autosave\n')
    })()`,
    )
    await wait(2500)
    console.log(
      '[shot] editor status:',
      await js(win, `[...document.querySelectorAll('.editor-head .small')].map((n) => n.textContent).join(' | ')`),
    )
    await capture(win, dir, 'case-autosave.png')
  },

  history: async (win, dir) => {
    await dismissStartup(win, 600)
    await clickTestId(win, TID.runHistory)
    await wait(700)
    console.log(
      '[shot] menu visible:',
      await js(
        win,
        `(() => {
      const m = document.querySelector('.history-menu')
      if (!m) return 'not in the DOM'
      const r = m.getBoundingClientRect()
      const el = document.elementFromPoint(r.left + 20, r.top + 20)
      return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), hitsMenu: Boolean(el && m.contains(el)) })
    })()`,
      ),
    )
    await capture(win, dir, 'case-run-history.png')
  },

  settings: async (win, dir) => {
    await dismissStartup(win, 500)
    await js(win, `document.querySelector('${SEL.settings}')?.click()`)
    await wait(900)
    await capture(win, dir, 'case-settings-agents.png')
    await js(win, `document.querySelector('${SEL.presetToggle}')?.click()`)
    await wait(600)
    console.log(
      '[shot] preset menu:',
      await js(
        win,
        `(() => {
      const m = document.querySelector('.preset-menu')
      if (!m) return 'not in the DOM'
      const r = m.getBoundingClientRect()
      const items = m.querySelectorAll('button').length
      const el = document.elementFromPoint(r.left + 20, r.top + 20)
      return JSON.stringify({ items, w: Math.round(r.width), h: Math.round(r.height), visibleTop: r.top >= 0, hits: Boolean(el && m.contains(el)) })
    })()`,
      ),
    )
    await capture(win, dir, 'case-preset-menu.png')
    await js(win, `[...document.querySelectorAll('${SEL.settingsNav}')][1]?.click()`)
    await wait(500)
    await capture(win, dir, 'case-settings-sleep.png')
    console.log(
      '[shot] overflow:',
      await js(
        win,
        `(() => { const c = document.querySelector('.settings-content'); return JSON.stringify({ scrollH: c.scrollHeight, clientH: c.clientHeight, fits: c.scrollHeight <= c.clientHeight }) })()`,
      ),
    )
  },

  // BRANCH_ONLY: reproduces a narrow window with a long list of branches
  branches: async (win, dir) => {
    win.setSize(470, 560)
    await wait(600)
    await dismissStartup(win, 600)
    await js(win, `document.querySelector('${SEL.branchButton}')?.click()`)
    await wait(1200)
    await capture(win, dir, 'case-branches.png')
    console.log(
      '[shot] menu rect:',
      await js(win, `JSON.stringify(document.querySelector('.branch-menu')?.getBoundingClientRect() ?? null)`),
    )
    console.log('[shot] window inner:', await js(win, `JSON.stringify([innerWidth, innerHeight])`))
    console.log(
      '[shot] items:',
      await js(
        win,
        `(() => {
      const items = [...document.querySelectorAll('.branch-list button')].slice(0, 3)
      const menu = document.querySelector('.branch-menu')
      return JSON.stringify({
        count: document.querySelectorAll('.branch-list button').length,
        menu: { opacity: getComputedStyle(menu).opacity, filter: getComputedStyle(menu).filter, bg: getComputedStyle(menu).backgroundColor },
        items: items.map((b) => ({ text: b.innerText.slice(0, 24), color: getComputedStyle(b).color, opacity: getComputedStyle(b).opacity, size: getComputedStyle(b).fontSize, h: Math.round(b.getBoundingClientRect().height) })),
      })
    })()`,
      ),
    )
  },
}

/** the ordinary run: the full scenario across every screen of the application */
async function fullTour(win: BrowserWindow, dir: string): Promise<void> {
  // startup question, then leave everything asleep
  await capture(win, dir, '01-startup.png')
  await dismissStartup(win, 800)
  await capture(win, dir, '02-sleeping.png')

  // waking the agent: it names its own tab and rings the bell -> «waiting for you»
  await js(win, `document.querySelectorAll('${SEL.termTab}')[0]?.click()`)
  await wait(3500)
  await js(win, `document.querySelectorAll('${SEL.termTab}')[1]?.click()`) // look away so attention sticks
  await wait(800)
  await capture(win, dir, '03-attention.png')
  console.log(
    '[shot] tab classes:',
    JSON.stringify(await js(win, `[...document.querySelectorAll('${SEL.termTab}')].map((t) => t.className)`)),
  )
  // the project tab's own summary of everything under it: which dots, and what they say
  console.log(
    '[shot] project pulse:',
    JSON.stringify(
      await js(
        win,
        `[...document.querySelectorAll('.project-tabs .tab .pulse')].map((p) => ({
          dots: [...p.querySelectorAll('.dot')].map((d) => d.className),
          says: p.title,
        }))`,
      ),
    ),
  )

  // terminal search
  await js(win, `document.querySelectorAll('${SEL.termTab}')[0]?.click()`)
  await wait(500)
  await js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))`)
  await wait(600)
  await js(
    win,
    `(() => {
    const input = document.querySelector('.term-search input')
    if (!input) return
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'Refactoring')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`,
  )
  await wait(700)
  await capture(win, dir, '04-terminal-search.png')
  await js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  // branch actions: push / PR / rebase
  await wait(400)
  await js(win, `[...document.querySelectorAll('${SEL.branchActions}')][0]?.click()`)
  await wait(700)
  await capture(win, dir, '05-branch-actions.png')
  await js(win, `document.body.click()`)

  // revert confirmation for the checked files
  await wait(400)
  await js(
    win,
    `(() => {
    const boxes = [...document.querySelectorAll('${SEL.changeCheckbox}')]
    boxes[1]?.click()
    boxes[3]?.click()
  })()`,
  )
  await clickTestId(win, TID.revertSelected)
  await wait(700)
  await capture(win, dir, '06-revert.png')
  await clickTestId(win, TID.modalCancel)

  // editor with the «→ agent» bridge
  await wait(400)
  await js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }))`)
  await wait(800)
  await clickByText(win, SEL.dirNode, FILES.srcDir)
  await wait(600)
  await clickByText(win, SEL.dirNode, FILES.libDir)
  await wait(600)
  await clickByText(win, SEL.fileNode, FILES.jwtFile)
  await wait(1500)
  await capture(win, dir, '07-editor.png')
  await js(win, `document.querySelector('${SEL.editorClose}')?.click()`)

  // unified agent history: conversations from the CLIs' own stores
  await clickTestId(win, TID.agentHistoryOpen)
  await wait(1500)
  await capture(win, dir, '09-agent-history.png')
  console.log('[shot] external rows:', await js(win, `document.querySelectorAll('.ext-item').length`))
  console.log('[shot] marked as known:', await js(win, `document.querySelectorAll('.ext-item.known').length`))
  await clickTestId(win, TID.modalClose)

  // new session modal now asks for the first task
  await wait(400)
  await js(win, `document.querySelector('${SEL.addSession}')?.click()`)
  await wait(700)
  await capture(win, dir, '08-new-session.png')
}

export async function runScreenshots(win: BrowserWindow, dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  await wait(1800)

  const requested = process.env.CS_SHOT_CASE
  const single = requested ? CASES[requested] : undefined
  if (requested && !single)
    console.log('[shot] unknown CS_SHOT_CASE:', requested, '— available:', Object.keys(CASES).join(', '))

  if (single) await single(win, dir)
  else await fullTour(win, dir)

  app.quit()
}
