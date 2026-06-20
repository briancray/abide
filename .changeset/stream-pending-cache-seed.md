---
"@abide/abide": patch
---

fix(cache): seed the client cache store for streamed `{#await}` reads so they hydrate warm instead of refetching. The SSR snapshot only inlined entries settled by render-return into `__SSR__.cache`; a `<template await>` read shipped its resolved tuple to `window.__abideResume` for no-flash DOM adoption, but its cache key was never seeded. `awaitBlock`'s effect re-reads the promise on the first hydrate pass (to subscribe the key for `cache.invalidate`), so that read cold-missed straight to the network — correct first paint, redundant fetch per streamed block.

The root cause is a timing one: a `{#await cache()}` expression is a thunk the SSR stream runs lazily, so its cache entry is created (and settled) *during* the stream — after the render-return snapshot, which is therefore empty for it. The renderer now snapshots the store again once the stream has drained and emits an inline `__abideResolve(...)` chunk per entry (a warm `CacheSnapshotEntry`, or a `{ key, miss }` marker for an unshippable body → live refetch), keyed-diffed against what already shipped inline. `startClient` seeds both partitions through one sink (`seedStreamedResolution`) before the deferred bundle hydrates, so the subscription read resolves synchronously and adopts the SSR DOM with no wire round-trip.

Also hardens the reserved bundle-side stream path so it can't silently reintroduce the refetch: `startClient` installs a live, store-connected `window.__abideResolve`, and `applyResolved` seeds the store from `<abide-cache>` data frames (a script set via innerHTML never runs, so a bundle-consumed stream — streaming SPA navigation, socket-delivered SSR — carries the cache channel as data) — pairing the cache seed with the DOM swap.

Internal cleanup: `serializeCacheSnapshot` now returns `CacheSnapshotEntry[]` (the settled snapshots) instead of an `{ inline, pending }` partition. The `pending` half encoded the false premise that a `{#await}` read is in-flight at render-return — it is created lazily mid-stream, so `pending` only ever caught the rare eagerly-fired-unawaited read. The unused `CacheSnapshot` type is removed.

Guarded by a real-HTTP-entrypoint integration test (`bootTestServer` → `createServer` → stream) that reads a gated verb through `cache()` inside `{#await}` and asserts the warm `__abideResolve(...)` seed ships over the wire while `__SSR__.cache` stays empty — it reproduces the original cold-miss when the seed pass is reverted.
