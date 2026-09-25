import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { THEMES } from '../src/shared/types'

/**
 * The two failures these guard against are both invisible at review time: a property declared
 * for one theme and forgotten in the other silently keeps the other theme's value, and a colour
 * literal that creeps back into an area stylesheet simply stops following the theme.
 */
const STYLES_DIR = join(__dirname, '..', 'src', 'renderer', 'src', 'styles')
const TOKENS = readFileSync(join(STYLES_DIR, 'tokens.css'), 'utf8')

/** the custom properties declared inside one `:root…{ }` block, by its selector */
function blockProps(css: string, selectorPart: string): string[] {
  const start = css.indexOf(selectorPart)
  if (start === -1) throw new Error(`no block for ${selectorPart}`)
  const open = css.indexOf('{', start)
  const end = css.indexOf('\n}', open)
  const body = css.slice(open, end)
  return [...body.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1] as string).sort()
}

describe('theme tokens', () => {
  it('declares the same properties for every theme', () => {
    const dark = blockProps(TOKENS, "[data-theme='dark']")
    expect(dark.length).toBeGreaterThan(50)
    for (const theme of THEMES) {
      if (theme === 'dark') continue
      expect(blockProps(TOKENS, `[data-theme='${theme}']`), `theme '${theme}'`).toEqual(dark)
    }
  })

  it('keeps every colour literal in tokens.css', () => {
    const offenders: string[] = []
    for (const file of readdirSync(STYLES_DIR)) {
      if (!file.endsWith('.css') || file === 'tokens.css') continue
      // comments are blanked whole, keeping the line breaks: an explanation of why a colour was
      // rejected will name that colour, and it spans lines like any other prose
      const css = readFileSync(join(STYLES_DIR, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) =>
        c.replace(/[^\n]/g, ' '),
      )
      css.split('\n').forEach((line, i) => {
        if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('defines every custom property the stylesheets use', () => {
    const declared = new Set([...TOKENS.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1] as string))
    const missing = new Set<string>()
    for (const file of readdirSync(STYLES_DIR)) {
      if (!file.endsWith('.css')) continue
      const css = readFileSync(join(STYLES_DIR, file), 'utf8')
      for (const m of css.matchAll(/var\((--[a-z0-9-]+)/gi)) {
        const name = m[1] as string
        if (!declared.has(name)) missing.add(`${file}: ${name}`)
      }
    }
    expect([...missing]).toEqual([])
  })
})
