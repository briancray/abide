// 32.33 — A `{#for}` WITH NO KEY OVER A `Reactive` NAMED ALONE takes the value's `by`, and falls back
// to `positional` (32.13) on anything else. Resolved ONCE, when the block is built, so a row pays
// one call and no lookup.
//
// THROUGH THE LEAVES, NOT `Reactive.ts`. This is on the `abide/runtime` barrel every compiled
// client module resolves through, and `isReactive` records what reaching the core from there
// costs every page.
import { CELL } from '#shared/reactive/CELL.ts'
import { isReactive } from '#shared/reactive/isReactive.ts'

export function rowKeyOf(
    subject: unknown,
    positional: (item: unknown, at: number) => unknown,
): (item: unknown, at: number) => unknown {
    if (!isReactive(subject)) return positional
    const by = (
        subject as unknown as {
            [CELL]: { by: string | ((element: unknown) => unknown) | null }
        }
    )[CELL].by
    if (by === null) return positional
    // THE ELEMENT ALONE: an app's function declared `(element) => unknown`, and the index a row
    // key is handed would reach a second parameter it never agreed to.
    if (typeof by === 'function') return (item) => by(item)
    return (item) => (item as Record<string, unknown>)[by]
}
