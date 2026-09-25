import { LOCALES, defaultLocale } from '../../../shared/types'
import type { Locale } from './types'

/**
 * The first of the offered language tags that we speak, or null when we speak none of them.
 * Only the primary subtag is compared: `ru-RU`, `ru` and `RU-ru` are all Russian to us, and
 * regional variants are not something this app distinguishes.
 */
export function detectLocale(tags: readonly string[]): Locale | null {
  for (const tag of tags) {
    const base = tag.toLowerCase().split('-')[0]
    const match = LOCALES.find((l) => l === base)
    if (match) return match
  }
  return null
}

/**
 * The locale to render in: a saved choice wins, and without one the system language decides.
 * English is the answer when the system speaks none of ours — it is the source of the
 * catalogue, so it is the one locale that is always complete.
 */
export function resolveLocale(saved: Locale | undefined, tags: readonly string[]): Locale {
  return saved ?? detectLocale(tags) ?? defaultLocale
}
