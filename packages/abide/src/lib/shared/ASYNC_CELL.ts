/* Brand on an async cell's facet (`AsyncComputed`/`AsyncState`). The probe family
   (`peek`/`pending`/`refreshing`/`refresh`) tests for it to route a cell to its own
   methods, the way `Symbol.asyncIterator` routes a stream. A well-known symbol (not a
   string key) so it never collides with a resolved value's own properties. */
export const ASYNC_CELL: unique symbol = Symbol.for('abide.asyncCell')
