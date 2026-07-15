# ADR-0047 — `{#await <cell>}` awaits the cell, not its peek

**Status:** accepted (2026-07-15); implemented 2026-07-15. Closes a regression opened by [ADR-0019](0019-async-computeds-and-rpc-auto-reads.md) D1 (a `computed`/`linked` of an async source became a peek-cell) that [ADR-0032](0032-async-value-positions.md) generalised: `{#if}`/`{#switch}` cell subjects were given a `cellPending` guard, but `{#await}` never got the equivalent. Composes with the ADR-0046 read model (a cell carries its own blocking bit) and the existing `awaitBlock` / `renderToStream` machinery.

## Context

`{#await X}` was built for a **promise** subject: the compiler lowers the subject through the generic expression lowering and awaits the result (`awaitBlock` on the client, the `$awaits` drain in `renderToStream` on the server). For a *cell* subject — `{#await rates}` where `const rates = state.computed(getRates(...))` — that lowering emits `$$readCell(rates)`, a **peek**. Once `computed`/`linked` of an async source became a peek-cell (ADR-0019 D1: `undefined` while pending), the peek of a pending cell is `undefined`, `isThenable(undefined)` is false, and the block treats it as *"resolved to `undefined`"* — firing `{:then}` immediately, so `{:then data}` dereferences `data.foo` on `undefined` and crashes (the observed `~/code/media`/kitchen-sink probes crash on an online SSR render).

`{#if}`/`{#switch}` avoid exactly this by pairing the peek with a `cellPending` guard so a pending cell subject renders no branch (`cellPending.ts`). `{#await}` had no such guard, so `{#await <cell>}` silently broke while `{#await <promise>}` kept working — the two diverged the day cells became peeks, and nothing tested the cell subject.

## Decision

`{#await X}` means "wait for X", so when its subject is a cell the block AWAITS the cell's resolution instead of peeking it. Realised with one runtime helper and a subject-lowering tweak in both back-ends — no change to `awaitBlock` or `renderToStream`, which already await a thenable subject and route a rejection to `{:catch}`.

### D1 — a cell subject is passed RAW, normalised by `awaitSubject`

The compiler special-cases a **bare cell-reference** subject (`node.promise.trim() ∈ cellReadNames`): instead of lowering it to `$$readCell(cell)` (a peek), it passes the cell RAW to `$$awaitSubject(cell)`. A non-cell subject (`{#await getFoo()}`, `{#await somePromise}`) is lowered as before and NOT wrapped, so it is byte-identical. Applied at all four emit sites: the client `awaitBlock` call, and the SSR blocking-inline / streaming-`$awaits` / ADR-0034 flight-hoist sites.

### D2 — `awaitSubject` resolves either cell shape to an awaitable

`awaitSubject(x)` (`ui/dom/awaitSubject`) returns something `awaitBlock`/`renderToStream` can await:

- **an async cell** (`AsyncComputed`/`AsyncState`): **pending** (in flight, no value) → a promise that resolves to the cell's value once it settles (its `pending()` read subscribes the reading block, so a reseed/`cache.invalidate` re-runs it, and the SSR drain awaits the promise); **settled** → the retained value now (SWR — a held value being refreshed shows immediately, no pending flash); an error with no retained value → a **rejected** promise (never a synchronous throw), so it routes to `{:catch}`/`{#try}` rather than escaping the block.
- **a lazy `Computed`/`State`/derive** holding a bare promise (`computed(getFoo())` with no `await` stays an opaque promise-holder, not an async cell) → read through `readCell` to its `.value` — the promise itself — which the block then awaits. This preserves the pre-ADR-0019 `{#await computedPromise}` behaviour.

## Consequences

- `{#await <cell>}` now shows its pending branch until the cell settles, then `{:then}` with the value (or `{:catch}` on error) — on cold client nav, hydrate, and SSR stream alike. The probes `{#await rates}` renders the rate instead of crashing on an online render.
- **No API or authoring change.** `{#await getFoo()}` (promise) is untouched; the new `ui/dom/awaitSubject` is compiler plumbing.
- The `cellPending` guard on `{#if}`/`{#switch}` and the new `awaitSubject` on `{#await}` now both close the "a cell subject is a peek" gap — the three control-flow blocks handle a cell subject consistently.

## Alternatives considered

- **Give `{#await}` a `cellPending` guard like `{#if}`** (render pending while `cellPending(cell)`, `{:then}` off the peek). Rejected — `{#await}` also awaits plain promises and drives an out-of-order SSR stream; a peek+guard would need a second value-vs-guard code path in `awaitBlock` and `renderToStream`, whereas normalising the subject to an awaitable reuses the existing promise path untouched.
- **Make the subject read suspend (throw `SuspenseSignal`) for any cell.** Works on the client (`awaitBlock` catches it) but not on SSR, where `renderToStream` awaits `block.promise()` — a synchronous throw there escapes the drain. A returned promise composes on both sides with no per-side split.
