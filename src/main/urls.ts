/**
 * What the application is allowed to hand to the desktop.
 *
 * Terminal text is clickable, and that text is the output of agents and utilities — content
 * from elsewhere. On Linux an arbitrary scheme pulls on whatever handler is registered for it,
 * so only ordinary web links leave the process.
 *
 * The rule lives here rather than beside either caller because there are two of them — the
 * window's open handler and the `shell:openExternal` IPC — and a second copy of a security
 * check is a second thing to forget to update.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
