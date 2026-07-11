# ADR-0035: Render-path streamed resolution unifies streaming-cell warm resolve

**Status:** **accepted — phase 1 shipped** (2026-07-10). Branch `feat/streamed-cell-resolution`.
Phase 1 (kill the flash) is implemented + verified (the templating/async peek adopts its
server-streamed value on hydrate with no `loading…` flash and no `assertClaimedText` desync). A
proposed phase 2 (skip the redundant client cold-run) was investigated + adversarially reviewed and
has **no worthwhile target**: a bare-RPC peek is a cache read (already warm on the client), and a
local loader's cold-run is either cheap recompute or an infeasible-to-fix side-effect footgun — see
the phase-2 note. Phase 1 is the endpoint. Completes the async-resolve story begun in
[ADR-0019](0019-async-computeds-and-rpc-auto-reads.md) (async cells + the warm-seed),
[ADR-0024](0024-ssr-auto-streaming-bare-reads.md) (auto-streaming bare reads + `__abideResolve`),
and [ADR-0032](0032-async-value-positions.md) (the streaming tier). A client + wire change; it does
**not** touch the block-id counter, the RESUME/`$resume` contract, or ADR-0034's flight hoisting.

## Context

abide has three async tiers that read as a value/branch during SSR, and today they deliver the
server-computed result to the client **three different ways** — two warm, one not:

| Tier                                            | SSR ships             | Server → client resolved value                                                    | Client on hydrate                                                    |
| ----------------------------------------------- | --------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `{#await X}{:then}` block                       | pending branch        | **RESUME manifest** (block-id keyed), streamed fragment                           | adopts the fragment (no re-run)                                      |
| `{cacheRead()}` peek (ADR-0024)                 | pending (`undefined`) | **`__abideResolve`** (cache-key keyed) → `seedStreamedResolution` warms the store | seed re-runs but hits the **warm cache** (no network)                |
| `{loadProfile(attempt)?.name}` peek (non-cache) | pending (`undefined`) | **nothing**                                                                       | seed **cold re-runs** the promise → `loading…` flash, redundant work |

The first two are warm: the server's result reaches the client and no re-dispatch/flash occurs. The
third is not. A streaming cell is excluded from the render-path warm-seed (`createAsyncCell.ts:109`,
`options.streaming !== true`) for a real reason — it ships **pending** in the shell, so seeding its
**resolved** value _before_ hydrate would render non-empty where SSR rendered empty →
`assertClaimedText` divergence ([ADR-0033](0033-render-path-survives-a-renders-awaits.md)'s
coordinate system). And `__abideResolve`'s `StreamedResolution` is a `CacheSnapshotEntry`
(`shared/types/StreamedResolution.ts`) — **cache-key keyed**, so it can only carry a read that owns a
cache entry. A plain-promise peek has neither: no cache key to stream, and excluded from the
pre-mount seed.

**Observable today** on `examples/kitchen-sink` `templating/async`: the bare-read card
(`{loadProfile(attempt)?.name ?? 'loading…'}`) shows `loading…` for ~400ms **after hydration** — the
client re-runs `loadProfile` even though the server already computed the name — while the `{await}`
and `{#await}` cards on the same page paint the resolved value immediately. Same data, three code
paths, one of them cold.

## Decision

Add a **render-path-keyed streamed-resolution channel** for streaming cells, so a streaming cell's
server-settled value reaches the client and is applied **post-hydration as a reactive update** —
mirroring how the `{#await}` block streams its fragment and the cache peek streams its entry, but
keyed by the cell's render-path id (`${scope.id}:${nextCellIndex()}`) and carrying a plain value.

**Server.** A streaming cell that settles server-side during the render records `{ key: warmKey,
value }` on a new request-scoped **streamed-cells** partition (the streaming analogue of
`resolvedCellsSlot`, which is blocking-only) — the SETTLED VALUE, not the promise. After the shell +
await-block + cache drains, the page renderer reads every already-settled value and emits a chunk on
the **existing `window.__abideResolve` envelope**, widened from `CacheSnapshotEntry` to a
discriminated `{ cellKey, value }` variant (a new `StreamedResolution` arm). It never AWAITS: a
streaming cell may legitimately stay pending through the whole request (`{#if getFoo()}` holds), and
awaiting it would hang the response. A cell still pending at the drain is simply not streamed (the
client cold-runs it); an unserializable value emits nothing.

**Client.** A new render-path arm in `seedStreamedResolution` routes `{ cellKey, value }` to a
`CELL_SEED`-analogous post-hydration sink and **wakes the cell** (the render-path equivalent of the
cache path's `markLifecycle`). The cell adopts the value through its existing `settleValue`/`runId`
machinery: hydrate to **pending** first (congruent with the shell — no divergence), then the streamed
value lands as a settle that supersedes the in-flight cold seed run via the run-id guard. So the
client transitions pending → resolved exactly as a fresh mount would, every composed read site
(`?? fallback`, `style="…{x}"`, `{#if x}`) repaints reactively, and the cold seed run is superseded
before it can flash. Reactivity is untouched: a later signal-dep change still reseeds (SWR revalidate),
identical to a blocking cell's warm-seed today.

The result is one model across all three tiers: **SSR ships the pending shell → the server streams the
settled result out-of-order → the client applies it, never re-dispatching.** The payload/codec differs
by tier and that is inherent:

| Tier                               | streamed payload            | client applies via                |
| ---------------------------------- | --------------------------- | --------------------------------- |
| `{#await}` block                   | resolved **HTML fragment**  | DOM range **swap** (RESUME adopt) |
| cache peek                         | **cache entry** (cache-key) | store seed + lifecycle wake       |
| non-cache streaming cell (**new**) | **value** (render-path key) | cell settle + render-path wake    |

No server-side reactive runtime is needed (the objection to "stream every reactive read site"): the
server ships only the settled _value_; the client's existing reactive graph paints it.

## Consequences (anticipated)

- **The post-hydrate `loading…` flash disappears** for non-cache streaming peeks (the async
  example's bare-read card resolves instantly on hydrate). The client's cold seed run still executes
  (its result re-settles the same value, superseded) — it is what subscribes the cell to its reactive
  deps. That redundant execution can't be eliminated (phase-2 note), but it costs little: a bare-RPC
  peek is a cache read (`createRemoteFunction` → `cache.read`), so the cold-run hits the warm cache —
  no second fetch, no handler re-invocation; only a pure LOCAL loader re-runs, which is cheap SWR
  recompute. A local loader with side-effecting I/O is the one footgun — fix it by routing through
  `cache` or a `watch`/action, not a bare peek.
- **Hydration stays congruent** — the value applies _after_ the pending shell is adopted, as a
  reactive update, so the streaming-cell warm-seed exclusion (`createAsyncCell.ts:109`) that ADR-0033
  documents is respected: we never seed a resolved value _before_ the pending markup is claimed.
- **Wire cost:** one extra streamed chunk per non-cache streaming cell that settled by the drain and
  serializes; nothing otherwise, degrading to today's cold re-run. Because the drain reads
  already-settled values and never awaits, it adds **no** response-close latency — streaming-only
  pages keep their early first-byte and close exactly as before.
- **Coverage limit (phase 1):** only cells that settled by the drain point are streamed. A page whose
  ONLY async work is a streaming peek (a sync render that returns before the flight settles) is not
  covered — the client cold-runs it, unchanged; a page with any blocking `{await}`/barrier (which
  gates render-return past the flights, the common case) is. Awaiting to widen coverage is rejected:
  a legitimately-pending cell would hang the response.

## Implementation plan (against the post-431aee3c baseline)

Commit `431aee3c` replaced the client resolved-frame runtime with an inline swap script for
`{#await}` **fragments**, but the value channel this ADR generalizes is intact:
`window.__abideResolve` (defined in `createUiPageRenderer.ts`, buffered into `__abideResumeCache`,
drained by `startClient.ts:79-97` through `seedStreamedResolution`), the `StreamedResolution` wire
type, and the render-path `__SSR__.cells` warm-seed (`createUiPageRenderer.ts:105-125` →
`CELL_SEED`). Today only **cache-keyed** resolutions ride `__abideResolve`
(`createUiPageRenderer.ts:337-342`, `streamCacheResolutions`); blocking cells ride the pre-mount
`__SSR__.cells`; streaming cells ride nothing.

**Phase 1 — kill the flash (server + wire + client). SHIPPED.**

1. _Wire:_ widen `shared/types/StreamedResolution.ts` with a `{ cellKey: string; value: string }` arm
   (`value` = `encodeRefJson`); discriminate on `cellKey`.
2. _Server record:_ a request-scoped `streamedCellsSlot` (a `{ key, value }[]`, the streaming
   analogue of `resolvedCellsSlot`). `createAsyncCell.settleValue` records the SETTLED VALUE for a
   streaming cell (`options.streaming === true && typeof window === 'undefined' && warmKey`) — a
   VALUE, not the promise, because a streaming cell may legitimately never settle this request
   (`{#if getFoo()}` holds); awaiting one hangs the response (found + fixed during implementation).
3. _Server emit:_ in `createUiPageRenderer`'s stream `start` (beside the `streamCacheResolutions`
   drain), read each ALREADY-SETTLED value and `controller.enqueue(resolveChunk({ cellKey, value }))`
   — NO await, so a still-pending cell can never hang the stream. An unserializable value emits
   nothing. Because the drain runs after `render()`, the await-block loop, and the cache drain, a
   cell whose flight settled by then (the common case — a blocking `{await}` or barrier gates
   render-return past the streaming flights, ADR-0034) IS captured; a pure-streaming-peek page whose
   sync render returns before the flight settles is NOT (the client cold-runs it — no regression, no
   flash-fix). Streaming-only pages keep their synchronous shell flush (ADR-0034); the drain reads
   values already in hand and adds no wait.
4. _Client apply:_ a `STREAMED_CELLS` registry (render-path key → apply-fn, with a buffer for
   values that arrive before the cell registers — mirroring the cache path's markLifecycle). Add a
   `cellKey` arm to `seedStreamedResolution` that routes to it. `createAsyncCell` (client) registers
   its `warmKey` at construction and exposes `applyStreamed(value)` → `acceptValue(decodeRefJson)` +
   clear `inFlight`/`error`, honouring the `written` latch (the in-flight cold run re-settles the
   same value, superseded — no flash). The apply is DEFERRED to a `queueMicrotask` (found + fixed
   during implementation): the streamed chunk parses and buffers BEFORE the client mounts, so a
   synchronous apply at registration sets the cell to the resolved value while the SSR DOM still
   shows pending → an `assertClaimedText` desync. The microtask runs after the whole synchronous
   mount tree, so hydration claims the pending markup first and the value lands as a plain reactive
   update.

**Phase 2 — kill the redundant cold run. INVESTIGATED (2026-07-10, two rounds): NO worthwhile target
exists. Leave phase 1 as the endpoint.**

The plan was: a `__SSR__.streamingCells` key manifest lets an expected cell **skip its cold seed
run** and wait for `applyStreamed`. Two rounds of review closed it:

Round 1 (reactivity): a cell subscribes to its deps **by running the seed** — `createEffectNode(() =>
run(true))` calls `seed()`, and the effect auto-tracks whatever signals `readNode` fires in that
synchronous window (`REACTIVE_CONTEXT.observer` is a bare module-global, restored synchronously). Skip
the run → the cell never subscribes → dep bumps stop revalidating. For an **opaque/local** loader (the
example's `loadProfile` `setTimeout`) reads and side effects interleave with no seam, so you cannot
separate subscription from execution — the double-execution is inherent.

Round 2 (adversarial) argued this was overstated for an "RPC loader" whose client dep set is just its
args — but that argument **conflates the raw fetch path with the bare call, and the bare call is a
cache read.** `createRemoteFunction`'s bare `callable` routes through `cache.read` (createRemoteFunction.ts:145,
ADR-0019 rpc-auto-reads) — only `.raw` fetches directly, and a peek never uses `.raw`. So a bare-RPC
streaming peek is **not** a non-cache read; it is the cache-peek tier (row 2 of the tier table above):
the SSR handler runs once, the entry ships via `__abideResolve`, and the client cold-run does
`getUser() → cache.read → warm hit` — **no second fetch, no handler re-invocation, no double side
effect.** Already handled. The "RPC-only elision" therefore has **nothing to elide** — it is moot, not
merely low-ROI.

That leaves only two real cases, and phase 2 helps neither:

- **Local PURE loader** (`loadProfile` `setTimeout`): the cold-run just recomputes locally — SWR
  revalidate-on-mount working as designed, no I/O, cheap. Nothing worth saving, and (opaque) infeasible
  to skip anyway.
- **Local SIDE-EFFECTING loader** (`function t(){ fetch('/beacon'); return d }`): the cold-run
  double-fires the effect on hydrate — a genuine footgun, but **infeasible** to fix automatically
  (opaque local loader). The correct fix is primitive choice, not framework magic: route the read
  through `cache` (dedups I/O, handler runs once), or move the effect to a `watch`/action. A side
  effect in a bare _reactive_ peek re-fires on **every** reseed regardless, so it never belonged there.

**Recommendation: phase 1 is the endpoint — not because phase 2 is hard, but because there is no
worthwhile + feasible target.** Bare RPC peeks are already cache-warm on the client; local pure loaders
have nothing to save; local side-effecting loaders can't be skipped and shouldn't be bare peeks. The
guidance for read-with-side-effect is "route through `cache`."

## Spike to run

1. **Congruence** — an SSR→client loop (mirroring `uiCacheSnapshot.test.ts`) for a **non-cache**
   streaming peek: assert the shell ships pending, the streamed `{ cellKey, value }` chunk applies
   post-hydrate, `assertClaimedText` holds, and there is **no** pending→resolved flash (the cell reads
   `hasValue` immediately after the chunk, never re-running the seed for first paint).
2. **Reactivity intact** — bump the peek's signal dep after hydrate; assert it reseeds (SWR), so the
   warm value doesn't freeze the cell.
3. **Serialization fallback** — a peek resolving to a non-serializable value emits a `miss`; the
   client cold re-runs, unchanged.
4. **First-byte** — a streaming-only page still flushes its shell synchronously (no `needsAsync`
   regression, per ADR-0034); only the stream close waits on the cell.
5. **No double channel** — a _cache-backed_ peek must not now emit BOTH an `__abideResolve` cache
   entry AND a render-path value (pick the cache key when the read owns one, so the store stays the
   single source; the render-path arm is for reads with no cache identity).

## Alternatives considered

- **Widen the pre-mount `CELL_SEED` warm-seed to streaming cells.** Rejected: it re-introduces exactly
  the divergence ADR-0033 documents — the shell shipped pending, a pre-mount resolved seed makes the
  client claim non-pending markup. Post-hydration application is the whole point.
- **Make non-cache peeks blocking** so their value bakes into the shell. Rejected: that is the
  `{await}` tier by choice; the streaming tier exists to flush the shell without waiting.
- **A server-side reactive runtime streaming DOM mutations per read site.** Rejected (see the
  "stream every reactive read site" analysis): a live per-request graph + a full mutation protocol
  that must byte-match the client, for a marginal win over shipping the value and letting the client
  paint.

## Non-goals

- Unifying **rejection** semantics between `{foo()}` (swallows → `undefined`) and `{#await}` (surfaces
  → 500 without `:catch`). That difference is deliberate — a value peek composes with `?? fallback`, a
  block is an explicit state machine that fails loud on an undeclared error path — and is left as-is.
