import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/channels'
import { branchPrs } from '../gh'

/** the read-only `gh` handlers; creating a PR stays with the git handlers, where the menus call it */
export function register(): void {
  ipcMain.handle(CHANNELS.gh.branchPrs, (_e, cwds: string[], force?: boolean) => branchPrs(cwds, force))
}
