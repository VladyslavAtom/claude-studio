import type { Dict } from '../../keys'
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

/** typed as Dict: a whole area left out here is an error, not a hole found in the UI later */
export const ru: Dict = {
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
