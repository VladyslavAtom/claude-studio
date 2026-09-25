import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS } from '../shared/channels'
import type {
  AgentActivity,
  AgentHookPaths,
  AgentHookReport,
  AgentToolRequest,
  AgentToolResult,
  AppState,
  BranchInfo,
  ChangedFile,
  CommitDraftConfig,
  CommitInfo,
  DiffMode,
  ExternalSession,
  ExternalSessionQuery,
  FileContent,
  GitOpResult,
  GitStatusResult,
  OpResult,
  PtyCommandEvent,
  PtyDataEvent,
  PtyExitEvent,
  PtySleepEvent,
  PtyStartOptions,
  PtyStartResult,
  ReadDirResult,
  RepoState,
  SaveResult,
  ServiceConfig,
  StateHealth,
  WorktreeAddOptions,
} from '../shared/types'

// The payload shapes are declared once, in shared/types: a copy on the preload side drifted
// away from main silently — `ipcRenderer.invoke` types its arguments as any.
export type { PtyStartOptions, WorktreeAddOptions }

const api = {
  state: {
    load: (): Promise<AppState> => ipcRenderer.invoke(CHANNELS.state.load),
    /** a refusal is a value, not a throw: `ok: false` means the state on disk was left as it was */
    save: (state: AppState): Promise<SaveResult> => ipcRenderer.invoke(CHANNELS.state.save, state),
    /** state on disk: what the load had to recover from, how env values are protected, is saving refused */
    health: (): Promise<StateHealth> => ipcRenderer.invoke(CHANNELS.state.health),
  },
  dialog: {
    pickDirectory: (title?: string): Promise<string | null> => ipcRenderer.invoke(CHANNELS.dialog.pickDirectory, title),
  },
  fs: {
    exists: (path: string): Promise<boolean> => ipcRenderer.invoke(CHANNELS.fs.exists, path),
    /** a regular file, not a directory: what decides whether a path in output becomes a link */
    isFile: (path: string): Promise<boolean> => ipcRenderer.invoke(CHANNELS.fs.isFile, path),
  },
  clipboard: {
    write: (text: string, selection = false): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.clipboard.write, text, selection),
    read: (selection = false): Promise<string> => ipcRenderer.invoke(CHANNELS.clipboard.read, selection),
  },
  system: {
    notify: (title: string, body: string): Promise<void> => ipcRenderer.invoke(CHANNELS.app.notify, title, body),
    isFocused: (): Promise<boolean> => ipcRenderer.invoke(CHANNELS.app.isFocused),
    openPath: (path: string): Promise<string> => ipcRenderer.invoke(CHANNELS.shell.openPath, path),
    /** open a web link in the desktop browser; false when the address is not one we let out */
    openExternal: (url: string): Promise<boolean> =>
      ipcRenderer.invoke(CHANNELS.shell.openExternal, url),
    showItemInFolder: (path: string): Promise<void> => ipcRenderer.invoke(CHANNELS.shell.showItemInFolder, path),
    homeDir: (): Promise<string> => ipcRenderer.invoke(CHANNELS.app.homeDir),
  },
  git: {
    repoRoot: (dir: string): Promise<string | null> => ipcRenderer.invoke(CHANNELS.git.repoRoot, dir),
    currentBranch: (dir: string): Promise<string | null> => ipcRenderer.invoke(CHANNELS.git.currentBranch, dir),
    /** the main branch of the repository: the base for a pull request unless one is named */
    defaultBranch: (dir: string): Promise<string | null> => ipcRenderer.invoke(CHANNELS.git.defaultBranch, dir),
    status: (cwd: string, mode: DiffMode, baseRef?: string): Promise<GitStatusResult> =>
      ipcRenderer.invoke(CHANNELS.git.status, cwd, mode, baseRef),
    fileDiff: (
      cwd: string,
      file: string,
      mode: DiffMode,
      baseRef: string | undefined,
      untracked: boolean,
    ): Promise<string> => ipcRenderer.invoke(CHANNELS.git.fileDiff, cwd, file, mode, baseRef, untracked),
    commit: (cwd: string, files: string[], message: string): Promise<GitOpResult> =>
      ipcRenderer.invoke(CHANNELS.git.commit, cwd, files, message),
    draftCommitMessage: (
      cwd: string,
      files: string[],
      cfg: CommitDraftConfig,
      ref?: string,
    ): Promise<OpResult & { message?: string }> =>
      ipcRenderer.invoke(CHANNELS.git.draftCommitMessage, cwd, files, cfg, ref),
    diffSummary: (cwd: string, files: string[], ref?: string): Promise<string> =>
      ipcRenderer.invoke(CHANNELS.git.diffSummary, cwd, files, ref),
    revertFiles: (cwd: string, files: string[]): Promise<OpResult> =>
      ipcRenderer.invoke(CHANNELS.git.revertFiles, cwd, files),
    push: (cwd: string, branch: string, setUpstream: boolean): Promise<GitOpResult> =>
      ipcRenderer.invoke(CHANNELS.git.push, cwd, branch, setUpstream),
    hasUpstream: (cwd: string): Promise<boolean> => ipcRenderer.invoke(CHANNELS.git.hasUpstream, cwd),
    syncWithBase: (cwd: string, baseRef: string, mode: 'rebase' | 'merge'): Promise<GitOpResult> =>
      ipcRenderer.invoke(CHANNELS.git.syncWithBase, cwd, baseRef, mode),
    createPullRequest: (
      cwd: string,
      title: string,
      body: string,
      baseRef: string,
    ): Promise<OpResult & { url?: string }> =>
      ipcRenderer.invoke(CHANNELS.git.createPullRequest, cwd, title, body, baseRef),
    acceptSide: (cwd: string, file: string, side: 'ours' | 'theirs'): Promise<OpResult> =>
      ipcRenderer.invoke(CHANNELS.git.acceptSide, cwd, file, side),
    markResolved: (cwd: string, files: string[]): Promise<OpResult> =>
      ipcRenderer.invoke(CHANNELS.git.markResolved, cwd, files),
    repoState: (cwd: string): Promise<RepoState> => ipcRenderer.invoke(CHANNELS.git.repoState, cwd),
    continueOperation: (
      cwd: string,
      op: RepoState['operation'],
      action: 'continue' | 'skip' | 'abort',
    ): Promise<GitOpResult> => ipcRenderer.invoke(CHANNELS.git.continueOperation, cwd, op, action),
    branchInfo: (cwd: string): Promise<BranchInfo[]> => ipcRenderer.invoke(CHANNELS.git.branchInfo, cwd),
    fileAtRef: (cwd: string, ref: string, path: string): Promise<string | null> =>
      ipcRenderer.invoke(CHANNELS.git.fileAtRef, cwd, ref, path),
    listCommits: (cwd: string, range: string): Promise<CommitInfo[]> =>
      ipcRenderer.invoke(CHANNELS.git.listCommits, cwd, range),
    commitFiles: (cwd: string, hash: string): Promise<ChangedFile[]> =>
      ipcRenderer.invoke(CHANNELS.git.commitFiles, cwd, hash),
    pull: (cwd: string, strategy: 'merge' | 'rebase'): Promise<GitOpResult> =>
      ipcRenderer.invoke(CHANNELS.git.pull, cwd, strategy),
    merge: (cwd: string, branch: string): Promise<GitOpResult> => ipcRenderer.invoke(CHANNELS.git.merge, cwd, branch),
    rebaseOnto: (cwd: string, branch: string): Promise<GitOpResult> =>
      ipcRenderer.invoke(CHANNELS.git.rebaseOnto, cwd, branch),
    renameBranch: (cwd: string, from: string, to: string): Promise<OpResult> =>
      ipcRenderer.invoke(CHANNELS.git.renameBranch, cwd, from, to),
    deleteBranch: (cwd: string, branch: string, force: boolean): Promise<OpResult> =>
      ipcRenderer.invoke(CHANNELS.git.deleteBranch, cwd, branch, force),
    checkout: (cwd: string, branch: string): Promise<OpResult> =>
      ipcRenderer.invoke(CHANNELS.git.checkout, cwd, branch),
    createBranch: (cwd: string, branch: string, baseRef?: string): Promise<OpResult> =>
      ipcRenderer.invoke(CHANNELS.git.createBranch, cwd, branch, baseRef),
    worktreeAdd: (opts: WorktreeAddOptions): Promise<OpResult> => ipcRenderer.invoke(CHANNELS.git.worktreeAdd, opts),
    /** `warning` is a success with a caveat: the worktree is gone, the branch survived it */
    worktreeRemove: (
      repoPath: string,
      worktreePath: string,
      branch?: string,
    ): Promise<OpResult & { warning?: string }> =>
      ipcRenderer.invoke(CHANNELS.git.worktreeRemove, repoPath, worktreePath, branch),
    worktrees: (repoPath: string): Promise<{ path: string; branch: string | null }[]> =>
      ipcRenderer.invoke(CHANNELS.git.worktrees, repoPath),
    clone: (url: string, parentDir: string, name?: string): Promise<OpResult & { path?: string }> =>
      ipcRenderer.invoke(CHANNELS.git.clone, url, parentDir, name),
  },
  files: {
    /** a failure is not an empty directory: see ReadDirResult for the codes */
    readDir: (dir: string): Promise<ReadDirResult> => ipcRenderer.invoke(CHANNELS.files.readDir, dir),
    read: (path: string): Promise<FileContent> => ipcRenderer.invoke(CHANNELS.files.read, path),
    write: (path: string, content: string): Promise<OpResult> =>
      ipcRenderer.invoke(CHANNELS.files.write, path, content),
    /** a directory the renderer is allowed to reach: the project has just been opened */
    registerRoot: (path: string): Promise<void> => ipcRenderer.invoke(CHANNELS.files.registerRoot, path),
    /**
     * A path the user clicked in terminal output. Registers **that one file** as readable — the
     * click is the intent, and it buys one file, not its directory. Refuses a directory.
     */
    openFromTerminal: (path: string): Promise<OpResult> => ipcRenderer.invoke(CHANNELS.files.openFromTerminal, path),
  },
  app: {
    /** the window is closing: the renderer has to flush the state and answer with quitReady */
    onBeforeQuit: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on(CHANNELS.app.beforeQuit, handler)
      return () => ipcRenderer.removeListener(CHANNELS.app.beforeQuit, handler)
    },
    quitReady: (): Promise<void> => ipcRenderer.invoke(CHANNELS.app.quitReady),
  },
  agents: {
    listExternalSessions: (projectPath: string, queries: ExternalSessionQuery[]): Promise<ExternalSession[]> =>
      ipcRenderer.invoke(CHANNELS.agent.listExternalSessions, projectPath, queries),
    serviceAsk: (
      cfg: ServiceConfig,
      prompt: string,
      payload: string,
      timeoutMs?: number,
    ): Promise<OpResult & { message?: string }> =>
      ipcRenderer.invoke(CHANNELS.agent.serviceAsk, cfg, prompt, payload, timeoutMs),
    serviceWarmUp: (cfg: ServiceConfig): Promise<OpResult> => ipcRenderer.invoke(CHANNELS.agent.serviceWarmUp, cfg),
    serviceAlive: (): Promise<boolean> => ipcRenderer.invoke(CHANNELS.agent.serviceAlive),
    serviceStop: (): Promise<void> => ipcRenderer.invoke(CHANNELS.agent.serviceStop),
    sessionTitle: (kind: 'claude' | 'codex', id: string, configDir?: string): Promise<string | null> =>
      ipcRenderer.invoke(CHANNELS.agent.sessionTitle, kind, id, configDir),
    sessionExists: (kind: 'claude' | 'codex', id: string, configDir?: string): Promise<boolean> =>
      ipcRenderer.invoke(CHANNELS.agent.sessionExists, kind, id, configDir),
    /** what a tab is started with so its CLI reports back; null means it could not be set up */
    hookPaths: (): Promise<AgentHookPaths | null> => ipcRenderer.invoke(CHANNELS.agent.hookPaths),
    /** takes, not reads: the finished turns it reports are consumed, so the answer must be used */
    takeHookReport: (terminalId: string): Promise<AgentHookReport> =>
      ipcRenderer.invoke(CHANNELS.agent.takeHookReport, terminalId),
    /** the state a running claude reports for this conversation; null when nothing answers for it */
    activity: (sessionId: string, configDir?: string): Promise<AgentActivity | null> =>
      ipcRenderer.invoke(CHANNELS.agent.activity, sessionId, configDir),
    /** an agent asked, through the tool its tab was started with, for a session to be opened */
    onToolRequest: (cb: (r: AgentToolRequest) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: AgentToolRequest): void => cb(payload)
      ipcRenderer.on(CHANNELS.agent.toolRequest, handler)
      return () => ipcRenderer.removeListener(CHANNELS.agent.toolRequest, handler)
    },
    /** the answer to one such request; the agent's tool call is blocked until it arrives */
    replyToolRequest: (id: string, result: AgentToolResult): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.agent.toolReply, id, result),
  },
  pty: {
    sleepPolicy: (enabled: boolean, minutes: number): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.pty.sleepPolicy, enabled, minutes),
    /** the setting in its own unit — lines, or null for no limit; main converts to its own */
    scrollbackLimit: (lines: number | null): Promise<void> => ipcRenderer.invoke(CHANNELS.pty.scrollbackLimit, lines),
    start: (opts: PtyStartOptions): Promise<PtyStartResult> => ipcRenderer.invoke(CHANNELS.pty.start, opts),
    input: (id: string, data: string): void => ipcRenderer.send(CHANNELS.pty.input, id, data),
    resize: (id: string, cols: number, rows: number): void => ipcRenderer.send(CHANNELS.pty.resize, id, cols, rows),
    /** by hand, from the tab's menu; the answer to it is the `slept` event, as for the idle sweep */
    sleep: (id: string): Promise<void> => ipcRenderer.invoke(CHANNELS.pty.sleep, id),
    /** drop the buffer main replays on attach; the pane clears its own xterm instance */
    clearScrollback: (id: string): Promise<void> => ipcRenderer.invoke(CHANNELS.pty.clearScrollback, id),
    kill: (id: string): Promise<void> => ipcRenderer.invoke(CHANNELS.pty.kill, id),
    alive: (id: string): Promise<boolean> => ipcRenderer.invoke(CHANNELS.pty.alive, id),
    onData: (cb: (e: PtyDataEvent) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: PtyDataEvent): void => cb(payload)
      ipcRenderer.on(CHANNELS.pty.data, handler)
      return () => ipcRenderer.removeListener(CHANNELS.pty.data, handler)
    },
    onExit: (cb: (e: PtyExitEvent) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: PtyExitEvent): void => cb(payload)
      ipcRenderer.on(CHANNELS.pty.exit, handler)
      return () => ipcRenderer.removeListener(CHANNELS.pty.exit, handler)
    },
    onSlept: (cb: (e: PtySleepEvent) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: PtySleepEvent): void => cb(payload)
      ipcRenderer.on(CHANNELS.pty.slept, handler)
      return () => ipcRenderer.removeListener(CHANNELS.pty.slept, handler)
    },
    onCommand: (cb: (e: PtyCommandEvent) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: PtyCommandEvent): void => cb(payload)
      ipcRenderer.on(CHANNELS.pty.command, handler)
      return () => ipcRenderer.removeListener(CHANNELS.pty.command, handler)
    },
  },
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
