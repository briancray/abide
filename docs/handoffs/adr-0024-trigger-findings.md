# ADR-0024 trigger-seam findings

Discovery note required by the implementation contract. Written before the D1/D2 edits;
records why the trigger seam is real and where it lives. STATUS: trigger seam CONFIRMED —
implementation proceeded.

## The question

A bare read is `peek`-only / non-triggering today (`cache.ts:903` "synchronous,
non-triggering value probe"; `peek` → `cache.peek`). Can the server be made to *trigger* a
bare read so its cache entry becomes **pending** in `store.cache.entries` and thus streamable
by the existing drain, without re-implementing another ADR?

## What actually lowers where (corrects the naive hypothesis)

There are **two distinct** "bare read" lowerings, not one:

1. **Direct promise interpolation** `{getUser({id})}` (expression type `Promise<T>`).
   `lowerAsyncInterpolations.ts:100` (ADR-0023, type-directed) rewrites it into a **synthetic
   streaming `{#await}` node** (`streamingAwaitNode`, `:128`) — the same shape the authored
   `{#await p}{:then v}{v}{/await}` parses to. It flows through `generateStreamingAwait`
   (`generateSSR.ts:699`) and pushes `$awaits`. **This form already streams (Tier-3)** and is
   NOT the ADR-0024 target — the "bare reads stream by default, no `{#await}`" ergonomic is
   already delivered for it.

2. **Async-cell reference** `{user}` where `const user = computed(await getUser({id}))`.
   Lowers to `$$readCell(user)` (`readCell.ts`), a throwing peek. The cell (`createAsyncCell`)
   is **eager**: its `createEffectNode` (`createAsyncCell.ts:175`) runs the seed at
   construction, which **calls the rpc → `cache.read` → `registerEntry` → `store.entries.set`**
   (`cache.ts:511`). Server-side it also registers the in-flight promise on
   `pendingAsyncCellsSlot` (`createAsyncCell.ts:159-161`), which the Tier-2 barrier
   `settleAsyncCells` awaits (`compileSSR.ts:72` emits `await $$settleAsyncCells()` when
   `cellReadNames.size > 0`). So by render-return that entry is **settled**, gets baked inline
   via `serializeCacheSnapshot` (`createUiPageRenderer.ts:199`), i.e. **Tier-2 blocking** — as
   ADR-0019 and `ssrAsyncCell.test.ts` require. This must NOT regress.

## The trigger seam

The trigger is **not a new call to add to `readCell`/`peek`** — `readCell.ts` is isomorphic
with no `typeof window` branch, and `peek` is non-triggering by contract. The trigger is the
**smart rpc callable fired during render**: any `cache(fn)` / `cache.read(fn)` / smart
callable evaluated in the render pass calls `registerEntry` and lands a replayable entry in
`store.cache.entries` (`activeCacheStore()` → the request-scoped `store.cache`, the exact map
the drain reads at `createUiPageRenderer.ts:266`). Confirmed end-to-end: the entry appears in
`Array.from(store.cache.entries.values())` and `streamCacheResolutions` drains it.

The ONLY thing standing between a triggered read and streaming it is:

- **The gate** (`createUiPageRenderer.ts:205`) hard-returns buffered when `ssr.awaits.length
  === 0`, so a page whose only async work is a pending triggered read (no `{#await}`) never
  reaches the drain. → **D2**: also take the streaming branch when a pending replayable entry
  exists at render-return.
- **The drain filter** used `snapshotShippable` (which demands `settled`), so a still-pending
  bare-read entry would be skipped. → broadened to `hasReplayableRequest` (the request half of
  shippability; `snapshotEntryFromCache` awaits the body itself and is documented to accept
  still-pending entries — `snapshotShippable.ts`, `snapshotEntryFromCache.ts:34`).
- **The unbounded wait**: `streamCacheResolutions` awaited each entry forever. → **D1
  deadline**: a per-render `deadlineMs` races the drain; on elapse every still-inflight key
  ships `{ key, miss }` (the existing unshippable path → client refetch) and the stream
  closes. Fail-closed to today's Tier-1 client-fetch, never a hang.
- **The client wake**: `seedStreamedResolution` did a bare `entries.set` with no lifecycle
  dispatch (valid for the await path, whose subscription reads the resume manifest, not the
  cache). A bare read's throwing-peek subscribed the key's lifecycle channel and needs the
  wake. → **D3**: fire `store.markLifecycle(resolution.key)` after the set.

## Why this does not re-implement ADR-0019/0023

The Tier-2 barrier (`settleAsyncCells` / `pendingAsyncCellsSlot`) and the cell/interpolation
classification are **untouched**. `computed(await …)` still registers to the barrier and bakes
inline (Tier-2). `{#await}` streaming (Tier-3) is unchanged. The only edits are the renderer
gate + deadline + drain-filter and the one `markLifecycle` in `seedStreamedResolution` — the
exact two files the implementation brief scopes. The renderer now streams **any** replayable
entry left pending at render-return by a triggered read, instead of only `{#await}` entries.

## Deadline design

A single per-render deadline (`SSR_STREAM_DEADLINE_MS`, default 10s), injectable through
`createUiPageRenderer`'s config so a test forces the miss path without a real-time wait. The
shell flushes before the drain, so the deadline bounds time-to-complete, never TTFB. Settled
`{#await}` entries resolve well inside it, so Tier-3 is never delayed. `undefined` disables it
(pre-ADR-0024 behavior) — but the renderer always passes the configured value.
