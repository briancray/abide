/**
 * 23.1 — the five values `route` holds, each a `Reactive` of its own.
 *
 * A constants leaf, with no imports of its own. A copy of `route`'s keys, held to them by a test in
 * `lowering.test.ts`.
 */
export const ROUTE_MEMBERS: ReadonlySet<string> = new Set([
    'url',
    'params',
    'name',
    'index',
    'navigating',
])
