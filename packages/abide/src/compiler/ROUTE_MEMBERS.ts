/**
 * 23.1 — the five values `route` holds, each a `Reactive` of its own — `route.query` is a function
 * beside them, called rather than read (30.41).
 *
 * A constants leaf, with no imports of its own. A copy of the keys of `route` that hold a value, held
 * to them by a test in `lowering.test.ts`.
 */
export const ROUTE_MEMBERS: ReadonlySet<string> = new Set([
    'url',
    'params',
    'name',
    'index',
    'navigating',
])
