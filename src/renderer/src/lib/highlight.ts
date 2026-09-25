import { HighlightStyle } from '@codemirror/language'
import { highlightTree } from '@lezer/highlight'
import { tags as t } from '@lezer/highlight'
import { languageFor } from './editor'

/**
 * Highlighting for the diff. In the editor CodeMirror does this, but a diff is a plain table,
 * so the text is parsed here and the classes handed to the pieces. The classes are spelled out
 * (not the ones CodeMirror generates), or the colours would depend on whether an editor happens
 * to be mounted somewhere.
 */
const style = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], class: 'tok-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp], class: 'tok-string' },
  { tag: [t.number, t.bool, t.null], class: 'tok-number' },
  { tag: [t.comment, t.lineComment, t.blockComment], class: 'tok-comment' },
  { tag: [t.docComment], class: 'tok-doc' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: 'tok-fn' },
  { tag: [t.propertyName, t.attributeName], class: 'tok-attr' },
  { tag: [t.definition(t.propertyName), t.special(t.variableName)], class: 'tok-field' },
  { tag: [t.annotation, t.meta], class: 'tok-annotation' },
  { tag: [t.tagName], class: 'tok-tag' },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], class: 'tok-constant' },
  { tag: [t.heading], class: 'tok-heading' },
  { tag: [t.link, t.url], class: 'tok-link' },
  { tag: [t.invalid], class: 'tok-invalid' },
])

export interface Chunk {
  text: string
  cls: string | null
}

/** past this size parsing costs noticeably more than it gives: a diff is read in pieces anyway */
const MAX_CHARS = 400_000

/**
 * Parses the text as a whole and returns the pieces line by line: multi-line strings and
 * comments would fall apart if every line were highlighted on its own.
 */
export function highlightByLine(text: string, path: string): Chunk[][] | null {
  if (text.length > MAX_CHARS) return null
  const support = languageFor(path)
  if (!support) return null
  const language = 'language' in support ? support.language : support
  let tree
  try {
    tree = language.parser.parse(text)
  } catch {
    return null
  }

  // the line boundaries are what lays the continuous highlight ranges out over lines
  const lineStart: number[] = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStart.push(i + 1)

  const spans: { from: number; to: number; cls: string }[] = []
  highlightTree(tree, style, (from, to, cls) => {
    if (cls) spans.push({ from, to, cls })
  })

  const out: Chunk[][] = []
  let span = 0
  for (const [line, start] of lineStart.entries()) {
    // the last line has no boundary after it; every other one ends just before the newline
    const nextStart = lineStart[line + 1]
    const end = nextStart === undefined ? text.length : nextStart - 1
    const chunks: Chunk[] = []
    let pos = start
    // a highlighted range can run over into the next line — it gets cut at the boundary
    for (let s = spans[span]; s && s.from < end; s = spans[span]) {
      if (s.to <= start) {
        span++
        continue
      }
      const from = Math.max(s.from, start)
      const to = Math.min(s.to, end)
      if (from > pos) chunks.push({ text: text.slice(pos, from), cls: null })
      if (to > from) chunks.push({ text: text.slice(from, to), cls: s.cls })
      pos = to
      if (s.to > end) break
      span++
    }
    if (pos < end) chunks.push({ text: text.slice(pos, end), cls: null })
    out.push(chunks)
  }
  return out
}
