/**
 * The one table of IPC channel names. Both sides import it: `src/main/ipc/*` to register the
 * handlers, `src/preload/index.ts` to call them. Nothing else may spell a channel out as a
 * string literal — a name that exists in only one of the two processes fails at runtime, in
 * the middle of a user action, and never at build time.
 *
 * The names are deliberately left as they are, inconsistencies included (`git:branchInfo`
 * calls `listBranchInfo`, `git:worktrees` sits next to `git:worktreeAdd`): renaming a channel
 * is a renderer-visible change, because the renderer knows these operations by the method
 * names preload derives from them. Rename here, in one place, when that pass happens.
 *
 * Keys mirror the channel suffix, not the function that implements it, so a key and its
 * string can always be checked against each other by eye.
 */
export const CHANNELS = {
  state: {
    load: 'state:load',
    save: 'state:save',
    /** how the load went, what env values are encrypted with, and whether saving is refused */
    health: 'state:health',
  },
  dialog: {
    pickDirectory: 'dialog:pickDirectory',
  },
  fs: {
    exists: 'fs:exists',
    /** a regular file, not merely something that is there: a directory in output is not a link */
    isFile: 'fs:isFile',
  },
  shell: {
    openPath: 'shell:openPath',
    openExternal: 'shell:openExternal',
    showItemInFolder: 'shell:showItemInFolder',
  },
  clipboard: {
    write: 'clipboard:write',
    read: 'clipboard:read',
  },
  app: {
    homeDir: 'app:homeDir',
    notify: 'app:notify',
    isFocused: 'app:isFocused',
    /** main -> renderer: the window is being closed, the state has to be flushed */
    beforeQuit: 'app:beforeQuit',
    quitReady: 'app:quitReady',
  },
  git: {
    repoRoot: 'git:repoRoot',
    defaultBranch: 'git:defaultBranch',
    currentBranch: 'git:currentBranch',
    status: 'git:status',
    fileDiff: 'git:fileDiff',
    commit: 'git:commit',
    draftCommitMessage: 'git:draftCommitMessage',
    diffSummary: 'git:diffSummary',
    revertFiles: 'git:revertFiles',
    push: 'git:push',
    hasUpstream: 'git:hasUpstream',
    syncWithBase: 'git:syncWithBase',
    createPullRequest: 'git:createPullRequest',
    acceptSide: 'git:acceptSide',
    markResolved: 'git:markResolved',
    repoState: 'git:repoState',
    continueOperation: 'git:continueOperation',
    branchInfo: 'git:branchInfo',
    fileAtRef: 'git:fileAtRef',
    listCommits: 'git:listCommits',
    commitFiles: 'git:commitFiles',
    pull: 'git:pull',
    merge: 'git:merge',
    rebaseOnto: 'git:rebaseOnto',
    renameBranch: 'git:renameBranch',
    deleteBranch: 'git:deleteBranch',
    checkout: 'git:checkout',
    createBranch: 'git:createBranch',
    worktreeAdd: 'git:worktreeAdd',
    worktreeRemove: 'git:worktreeRemove',
    worktrees: 'git:worktrees',
    clone: 'git:clone',
  },
  files: {
    readDir: 'files:readDir',
    read: 'files:read',
    write: 'files:write',
    registerRoot: 'files:registerRoot',
    /** a path the user clicked in terminal output: that one file becomes readable */
    openFromTerminal: 'files:openFromTerminal',
  },
  agent: {
    listExternalSessions: 'agent:listExternalSessions',
    serviceAsk: 'agent:serviceAsk',
    serviceWarmUp: 'agent:serviceWarmUp',
    serviceAlive: 'agent:serviceAlive',
    serviceStop: 'agent:serviceStop',
    sessionTitle: 'agent:sessionTitle',
    sessionExists: 'agent:sessionExists',
    /** what a tab is started with so that its CLI reports back: an overlay, or a notify program */
    hookPaths: 'agent:hookPaths',
    /** what the tab's CLI has said since it was last asked; the read consumes the events */
    takeHookReport: 'agent:takeHookReport',
    /** what a running claude says it is doing, from the file it keeps per live session */
    activity: 'agent:activity',
    /** main -> renderer: an agent asked, through its MCP tool, for a session to be opened */
    toolRequest: 'agent:toolRequest',
    /** the renderer's answer to one such request; it travels back to the agent that asked */
    toolReply: 'agent:toolReply',
  },
  pty: {
    sleepPolicy: 'pty:sleepPolicy',
    /** how much scrollback main keeps for replay, in lines; null means no limit */
    scrollbackLimit: 'pty:scrollbackLimit',
    start: 'pty:start',
    /** send/on, not invoke: keystrokes must not pay for a round trip */
    input: 'pty:input',
    resize: 'pty:resize',
    /** put a tab to sleep by hand: the same kill-and-announce the idle sweep performs */
    sleep: 'pty:sleep',
    /** forget what a live terminal has printed, leaving the process alone; the renderer clears
     *  its own xterm instance, this is the copy main replays on the next attach */
    clearScrollback: 'pty:clearScrollback',
    kill: 'pty:kill',
    alive: 'pty:alive',
    /** main -> renderer */
    data: 'pty:data',
    exit: 'pty:exit',
    slept: 'pty:slept',
    command: 'pty:command',
  },
} as const
