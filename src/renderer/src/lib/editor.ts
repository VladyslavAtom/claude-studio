import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting, StreamLanguage, type LanguageSupport } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { ThemeName } from '../../../shared/types'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'

/**
 * The editor palette — the second of the two colour sets that cannot live in CSS, because
 * CodeMirror builds its own stylesheet and its highlighting is keyed on syntax tags rather than
 * on classes we could style from `styles/`.
 *
 * One shape, two fillings, and the theme and the highlight style are both generated from it: a
 * colour named once cannot drift between the two, and a tag that gains a colour in one theme
 * cannot be forgotten in the other.
 */
interface Palette {
  bg: string
  fg: string
  caret: string
  selection: string
  gutterBg: string
  gutterFg: string
  activeLine: string
  activeLineGutterFg: string
  searchMatch: string
  searchMatchSelected: string
  selectionMatch: string
  bracket: string
  keyword: string
  string: string
  number: string
  comment: string
  docComment: string
  functionName: string
  field: string
  annotation: string
  tag: string
  attribute: string
  constant: string
  heading: string
  invalid: string
  link: string
}

/**
 * The syntax highlighting is JetBrains Darcula (WebStorm/PyCharm dark), as asked for. The
 * background, the line-number column and the active line, however, come from the app's own
 * palette: Darcula's native greys (#2b2b2b / #313335) are lighter than our nearly black
 * interface, and the editor looked like a foreign rectangle glued into the window.
 */
const C: Palette = {
  bg: '#1c1f21',
  fg: '#a9b7c6',
  caret: '#bbbbbb',
  selection: '#214283',
  gutterBg: '#212427',
  gutterFg: '#6b7278',
  activeLine: '#26292d',
  activeLineGutterFg: '#a4a3a3',
  searchMatch: '#32593d',
  searchMatchSelected: '#155221',
  selectionMatch: '#3a4b5c',
  bracket: '#3b514d',
  keyword: '#cc7832',
  string: '#6a8759',
  number: '#6897bb',
  comment: '#808080',
  docComment: '#629755',
  functionName: '#ffc66d',
  field: '#9876aa',
  annotation: '#bbb529',
  tag: '#e8bf6a',
  attribute: '#bababa',
  constant: '#9876aa',
  heading: '#ffc66d',
  invalid: '#ff6b68',
  link: '#287bde',
}

/**
 * The light counterpart is IntelliJ Light — Darcula's sibling in the same IDE, so the two agree
 * on what each thing *is*: keywords blue and heavy, strings green, numbers blue, methods teal,
 * fields and constants purple, annotations mustard. It is a scheme drawn for dark ink on paper,
 * not an inversion of Darcula; inverting would have given pale keywords on white.
 *
 * The syntax colours are not chosen here twice over: they are the `--tok-*` light values from
 * `styles/tokens.css`, the same ones the diff view paints with. The same file shown in the diff
 * and in the editor has to be coloured identically, and two copies of a palette drift apart on
 * the first correction to either.
 *
 * Same discipline as above for the greys: the surface is the app's `--editor-bg` (white in
 * light), the gutter `--bg-1`, the active line `--bg-2`, and the line numbers `--diff-lineno`,
 * which is what numbers a line everywhere else in the app.
 *
 * Comments sit at 5.2:1 — quieter than code at 15:1, but nowhere near IntelliJ's own #8c8c8c,
 * which is 3.0:1 on white and genuinely hard to read. Nothing that carries meaning is below
 * 5.2:1.
 */
const L: Palette = {
  bg: '#ffffff',
  fg: '#1f2328',
  caret: '#1f2328',
  selection: '#a6d2ff',
  gutterBg: '#f4f5f7',
  gutterFg: '#656d76',
  activeLine: '#e9ecf0',
  activeLineGutterFg: '#3d444d',
  searchMatch: '#fff8c5',
  searchMatchSelected: '#ffd66b',
  selectionMatch: '#ddf4ff',
  bracket: '#d7f3de',
  keyword: '#0033b3',
  string: '#067d17',
  number: '#1750eb',
  comment: '#656d76',
  docComment: '#3a6a2a',
  functionName: '#00627a',
  field: '#871094',
  annotation: '#7d6c00',
  tag: '#a03000',
  attribute: '#3d444d',
  constant: '#871094',
  heading: '#7a3e00',
  invalid: '#c01c28',
  link: '#0757ba',
}

function editorTheme(p: Palette, dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': { color: p.fg, backgroundColor: p.bg, height: '100%' },
      '.cm-content': {
        caretColor: p.caret,
        fontFamily: '"JetBrains Mono", "DejaVu Sans Mono", monospace',
        fontSize: '13px',
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.caret },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: p.selection,
      },
      '.cm-activeLine': { backgroundColor: p.activeLine },
      '.cm-gutters': { backgroundColor: p.gutterBg, color: p.gutterFg, border: 'none' },
      '.cm-activeLineGutter': { backgroundColor: p.activeLine, color: p.activeLineGutterFg },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
      '.cm-scroller': { lineHeight: '1.5' },
      '.cm-panels': { backgroundColor: p.gutterBg, color: p.fg },
      '.cm-searchMatch': { backgroundColor: p.searchMatch },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: p.searchMatchSelected },
      '.cm-selectionMatch': { backgroundColor: p.selectionMatch },
      '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: p.bracket, outline: 'none' },
    },
    // tells CodeMirror's own extensions (the search panel, the tooltips) which way round they go
    { dark },
  )
}

function editorHighlight(p: Palette): HighlightStyle {
  return HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: p.keyword },
    { tag: [t.string, t.special(t.string), t.regexp], color: p.string },
    { tag: [t.number, t.bool, t.null], color: p.number },
    { tag: [t.comment, t.lineComment, t.blockComment], color: p.comment, fontStyle: 'italic' },
    { tag: [t.docComment], color: p.docComment, fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: p.functionName },
    { tag: [t.propertyName, t.attributeName], color: p.attribute },
    { tag: [t.definition(t.propertyName), t.special(t.variableName)], color: p.field },
    { tag: [t.className, t.typeName, t.namespace], color: p.fg },
    { tag: [t.annotation, t.meta], color: p.annotation },
    { tag: [t.tagName], color: p.tag },
    { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: p.constant },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: p.fg },
    { tag: [t.heading], color: p.heading, fontWeight: 'bold' },
    { tag: [t.link, t.url], color: p.link, textDecoration: 'underline' },
    { tag: [t.emphasis], fontStyle: 'italic' },
    { tag: [t.strong], fontWeight: 'bold' },
    { tag: [t.invalid], color: p.invalid },
  ])
}

export const darculaTheme = editorTheme(C, true)
export const darculaHighlight = editorHighlight(C)
export const darcula: Extension = [darculaTheme, syntaxHighlighting(darculaHighlight)]

export const intellijLightTheme = editorTheme(L, false)
export const intellijLightHighlight = editorHighlight(L)
export const intellijLight: Extension = [intellijLightTheme, syntaxHighlighting(intellijLightHighlight)]

/**
 * Pass to `useThemed`. Module-level and built once: the extensions are values CodeMirror compares
 * by identity, so a fresh object per render would reconfigure the editor on every keystroke.
 */
export const EDITOR_THEMES: Record<ThemeName, Extension> = { dark: darcula, light: intellijLight }

const yamlLike = StreamLanguage.define<{ inString: boolean }>({
  startState: () => ({ inString: false }),
  token(stream) {
    if (stream.sol() && stream.match(/^\s*#.*/)) return 'comment'
    if (stream.match(/^\s*-\s/)) return 'operator'
    if (stream.match(/^[\w.-]+(?=\s*:)/)) return 'propertyName'
    if (stream.match(/^["'][^"']*["']/)) return 'string'
    if (stream.match(/^\d+(\.\d+)?/)) return 'number'
    if (stream.match(/^(true|false|null|yes|no)\b/)) return 'bool'
    stream.next()
    return null
  },
})

/** language support by file extension; unknown types open as plain text */
export function languageFor(path: string): LanguageSupport | ReturnType<typeof StreamLanguage.define> | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true })
    case 'tsx':
      return javascript({ typescript: true, jsx: true })
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript()
    case 'jsx':
      return javascript({ jsx: true })
    case 'py':
    case 'pyi':
      return python()
    case 'json':
    case 'jsonc':
      return json()
    case 'css':
    case 'scss':
    case 'less':
      return css()
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
      return html()
    case 'md':
    case 'markdown':
      return markdown()
    case 'yml':
    case 'yaml':
    case 'toml':
      return yamlLike
    default:
      return null
  }
}
