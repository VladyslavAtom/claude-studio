import { describe, expect, it } from 'vitest'
import { derivedHues, nameHue, projectColors } from '../src/renderer/src/lib/projectColor'

const near = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

describe('project colours', () => {
  it('a picked colour wins; otherwise the hue comes from the name and does not move', () => {
    const colors = projectColors([
      { id: 'a', name: 'shop', color: 'pink' },
      { id: 'b', name: 'infra' },
    ])
    expect(colors.get('a')).toBe('var(--project-pink)')
    expect(colors.get('b')).toBe(`oklch(var(--project-l) var(--project-c) ${nameHue('infra')})`)
    expect(nameHue('Infra ')).toBe(nameHue('infra'))
  })

  it('two names that hash close together are pulled apart, whatever the tab order', () => {
    // find two names whose hues land within 10°
    const names = Array.from({ length: 400 }, (_, i) => `p${i}`)
    let pair: [string, string] = ['', '']
    outer: for (const x of names)
      for (const y of names)
        if (x !== y && near(nameHue(x), nameHue(y)) < 10) {
          pair = [x, y]
          break outer
        }
    const projects = [
      { id: '1', name: pair[0] },
      { id: '2', name: pair[1] },
    ]
    const hues = derivedHues(projects)
    expect(near(hues.get('1') ?? 0, hues.get('2') ?? 0)).toBeGreaterThanOrEqual(40)
    expect(hues.get('1')).toBe(nameHue(pair[0]))
    expect(derivedHues([...projects].reverse())).toEqual(hues)
  })

  it('keeps away from a picked colour too', () => {
    const name = Array.from({ length: 400 }, (_, i) => `q${i}`).find((n) => near(nameHue(n), 250) < 10) ?? ''
    const hues = derivedHues([
      { id: '1', name: 'x', color: 'blue' },
      { id: '2', name },
    ])
    expect(near(hues.get('2') ?? 0, 250)).toBeGreaterThanOrEqual(40)
  })
})
