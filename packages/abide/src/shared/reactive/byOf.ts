// A LEAF OF ITS OWN for `isReactive`'s reason: `rowKeyOf` is on the `@abide/abide/runtime` barrel every
// compiled client module resolves through, and reaching `Reactive.ts` from there puts the core in
// the chunk every page loads. The cell is read here, in the core's folder, so its layout stays the
// core's.
import { CELL } from './CELL.ts'
import { isReactive } from './isReactive.ts'

/** The `by` a `Reactive` declared (32.32), or `null` where it declared none or `value` is not one. */
export function byOf(
    value: unknown,
): string | ((element: unknown) => unknown) | null {
    if (!isReactive(value)) return null
    return (
        value as unknown as {
            [CELL]: { by: string | ((element: unknown) => unknown) | null }
        }
    )[CELL].by
}
