// 32.32 — A `{#for}` WITH NO KEY OVER A `Reactive` NAMED ALONE takes the value's `by`, and falls back
// to `positional` (32.13) on anything else. Resolved ONCE, when the block is built, so a row pays
// one call and no lookup.
//
// THROUGH A LEAF, NOT `Reactive.ts` — `byOf` says why.
import { byOf } from '#shared/reactive/byOf.ts'

/** The row-key function for an unkeyed `{#for}`: the `Reactive`'s `by`, else `positional`. */
export function rowKeyOf(
    subject: unknown,
    positional: (item: unknown, at: number) => unknown,
): (item: unknown, at: number) => unknown {
    const by = byOf(subject)
    if (by === null) return positional
    // THE ELEMENT ALONE: an app's function declared `(element) => unknown`, and the index a row
    // key is handed would reach a second parameter it never agreed to.
    if (typeof by === 'function') return (item) => by(item)
    return (item) => (item as Record<string, unknown>)[by]
}
