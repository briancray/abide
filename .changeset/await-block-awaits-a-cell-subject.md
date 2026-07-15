---
"@abide/abide": patch
---

`{#await <cell>}` now awaits an async cell's resolution instead of peeking its `undefined`-while-pending value (ADR-0047).

`{#await rates}` where `const rates = state.computed(getRates(...))` used to lower its subject to `$$readCell(rates)` — a peek — so a pending cell read `undefined`, fired `{:then}` immediately, and `{:then data}` crashed dereferencing `data.foo` on `undefined`. (`{#if}`/`{#switch}` cell subjects already avoided this with a `cellPending` guard; `{#await}` never got the equivalent, so it regressed the day a `computed`/`linked` of an async source became a peek-cell.) A bare cell subject is now passed raw and normalised by `$$awaitSubject`, which resolves an async cell to a promise-of-its-value (showing the pending branch until it settles, then `{:then}`, or `{:catch}` on error — SWR on a refresh) and unwraps a lazy `computed(promise)` to its held promise. `{#await getFoo()}` (a plain promise) is byte-identical, on the client, on hydrate, and in the SSR stream.
