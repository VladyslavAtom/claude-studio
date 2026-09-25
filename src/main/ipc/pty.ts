import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/channels'
import type { PtyStartOptions } from '../../shared/types'
import * as ptys from '../pty'

const CH = CHANNELS.pty

/** input/resize go through `on`, not `handle`: a keystroke must not wait for an answer */
export function register(): void {
  ipcMain.handle(CH.sleepPolicy, (_e, enabled: boolean, minutes: number) => ptys.setSleepPolicy(enabled, minutes))
  ipcMain.handle(CH.scrollbackLimit, (_e, lines: number | null) => ptys.setScrollbackLimit(lines))
  ipcMain.handle(CH.start, (_e, opts: PtyStartOptions) => ptys.start(opts))
  ipcMain.on(CH.input, (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on(CH.resize, (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  ipcMain.handle(CH.sleep, (_e, id: string) => ptys.sleep(id))
  ipcMain.handle(CH.clearScrollback, (_e, id: string) => ptys.clearScrollback(id))
  ipcMain.handle(CH.kill, (_e, id: string) => ptys.kill(id))
  ipcMain.handle(CH.alive, (_e, id: string) => ptys.isAlive(id))
}
