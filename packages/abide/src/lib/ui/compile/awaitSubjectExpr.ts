/*
The lowered `{#await X}` subject, normalised so a cell subject AWAITS its resolution
(ADR-0047): a BARE async-cell reference is passed RAW (not peeked to `$$readCell(cell)`)
and wrapped in `$$awaitSubject(...)`, which resolves a cell to a promise-of-its-value —
so `{#await rates}` (a cell) shows pending then the value; any other subject lowers
unchanged, so `{#await getFoo()}` (a plain promise) is byte-identical. ONE decision site
shared by both back-ends (the client `awaitBlock` emit and SSR's blocking / streaming /
flight-hoist emits), so the bare-cell classification can't drift between them.
*/
export function awaitSubjectExpr(
    promiseCode: string,
    cellReadNames: ReadonlySet<string>,
    lowerExpression: (code: string) => string,
): string {
    const bare = promiseCode.trim()
    return cellReadNames.has(bare) ? `$$awaitSubject(${bare})` : lowerExpression(promiseCode)
}
