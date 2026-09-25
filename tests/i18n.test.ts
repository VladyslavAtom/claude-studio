import { describe, expect, it } from 'vitest'
import type { Locale, PluralForms } from '../src/renderer/src/i18n/types'
import { detectLocale, resolveLocale } from '../src/renderer/src/i18n/detect'
import { pluralCategory, selectPlural } from '../src/renderer/src/i18n/plural'
import { entryOf, interpolate, translate, translatePlural } from '../src/renderer/src/i18n/translate'
import type { RawDict } from '../src/renderer/src/i18n/translate'
import { en } from '../src/renderer/src/i18n/locales/en'
import { ru } from '../src/renderer/src/i18n/locales/ru'
import { uk } from '../src/renderer/src/i18n/locales/uk'

const DICTS: Record<Locale, RawDict> = { en, ru, uk }

/** the placeholders a string interpolates, in the order they appear */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string)
}

function isForms(value: unknown): value is PluralForms {
  return typeof value === 'object' && value !== null
}

/** every key of every area, as the `area.key` a component writes */
function keysOf(dict: RawDict): string[] {
  return Object.entries(dict).flatMap(([area, entries]) => Object.keys(entries).map((k) => `${area}.${k}`))
}

describe('pluralCategory', () => {
  it('English has two forms', () => {
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('en', 0)).toBe('other')
    expect(pluralCategory('en', 2)).toBe('other')
    expect(pluralCategory('en', 21)).toBe('other')
  })

  // the same rule in both, and it disagrees with English at 21, 22 and every teen
  for (const locale of ['ru', 'uk'] as const) {
    it(`${locale} has three forms and the teens are all «many»`, () => {
      expect(pluralCategory(locale, 1)).toBe('one')
      expect(pluralCategory(locale, 21)).toBe('one')
      expect(pluralCategory(locale, 101)).toBe('one')
      expect(pluralCategory(locale, 2)).toBe('few')
      expect(pluralCategory(locale, 4)).toBe('few')
      expect(pluralCategory(locale, 22)).toBe('few')
      expect(pluralCategory(locale, 5)).toBe('many')
      expect(pluralCategory(locale, 0)).toBe('many')
      expect(pluralCategory(locale, 11)).toBe('many')
      expect(pluralCategory(locale, 12)).toBe('many')
      expect(pluralCategory(locale, 14)).toBe('many')
      expect(pluralCategory(locale, 111)).toBe('many')
      expect(pluralCategory(locale, 112)).toBe('many')
    })
  }

  it('a fraction takes «other» everywhere: «1,5 сессии» is not the slot of «1 сессия»', () => {
    expect(pluralCategory('en', 1.5)).toBe('other')
    expect(pluralCategory('ru', 1.5)).toBe('other')
    expect(pluralCategory('uk', 1.5)).toBe('other')
  })

  it('a negative number counts by its absolute value', () => {
    expect(pluralCategory('ru', -1)).toBe('one')
    expect(pluralCategory('ru', -13)).toBe('many')
  })
})

describe('selectPlural', () => {
  const forms: PluralForms = { zero: 'нет', one: 'одна', few: 'две', many: 'пять', other: 'дробь' }

  it('zero, when the locale spells it out, wins over the grammatical form', () => {
    expect(selectPlural(forms, 'ru', 0)).toBe('нет')
    expect(selectPlural({ one: 'one', other: 'other' }, 'ru', 0)).toBe('other')
  })

  it('a form the locale did not fill falls back to «other»', () => {
    expect(selectPlural({ one: 'one', other: 'other' }, 'ru', 3)).toBe('other')
  })

  it('the counted noun agrees in every locale', () => {
    const count = (locale: Locale, n: number): string =>
      translatePlural(DICTS[locale], en as unknown as RawDict, 'projects.sessionCount', locale, n)
    expect(count('en', 0)).toBe('no sessions')
    expect(count('en', 1)).toBe('1 session')
    expect(count('en', 5)).toBe('5 sessions')
    expect(count('ru', 0)).toBe('без сессий')
    expect(count('ru', 1)).toBe('1 сессия')
    expect(count('ru', 3)).toBe('3 сессии')
    expect(count('ru', 11)).toBe('11 сессий')
    expect(count('ru', 21)).toBe('21 сессия')
    expect(count('uk', 0)).toBe('без сесій')
    expect(count('uk', 1)).toBe('1 сесія')
    expect(count('uk', 3)).toBe('3 сесії')
    expect(count('uk', 11)).toBe('11 сесій')
    expect(count('uk', 22)).toBe('22 сесії')
  })
})

describe('the catalogue', () => {
  const enKeys = keysOf(en as unknown as RawDict)

  it('has keys at all — an empty source would make every check below pass', () => {
    expect(enKeys.length).toBeGreaterThan(50)
  })

  for (const locale of ['ru', 'uk'] as const) {
    it(`${locale} defines every key English defines, and no key English does not`, () => {
      expect(keysOf(DICTS[locale]).sort()).toEqual([...enKeys].sort())
    })

    it(`${locale} keeps plurals plural and strings string`, () => {
      for (const key of enKeys) {
        const source = entryOf(en as unknown as RawDict, key)
        const target = entryOf(DICTS[locale], key)
        expect(typeof target, key).toBe(typeof source)
      }
    })

    it(`${locale} fills all three Slavic forms wherever English has plural forms`, () => {
      for (const key of enKeys) {
        const target = entryOf(DICTS[locale], key)
        if (!isForms(entryOf(en as unknown as RawDict, key)) || !isForms(target)) continue
        expect(target.one, key).toBeTruthy()
        expect(target.few, key).toBeTruthy()
        expect(target.many, key).toBeTruthy()
        expect(target.other, key).toBeTruthy()
      }
    })

    it(`${locale} interpolates the same values as English`, () => {
      for (const key of enKeys) {
        const source = entryOf(en as unknown as RawDict, key)
        const target = entryOf(DICTS[locale], key)
        if (typeof source === 'string' && typeof target === 'string') {
          expect(placeholders(target).sort(), key).toEqual(placeholders(source).sort())
          continue
        }
        // a plural form may use {count} or not, but it must not ask for a value nobody passes
        if (!isForms(source) || !isForms(target)) continue
        const allowed = new Set(Object.values(source).flatMap(placeholders))
        for (const form of Object.values(target)) {
          for (const name of placeholders(form)) expect(allowed.has(name), `${key}: {${name}}`).toBe(true)
        }
      }
    })

    it(`${locale} leaves no wording empty`, () => {
      for (const key of enKeys) {
        const target = entryOf(DICTS[locale], key)
        const texts = typeof target === 'string' ? [target] : Object.values(target ?? {})
        for (const text of texts) expect(text.trim(), key).not.toBe('')
      }
    })
  }
})

describe('translate', () => {
  const dict: RawDict = { area: { greeting: 'Привет, {name}!' } }
  const fallback: RawDict = { area: { greeting: 'Hello, {name}!', only: 'English only' } }

  it('interpolates what it is given and leaves what it is not', () => {
    expect(interpolate('Merge «{branch}» into current', { branch: 'feature' })).toBe('Merge «feature» into current')
    expect(interpolate('Session {n}', { n: 3 })).toBe('Session 3')
    expect(interpolate('Session {n}')).toBe('Session {n}')
    expect(interpolate('own UUID via {session}', { name: 'x' })).toBe('own UUID via {session}')
  })

  it('falls back to English for a key this locale does not have', () => {
    expect(translate(dict, fallback, 'area.greeting', { name: 'мир' })).toBe('Привет, мир!')
    expect(translate(dict, fallback, 'area.only')).toBe('English only')
  })

  it('shows the key itself when nothing has it: an unreadable label beats an empty box', () => {
    expect(translate(dict, fallback, 'area.nothing')).toBe('area.nothing')
    expect(translate(dict, fallback, 'nodot')).toBe('nodot')
  })

  it('splits the area at the first dot only, so a key may hold dots of its own', () => {
    const nested: RawDict = { settings: { 'tab.agents': 'Agents' } }
    expect(translate(nested, nested, 'settings.tab.agents')).toBe('Agents')
  })

  it('always has {count} available in a plural string', () => {
    const counted: RawDict = { area: { n: { one: '{count} file', other: '{count} files' } } }
    expect(translatePlural(counted, counted, 'area.n', 'en', 2)).toBe('2 files')
  })
})

describe('detectLocale', () => {
  it('takes the first language we speak, ignoring the region', () => {
    expect(detectLocale(['uk-UA', 'ru-RU'])).toBe('uk')
    expect(detectLocale(['ru'])).toBe('ru')
    expect(detectLocale(['en-GB'])).toBe('en')
    expect(detectLocale(['de-DE', 'ru-RU'])).toBe('ru')
  })

  it('speaks none of them', () => {
    expect(detectLocale(['de', 'fr'])).toBe(null)
    expect(detectLocale([])).toBe(null)
  })

  it('a saved choice wins over the system, and English answers when nothing else can', () => {
    expect(resolveLocale('en', ['ru-RU'])).toBe('en')
    expect(resolveLocale(undefined, ['uk-UA'])).toBe('uk')
    expect(resolveLocale(undefined, ['de-DE'])).toBe('en')
  })
})
