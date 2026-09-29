/**
 * Where a `Reactive` callable keeps the record its state lives on.
 *
 * A symbol rather than a named field so the record stays off the value's app-visible surface, and
 * a leaf because `watch.ts` has to reach through it and cannot import `Reactive.ts`, which
 * imports it.
 */
export const CELL: unique symbol = Symbol('abide.cell')
