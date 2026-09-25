import { selectPlural } from './plural'
import type { Locale, PluralForms, TParams } from './types'

/**
 * The catalogue as the runtime sees it. The key types live in keys.ts and are erased here on
 * purpose: lookup is two property reads, and the type system has already done the checking.
 */
export type RawDict = Record<string, Record<string, string | PluralForms>>

/** `{name}` is replaced by params.name; a placeholder nobody passed is left visible, not blanked */
export function interpolate(text: string, params?: TParams): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}

/** what a key points at in one dictionary, or null when that dictionary has no such key */
export function entryOf(dict: RawDict, key: string): string | PluralForms | null {
  // only the first dot separates the area: `settings.tab.agents` is `tab.agents` in `settings`
  const dot = key.indexOf('.')
  if (dot < 0) return null
  return dict[key.slice(0, dot)]?.[key.slice(dot + 1)] ?? null
}

/**
 * The wording for a key, in this locale, with English behind it. Types make a missing key
 * impossible to write, but a dictionary can still arrive from a build that had one more key
 * than this one; then English answers, and if English cannot, the key itself is shown — an
 * untranslated label is a bug that can be read, an empty box is one that cannot.
 */
export function translate(dict: RawDict, fallback: RawDict, key: string, params?: TParams): string {
  const entry = entryOf(dict, key) ?? entryOf(fallback, key)
  if (entry === null) return key
  return interpolate(typeof entry === 'string' ? entry : entry.other, params)
}

/** the same for a key that agrees with a number; `count` is always available as `{count}` */
export function translatePlural(
  dict: RawDict,
  fallback: RawDict,
  key: string,
  locale: Locale,
  count: number,
  params?: TParams,
): string {
  const entry = entryOf(dict, key) ?? entryOf(fallback, key)
  if (entry === null) return key
  const text = typeof entry === 'string' ? entry : selectPlural(entry, locale, count)
  return interpolate(text, { ...params, count })
}
