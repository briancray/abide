---
"@abide/abide": minor
---

Async values — `state` holds, `computed`/`linked` track, and a reactive `{#try}` (ADR-0019)

`state` is now a pure value-taker; `computed`/`linked` track an async source. A `computed(await …)` / `linked(await …)` seed unwraps its promise into an async cell, and a seed producing a stream (`NamedAsyncIterable`) auto-tracks its frames. Async cells wear the probe family (`peek`/`pending`/`refreshing`/`error`/`refresh`, standalone + instance) and have no `.value` — sync → `.value`, async → probes. `AsyncState` adds `set()`, latching a local write until the next reseed.

`computed(EXPR)` / `linked(EXPR)` now accept a bare expression (wrapped into a thunk unless it is already a `() => …`); a top-level `await` lowers to an eager `async () => …` so independent cells load in parallel, not in a waterfall.

`{#try}` is a fully reactive error boundary — it catches a throw from a *later* re-run (where async errors live), not just the initial render, and heals back to the guarded content when the failing cell recovers (`refresh()` or a dependency change), no manual retry.

Also renames the internal `Subscribable<T>` type to `NamedAsyncIterable<T>` (shape unchanged).
