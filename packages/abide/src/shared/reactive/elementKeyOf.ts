// A LEAF OF ITS OWN for `isReactive`'s reason — one symbol, not the core it lives beside. The cell is
// read here, in the core's folder, so its layout stays the core's.
import { CELL } from './CELL.ts'
import type { HoldsCell } from './cellShape.ts'
import { isReactive } from './isReactive.ts'

/** The `key` a `Reactive` declared (32.32), or `null` where it declared none or `value` is not one. */
export function elementKeyOf(
    value: unknown,
): string | ((element: unknown) => unknown) | null {
    if (!isReactive(value)) return null
    return (value as unknown as HoldsCell)[CELL].key
}
