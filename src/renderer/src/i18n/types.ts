import type { Locale } from '../../../shared/types'

export type { Locale }

/**
 * A string that agrees with a number. English fills `one` and `other`; Russian and Ukrainian
 * also fill `few` and `many`, because their rule has three forms and disagrees with English.
 *
 * `zero` is not a grammatical form — it is an opt-in wording for n === 0 («без сессий»), used
 * whenever the locale supplies it, in place of whatever the grammatical rule would pick.
 */
export interface PluralForms {
  zero?: string
  one: string
  few?: string
  many?: string
  other: string
}

/** values handed to `t` for interpolation: `{name}` in the string is replaced by params.name */
export type TParams = Record<string, string | number>

/**
 * The shape a translated area must have: the same keys as the English area, a string where
 * English has a string and plural forms where English has forms. The English literals are
 * widened here on purpose — a translation must match the keys, not repeat the wording.
 *
 * Every non-English area file declares itself with this type, so a missing or misspelt key
 * is an error in that file rather than a runtime hole somebody notices in the UI later.
 */
export type AreaOf<A> = { [K in keyof A]: A[K] extends string ? string : PluralForms }
