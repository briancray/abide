/*
The render-path segment alphabet for control-flow branches — the one place the segment a
branch's content composes under is decided, read by BOTH sides (the same pattern
`RANGE_MARKER` uses for the wire markers, so a literal can never drift):

  - the client runtimes (`when` returns THEN/ELSE as its swap key, `switchBlock` its case
    index) hand the key to `mountSwappableRange`, which pushes `String(key)` as the branch's
    path segment;
  - the SSR back-end (`generateSSR`) emits the same segment around a branch's content
    (`withPathBranch`), so a component/cell inside composes a byte-identical
    serialization-stable id — the warm-seed key (ADR-0033).

A `when` keys its branches by name; a `switchBlock` (a `{#switch}`, or an `{#if}` chain with
any `{:elseif}`) keys each case by its index in the `[then, ...branches]` source order —
the default at its own position.
*/
export const THEN_SEGMENT = 'then'
export const ELSE_SEGMENT = 'else'

/* A switchBlock case's segment: its source-order index, stringified exactly as
   `mountSwappableRange` stringifies the numeric swap key. */
export function caseSegment(index: number): string {
    return String(index)
}
