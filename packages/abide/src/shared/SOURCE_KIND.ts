/**
 * 16.117 — the member a source answers its kind by — `table`, `job`, `pipe` or `ledger` — and the
 * tags a change to it refreshes, which `rpc` reads to give it its face. A `memo` is told by its own
 * brand.
 */
export const SOURCE_KIND = Symbol.for('abide.sourceKind')
