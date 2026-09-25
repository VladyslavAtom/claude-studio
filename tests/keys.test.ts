import { describe, expect, it } from 'vitest'
import { isKey } from '../src/renderer/src/lib/keys'

/**
 * The layout trap. Every shortcut in the application used to be compared against the character
 * the layout prints, so switching to Russian silently removed all of them — and the fault was
 * reported as «copying stopped working», an hour of a session away from anything to do with the
 * clipboard. These cases are the ones that were actually observed in the log.
 */
describe('isKey', () => {
  it('matches the physical key in a Latin layout', () => {
    expect(isKey({ code: 'KeyC', key: 'C' }, 'c')).toBe(true)
    expect(isKey({ code: 'KeyV', key: 'V' }, 'v')).toBe(true)
  })

  // Cyrillic es is U+0441, Latin c is U+0063; they look the same and are not the same
  it('matches the same key when the layout prints Cyrillic', () => {
    expect(isKey({ code: 'KeyC', key: 'С' }, 'c')).toBe(true)
    expect(isKey({ code: 'KeyV', key: 'М' }, 'v')).toBe(true)
    expect(isKey({ code: 'KeyA', key: 'Ф' }, 'a')).toBe(true)
  })

  it('does not match a different key', () => {
    expect(isKey({ code: 'KeyX', key: 'X' }, 'c')).toBe(false)
    expect(isKey({ code: 'KeyC', key: 'C' }, 'v')).toBe(false)
  })

  // a lookalike character must not stand in for the key: this is the whole bug, reversed
  it('is not fooled by the Cyrillic letter arriving from another key', () => {
    expect(isKey({ code: 'KeyR', key: 'с' }, 'c')).toBe(false)
  })

  it('falls back to the character when there is no code at all', () => {
    expect(isKey({ code: '', key: 'C' }, 'c')).toBe(true)
    expect(isKey({ code: '', key: 'x' }, 'c')).toBe(false)
  })

  it('the letter asked for is not case-sensitive', () => {
    expect(isKey({ code: 'KeyC', key: 'C' }, 'C')).toBe(true)
  })
})
