import type { Locale, PluralForms } from './types'

export type PluralCategory = 'one' | 'few' | 'many' | 'other'

/**
 * Which form a number takes.
 *
 * English has two: `one` for 1, `other` for everything else. Russian and Ukrainian share one
 * three-form rule — 1 сессия / 2 сессии / 5 сессий — where the last digit decides, except in
 * the teens, which all take `many` (11 сессий, not 11 сессия). Fractions take `other` in
 * every locale: «1,5 сессии» is not the same slot as «1 сессия».
 */
export function pluralCategory(locale: Locale, n: number): PluralCategory {
  if (!Number.isInteger(n)) return 'other'
  const abs = Math.abs(n)
  if (locale === 'en') return abs === 1 ? 'one' : 'other'
  const ten = abs % 10
  const hundred = abs % 100
  if (ten === 1 && hundred !== 11) return 'one'
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'few'
  return 'many'
}

/**
 * The wording for `n`. A locale that spells out zero («без сессий») wins over the grammatical
 * rule; a form the locale did not fill falls back to `other`, which every locale has.
 */
export function selectPlural(forms: PluralForms, locale: Locale, n: number): string {
  if (n === 0 && forms.zero !== undefined) return forms.zero
  return forms[pluralCategory(locale, n)] ?? forms.other
}
