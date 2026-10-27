import { describe, expect, it } from 'vitest'
import { PROJECT_COLORS } from '../src/shared/types'
import { colorOf, freeColor } from '../src/renderer/src/lib/projectColor'

describe('project colours', () => {
  it('a chosen colour wins; an absent one is derived from the path and does not move', () => {
    expect(colorOf({ color: 'pink', path: '/a' })).toBe('pink')
    const derived = colorOf({ path: '/home/me/repo' })
    expect(PROJECT_COLORS).toContain(derived)
    expect(colorOf({ path: '/home/me/repo' })).toBe(derived)
  })

  it('a new project takes the first colour nobody shows', () => {
    expect(freeColor([])).toBe('blue')
    expect(
      freeColor([
        { color: 'blue', path: '/a' },
        { color: 'green', path: '/b' },
      ]),
    ).toBe('teal')
  })

  it('with every colour taken, it takes the least used one rather than failing', () => {
    const all = PROJECT_COLORS.map((color, i) => ({ color, path: `/${i}` }))
    expect(freeColor([...all, { color: 'blue', path: '/x' }])).toBe('teal')
  })
})
