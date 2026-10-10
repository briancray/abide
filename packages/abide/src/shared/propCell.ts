// 33.6, 33.7 — A PROP THE CHILD WRITES, as one cell whichever way the caller passed it: a
// `reactive` over the caller's accessor. Where the caller bound it (32.6) the accessor hands back
// the caller's `Reactive`, which the cell adopts (11.12) and every write reaches (11.59); passed
// as a value, a write stands until the caller's expression changes (11.8). The child never learns
// which, and that is 33.8.
//
// ONLY A WRITTEN PROP PAYS FOR ONE. A prop the child only reads stays the caller's accessor, so a
// row component reading ten props builds no `reactive` at all.

import { CHILDREN } from './CHILDREN.ts'
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
 * 33.20 — a defaulted prop's accessor: the caller's, answering the default wherever it reads
 * `undefined`, and the default alone where the caller passed nothing. A bound accessor asked to
 * `hold` hands back the caller's `Reactive`, never `undefined`, so a bind still reaches the caller.
 */
export function propOr(
    read: Accessor | undefined,
    fallback: Accessor,
): Accessor {
    if (read === undefined) return fallback
    return (hold) => {
        const value = read(hold)
        return value === undefined ? fallback(hold) : value
    }
}

/** The record without `keys`, so the pattern's default always stands for them (33.20). */
export function withoutKeys(
    record: Record<string, Accessor>,
    keys: readonly string[],
): Record<string, Accessor> {
    // A copy that skips the keys rather than one that deletes them — `delete` leaves a slow shape.
    const rest: Record<string, Accessor> = {}
    for (const key in record)
        if (!keys.includes(key)) rest[key] = record[key] as Accessor
    return rest
}

// One view per rest record: a component hands its rest on at every read of a prop spread from it.
const REST_VALUES = new WeakMap<
    Record<string, Accessor>,
    Record<string, unknown>
>()

/**
 * 33.22 — a `props` rest element handed on whole: each key a getter calling its accessor, so
 * whatever enumerates it — a `{...rest}`, a function it is passed to — reads values, live.
 *
 * 33.25 — `children` LEFT OUT. Every caller's record carries it (33.16), and spread onto an element
 * it rendered the caller's content a second time, as an attribute, outside the slot it is for.
 */
export function restValues(
    record: Record<string, Accessor>,
): Record<string, unknown> {
    let values = REST_VALUES.get(record)
    if (values === undefined) {
        values = {}
        for (const key in record) {
            if (key === CHILDREN) continue
            Object.defineProperty(values, key, {
                enumerable: true,
                get: () => (record[key] as Accessor)(),
            })
        }
        REST_VALUES.set(record, values)
    }
    return values
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
