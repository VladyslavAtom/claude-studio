/**
 * How a prompt is typed into a live agent tab: the one shape for every place that hands an agent
 * text — `send_to_session` and review comments. The write itself is `lib/agentSubmit`; this half
 * is pure and tested.
 *
 * Multi-line text goes as a bracketed paste: it arrives as one input instead of being submitted
 * line by line. A single line is typed raw — a permission menu reads keys, not a paste. Claude
 * Code and Codex both take a bracketed paste into their composer and submit on the Enter that
 * follows; the Enter is a separate write, because the TUI takes a paste and an Enter in the same
 * chunk as part of the paste.
 */

export const PASTE_START = '\x1b[200~'
export const PASTE_END = '\x1b[201~'
export const SUBMIT_DELAY_MS = 60

/** what is written before the Enter */
export function typedForm(text: string): string {
  return /[\r\n]/.test(text) ? PASTE_START + text + PASTE_END : text
}
