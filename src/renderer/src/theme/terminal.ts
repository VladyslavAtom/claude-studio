import type { ITheme } from '@xterm/xterm'
import type { ThemeName } from '../../../shared/types'

/**
 * The xterm palette. One of the two colour sets that cannot be written as CSS: xterm paints its
 * cells itself (into a WebGL texture atlas, in fact), so the 16 ANSI colours have to reach it as
 * an object. Everything else about the pane is styled in `styles/terminal.css`.
 *
 * Both themes keep the same meaning for a colour — red is an error, green is success, yellow is
 * a warning — because the programs writing into the terminal assume it. Only the lightness
 * changes sides.
 */

/** the dark palette, unchanged: a neutral grey background with GitHub-dark-ish ANSI colours */
const dark: ITheme = {
  background: '#1c1f21',
  foreground: '#d3d6d9',
  cursor: '#8ab4ff',
  cursorAccent: '#1c1f21',
  // a selection has to stay readable over any colouring the output uses, so the text colour
  // is pinned as well
  selectionBackground: '#3f4d63',
  selectionInactiveBackground: '#31383f',
  selectionForeground: '#f2f4f8',
  black: '#26292d',
  red: '#ff6b6b',
  green: '#7ee787',
  yellow: '#f2cc60',
  blue: '#79b8ff',
  magenta: '#d2a8ff',
  cyan: '#76e3ea',
  white: '#d6d9e0',
  brightBlack: '#6b7278',
  brightRed: '#ff8787',
  brightGreen: '#9ff0a6',
  brightYellow: '#ffe08a',
  brightBlue: '#9fcbff',
  brightMagenta: '#e2c5ff',
  brightCyan: '#a5f3f6',
  brightWhite: '#f2f4f8',
}

/**
 * The light palette is drawn for text on paper, not inverted from the dark one: the dark
 * theme's pastels (#7ee787, #f2cc60, #9ff0a6) hold almost no contrast against white and simply
 * disappear, and inverting a colour that works on near-black gives grey mud.
 *
 * The surface and the six meaningful colours are the app's own light values from
 * `styles/tokens.css` — `--bg`, `--fg`, `--accent-2`, and `--add`/`--del`/`--warn` for the
 * green, red and yellow that carry exactly those meanings in the output as well. The palette
 * therefore agrees with the interface around it instead of being a second opinion on what
 * "error red" is here.
 *
 * Magenta and cyan have no counterpart in the interface; they follow GitHub Light and the file
 * type badges (`--ft-media`, `--ft-conf`). The eight bright colours are the lighter sibling of
 * their pair, as in the dark theme — a program that emphasises with bright red must not come out
 * quieter than the plain red beside it.
 *
 * Measured against the background: the normal colours run 4.6–6.8:1, the brights 3.0–4.4:1.
 */
const light: ITheme = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#04408a',
  cursorAccent: '#ffffff',
  // same rule as the dark theme: the selection pins its own foreground, so selected text stays
  // readable whatever colour the program painted it in
  selectionBackground: '#b6d7ff',
  selectionInactiveBackground: '#dde3ea',
  selectionForeground: '#0d1117',
  black: '#24292f',
  red: '#c01c28',
  green: '#14722f',
  yellow: '#845700',
  blue: '#0757ba',
  magenta: '#6e40c9',
  cyan: '#0f6f7a',
  white: '#6e7781',
  brightBlack: '#5c636b',
  brightRed: '#e5484d',
  brightGreen: '#2da44e',
  brightYellow: '#b07d00',
  brightBlue: '#2178dd',
  brightMagenta: '#9a6ae6',
  brightCyan: '#2f96a5',
  brightWhite: '#8c959f',
}

/** pass to `useThemed` — the object is module-level so the memo inside it actually holds */
export const TERMINAL_THEMES: Record<ThemeName, ITheme> = { dark, light }
