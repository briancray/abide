// 32.32 — A `{#for}` WITH NO KEY OVER A `Reactive` NAMED ALONE takes the value's `key`, and falls back
// to `positional` (32.13) on anything else. Resolved ONCE, when the block is built, so a row pays
// one call and no lookup.
//
// THROUGH A LEAF, NOT `Reactive.ts` — `elementKeyOf` says why.
import { elementKeyOf } from '#shared/reactive/elementKeyOf.ts'

/** The row-key function for an unkeyed `{#for}`: the `Reactive`'s `key`, else `positional`. */
export function rowKeyOf(
    subject: unknown,
    positional: (item: unknown, at: number) => unknown,
): (item: unknown, at: number) => unknown {
    const key = elementKeyOf(subject)
    if (key === null) return positional
    // THE ELEMENT ALONE: an app's function declared `(element) => unknown`, and the index a row
    // key is handed would reach a second parameter it never agreed to.
    if (typeof key === 'function') return (item) => key(item)
    return (item) => (item as Record<string, unknown>)[key]
}
