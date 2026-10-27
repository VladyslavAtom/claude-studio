/// <reference types="vite/client" />
import type { Api } from '../../preload/index'

declare global {
  interface Window {
    api: Api
  }
}

/**
 * The custom properties components set inline. Named here so a `style` carrying one needs no
 * `as`, and a misspelt name fails to compile instead of styling nothing.
 */
declare module 'react' {
  interface CSSProperties {
    /** a session's nesting level in the list (`lib/sessionTree`) */
    '--depth'?: number
    /** the active project's colour token (`lib/projectColor`) */
    '--project'?: string
    /** a project tab's own colour token */
    '--tab-color'?: string
  }
}

export {}
