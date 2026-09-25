import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { CHANNELS } from '../../shared/channels'
import * as files from '../files'

/** reading and writing the project's files; `files.ts` is what keeps them inside the allowed roots */
export function register(): void {
  ipcMain.handle(CHANNELS.files.readDir, (_e, dir: string) => files.readDir(dir))
  ipcMain.handle(CHANNELS.files.read, (_e, path: string) => files.readFile(path))
  ipcMain.handle(CHANNELS.files.write, (_e, path: string, content: string) => files.writeFile(path, content))
  // an explicit root registration for cases the state knows nothing about (a directory picked
  // through dialog:pickDirectory that has not been saved as a project yet, for one)
  ipcMain.handle(CHANNELS.files.registerRoot, (_e, path: string) => files.registerRoot(path))
  // a path clicked in terminal output: it registers that one file and nothing around it — see
  // openFromTerminal for why the grant is a file rather than a directory
  ipcMain.handle(CHANNELS.files.openFromTerminal, (_e, path: string) => files.openFromTerminal(path))

  // an existence check for a path: it needs no root — the answer is a yes or a no anyway
  ipcMain.handle(CHANNELS.fs.exists, async (_e, path: string) => {
    try {
      await fs.access(path)
      return true
    } catch {
      return false
    }
  })

  // «is there a file here», asked for every path-shaped run of characters the terminal shows.
  // Needs no root for the same reason as fs:exists, and answers no for a directory: a directory
  // is not a link, so the underline must not appear under one.
  ipcMain.handle(CHANNELS.fs.isFile, async (_e, path: string) => {
    try {
      return (await fs.stat(path)).isFile()
    } catch {
      return false
    }
  })
}
