import { changes } from './changes'
import { common } from './common'
import { editor } from './editor'
import { files } from './files'
import { git } from './git'
import { modals } from './modals'
import { projects } from './projects'
import { sessions } from './sessions'
import { settings } from './settings'
import { terminal } from './terminal'

/**
 * English is the source of truth: the key set of this object is the key set of the app, and
 * every other locale is typed against it. A key that is not here does not exist.
 */
export const en = {
  changes,
  common,
  editor,
  files,
  git,
  modals,
  projects,
  sessions,
  settings,
  terminal,
}
