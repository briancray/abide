// 33.6, 33.7 — A PROP THE CHILD WRITES, as one cell whichever way the caller passed it: a
// `reactive` over the caller's accessor. Where the caller bound it (32.6) the accessor hands back
// the caller's `Reactive`, which the cell adopts (11.12) and every write reaches (11.60); passed
// as a value, a write stands until the caller's expression changes (11.8). The child never learns
// which, and that is 33.8.
//
// ONLY A WRITTEN PROP PAYS FOR ONE. A prop the child only reads stays the caller's accessor, so a
// row component reading ten props builds no `reactive` at all.

import { reactive } from './reactive/index.ts'
import type { Reactive } from './reactive/Reactive.ts'

// `true` asks a bound accessor for the `Reactive` it binds rather than its value (`boundProp`);
// every other accessor takes no argument and hands back its value either way.
type Accessor = (hold?: true) => unknown

/** A prop the child writes, as a getter for one `reactive` cell over the caller's accessor. */
export function propCell(read: Accessor): () => Reactive<unknown> {
    const cell = reactive(() => read(true))
    return () => cell
}

/**
 * The record the caller passed, with each written key the child's cell rather than the caller's
 * accessor.
 *
 * A key the caller did not pass stays absent, so the pattern's default still applies.
 */
export function propCells(
    record: Record<string, Accessor>,
    written: readonly string[],
): Record<string, Accessor> {
    const cells = { ...record }
    for (const key of written) {
        const read = record[key]
        if (read !== undefined) cells[key] = propCell(read)
    }
    return cells
}
