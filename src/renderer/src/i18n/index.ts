import type { JSX, ReactNode } from 'react'
import { createContext, createElement, useContext, useEffect, useMemo } from 'react'
import { LOCALES, defaultLocale } from '../../../shared/types'
import { detectLocale, resolveLocale } from './detect'
import type { PluralArgs, PluralKey, TArgs, TKey } from './keys'
import { en } from './locales/en'
import { ru } from './locales/ru'
import { uk } from './locales/uk'
import type { RawDict } from './translate'
import { translate, translatePlural } from './translate'
import type { Locale, TParams } from './types'

export type { Locale, PluralForms, TParams } from './types'
export type { TKey, PluralKey, Dict } from './keys'
export { LOCALES, defaultLocale, detectLocale, resolveLocale }

const DICTIONARIES: Record<Locale, RawDict> = { en, ru, uk }

/** the languages as they name themselves — a list of languages is not translated */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский', uk: 'Українська' }

/**
 * What a component gets from `useT()`.
 *
 * `t('area.key')` for a plain string, `t.plural('area.key', n)` for one that agrees with a
 * number. Both keys are checked against the English catalogue, so a typo and a key that one
 * locale forgot are compile errors rather than something noticed in the running app.
 */
export interface T {
  <K extends TKey>(key: K, ...args: TArgs<K>): string
  plural<K extends PluralKey>(key: K, count: number, ...args: PluralArgs<K>): string
  /** the locale in force, for the rare formatting that has to know (dates, numbers) */
  locale: Locale
}

/** a `t` bound to one locale; exported for tests, which have no React around them */
export function makeT(locale: Locale): T {
  const dict = DICTIONARIES[locale]
  const fallback = DICTIONARIES[defaultLocale]
  const call = (key: string, params?: TParams): string => translate(dict, fallback, key, params)
  const plural = (key: string, count: number, params?: TParams): string =>
    translatePlural(dict, fallback, key, locale, count, params)
  // the key types are the whole point of this module and they are erased at this boundary:
  // inside, a key is a string. The cast is where the checked world ends
  return Object.assign(call, { plural, locale }) as unknown as T
}

/** what the system says it speaks, most preferred first */
function systemLanguages(): readonly string[] {
  return navigator.languages?.length ? navigator.languages : [navigator.language]
}

const TContext = createContext<T>(makeT(defaultLocale))

/**
 * Puts `t` in context. `locale` is the saved setting — undefined while nothing has been
 * chosen. Switching it re-renders everything below with the new wording, which is why the
 * locale lives in the settings and not in a module variable: no restart, no reload.
 */
export function I18nProvider({ locale, children }: { locale?: Locale | undefined; children: ReactNode }): JSX.Element {
  const resolved = useMemo(() => resolveLocale(locale, systemLanguages()), [locale])
  const t = useMemo(() => makeT(resolved), [resolved])
  // the document says which language it is in: screen readers and hyphenation both read it
  useEffect(() => {
    document.documentElement.lang = resolved
  }, [resolved])
  return createElement(TContext.Provider, { value: t }, children)
}

export function useT(): T {
  return useContext(TContext)
}

/** the locale in force, already resolved: what the settings selector shows as current */
export function useLocale(): Locale {
  return useContext(TContext).locale
}
