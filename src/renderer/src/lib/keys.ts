/**
 * Which key was pressed, asked of the keyboard rather than of the layout.
 *
 * `KeyboardEvent.key` is the character the layout prints. In a Russian layout the key that says
 * `C` in the corner reports `с` — Cyrillic es, U+0441, which is a different character from Latin
 * `c` and merely looks the same. So every shortcut compared against `'c'` quietly stops existing
 * as soon as the layout is switched, and the report that comes back is «copying stopped working»
 * with nothing wrong anywhere near the clipboard.
 *
 * `code` names the physical key instead and does not move with the layout. That is the trade
 * every editor and browser makes for shortcuts, and it is the right one here: a shortcut belongs
 * to a position under the finger, not to a letter.
 *
 * `code` is empty on a synthesised event, so the character is still accepted as a fallback —
 * there is nothing to lose, since a layout that prints the Latin letter puts it on that key.
 */
export interface KeyStroke {
  /** the physical key, `KeyC` for the one marked C in a US layout */
  code: string
  /** the character that layout produces, which is what must not be trusted */
  key: string
}

export function isKey(e: KeyStroke, letter: string): boolean {
  if (e.code) return e.code === `Key${letter.toUpperCase()}`
  return e.key.toLowerCase() === letter.toLowerCase()
}
