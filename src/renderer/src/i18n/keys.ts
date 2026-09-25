import type { en } from './locales/en'
import type { AreaOf, PluralForms } from './types'

/** the English catalogue with its exact wording: the source every key type is derived from */
export type EnDict = typeof en

/**
 * The shape every locale must have: the English key set, with the wording widened to `string`.
 * A locale index declares itself with this, so an area that was forgotten wholesale is caught
 * the same way a forgotten key inside an area is.
 */
export type Dict = { [A in keyof EnDict]: AreaOf<EnDict[A]> }

type Area = keyof EnDict & string
type KeyIn<A extends Area> = keyof EnDict[A] & string

/**
 * Every key in the catalogue, as `area.key`. Keys may contain dots of their own
 * (`settings.tab.agents`): only the first dot separates the area, and the rest is the key.
 */
export type AnyKey = { [A in Area]: `${A}.${KeyIn<A>}` }[Area]

type ValueAt<K extends AnyKey> = K extends `${infer A}.${infer R}`
  ? A extends Area
    ? R extends KeyIn<A>
      ? EnDict[A][R]
      : never
    : never
  : never

/** keys that hold a plain string — the only ones `t()` accepts */
export type TKey = { [K in AnyKey]: ValueAt<K> extends string ? K : never }[AnyKey]

/** keys that hold plural forms — the only ones `t.plural()` accepts */
export type PluralKey = { [K in AnyKey]: ValueAt<K> extends PluralForms ? K : never }[AnyKey]

/** the `{placeholders}` of a string, read off the English wording */
type Placeholders<S> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never

type FormPlaceholders<V> = V extends PluralForms ? Placeholders<V[keyof V]> : never

/**
 * The arguments `t()` takes after the key: exactly the values the English string interpolates,
 * or nothing at all when it interpolates none. A string whose wording is not a literal type
 * (one assembled with `+`, say) has no placeholders to read, so params are merely allowed.
 */
export type TArgs<K extends TKey> = [Placeholders<ValueAt<K>>] extends [never]
  ? [params?: Record<string, string | number>]
  : [params: Record<Placeholders<ValueAt<K>>, string | number>]

/** the same, for a plural key: `count` is passed separately and is never asked for here */
export type PluralArgs<K extends PluralKey> = [Exclude<FormPlaceholders<ValueAt<K>>, 'count'>] extends [never]
  ? [params?: Record<string, string | number>]
  : [params: Record<Exclude<FormPlaceholders<ValueAt<K>>, 'count'>, string | number>]
