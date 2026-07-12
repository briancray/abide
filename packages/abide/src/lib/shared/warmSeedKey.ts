/*
The single source of the async-cell warm-seed key format: the `${scopeId}:${cellIndex}` string that
pairs a cell's serialization-stable render-path scope id with its per-scope declaration ordinal.

Both sides of the SSR→client handoff mint the key through THIS callable — the isomorphic
`createAsyncCell` runs it server-side to key its `resolvedCells`/`streamedCells` entries (which the
page renderer stamps into `__SSR__.cells` / streams as `{ cellKey }` / `{ cellSeed }` chunks), and
client-side to look the value up in `CELL_SEED`. Because the two sides now invoke one function, the
byte-for-byte agreement the warm-seed depends on is a shared definition rather than a template
literal re-typed at each call site: changing the delimiter here changes it for both sides at once,
so the SSR-text-≡-first-client-render mismatch class (ADR-0033) cannot silently reopen from a
one-sided edit. Pure so it stays trivially testable and inlinable.
*/
export function warmSeedKey(scopeId: string, cellIndex: number): string {
    return `${scopeId}:${cellIndex}`
}
