/**
 * Line endings of a file the editor or the diff view writes back.
 *
 * CodeMirror splits a document on `\r\n`, `\r` and `\n` alike and hands it back joined with
 * `\n`, so a CRLF file read into it came out LF on the first save — every line a change. The
 * buffer and the "saved" text are therefore compared in LF, and the file's own ending is put
 * back only on the way to disk.
 */

export type Eol = '\n' | '\r\n'

/** the ending most lines of `text` use; a file with no line break at all is LF */
export function detectEol(text: string): Eol {
  const crlf = text.split('\r\n').length - 1
  const lf = text.split('\n').length - 1 - crlf
  return crlf > 0 && crlf >= lf ? '\r\n' : '\n'
}

/** `text` as CodeMirror holds it: every line break a `\n` */
export function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** an LF buffer with the file's ending put back */
export function withEol(text: string, eol: Eol): string {
  return eol === '\n' ? text : text.replace(/\n/g, eol)
}
