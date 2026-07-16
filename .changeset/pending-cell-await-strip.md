---
"@abide/abide": patch
---

Type a bare no-`await` promise/stream `state.computed` seed as pending (`T | undefined`)

`state.computed(getRates())` (no `await`) routes to a STREAMING cell at runtime — it peeks `undefined` while pending — but the type-check shadow projected it as the resolved `T`, so an unguarded read (`rates.map(...)`) type-checked yet could hit `undefined` at first paint. It now projects through `$$cellValuePending` (`T | undefined`), matching the runtime and the semantically identical `state.computed(async () => getRates())` form. A blocking `state.computed(await getRates())` (suspends until resolved) and a genuinely sync seed are unchanged.

Consuming such a cell with `{#await rates}{:then data}` still binds `data` as the RESOLVED value: the shadow's `{#await}` lowering now strips the pending `undefined` off a bare pending-cell subject (mirroring the runtime's `$$awaitSubject`, ADR-0047), so the idiomatic await/then path stays free of `| undefined` noise. Direct reads should guard with `?.`/`??`.
