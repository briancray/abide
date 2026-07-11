# ADR-0035: Render-path streamed resolution unifies streaming-cell warm resolve

**Status:** **accepted — phase 1 shipped** (2026-07-10). Branch `feat/streamed-cell-resolution`.
Phase 1 (kill the flash) is implemented + verified (the templating/async peek adopts its
server-streamed value on hydrate with no `loading…` flash and no `assertClaimedText` desync). A
proposed phase 2 (skip the redundant client cold-run) was adversarially reviewed: **infeasible for
opaque/local loaders, but a narrow RPC-only variant is feasible** (low-ROI — deferred) — see the
phase-2 note. Completes the async-resolve story begun in
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
  deps. Eliminating that redundant execution is infeasible for an opaque/local loader but feasible
  for an RPC loader (client proxy reads only its args); see the phase-2 note. So the residual cost is
  one duplicate RPC + one side-effect double-fire per streamed RPC-peek at hydrate — dedupe I/O by
  routing the read through `cache`.
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

**Phase 2 — kill the redundant cold run. INVESTIGATED (2026-07-10, adversarial review): infeasible
for OPAQUE/LOCAL loaders; a narrow RPC-only variant is FEASIBLE but low-ROI — build only on evidence.**

The plan was: a `__SSR__.streamingCells` key manifest lets an expected cell **skip its cold seed
run** and wait for `applyStreamed`. Whether that preserves reactivity depends on the loader:

- A cell subscribes to its reactive deps **by running the seed** — `createEffectNode(() => run(true))`
  calls `seed()`, and the effect auto-tracks whatever signals `readNode` fires during that
  synchronous window (`REACTIVE_CONTEXT.observer` is a bare module-global set in `runNode`, restored
  synchronously — no async propagation). So subscription is co-extensive with executing the seed's
  synchronous prefix. Skip it → the cell never subscribes → dep bumps stop revalidating.
- **For an OPAQUE / LOCAL async loader** (the example's `loadProfile` is a local `setTimeout`
  function), the compiler cannot separate dep-subscription from execution: signal reads and side
  effects are interleaved plain JS with no static or dynamic seam. Emitting only the **argument**
  signals for subscription would silently drop signals read _inside_ the loader body — a real
  auto-tracking regression. Here the double-execution IS inherent.
- **For an RPC loader, the objection is vacuous.** A client-side RPC call is a network proxy
  (`createRemoteFunction` → `fetch`) whose body runs on the _server_; the client reads **no app
  signals except its arguments**, which are statically visible at the call site (`$$read("attempt")`).
  So for an RPC the arguments ARE the complete client dep set, and the compiler already knows a lifted
  subexpression is an RPC (it lowered it). The "arguments-only" escape hatch is therefore **sound and
  complete for RPC loaders**. (Note also: post-`await` in-body reads are never tracked today anyway, so
  "complete tracking" is already scoped to the synchronous prefix.)

So **"the double-execution is inherent" is overstated** — it holds for opaque/local loaders, not RPC
ones. A sound **RPC-only cold-run elision** exists: gate strictly to RPC-lifted async subexpressions;
the compiler emits an arg-subscription-only effect + a `__SSR__.streamingCells` expected-key manifest;
the cell short-circuits the loader on the first run (adopting the streamed value via the existing
`registerStreamedCell`/`applyStreamed` path) and does a real `run` on a later arg bump. **New risk:** a
cell expected-but-never-streamed (phase-1's coverage gap — still pending at drain, or unserializable)
must be cold-run when the resolve stream closes without its key, or it hangs pending forever — a
fallback sweep to test hard. Ballpark a few hundred LOC + one new failure mode.

**Recommendation: leave phase 1 as the endpoint by default.** The residual cost is one duplicate RPC

- one side-effect double-fire per streamed RPC-peek at hydrate. Build RPC-only elision only if
  profiling shows the duplicate hydrate RPCs matter. For the side-effect footgun specifically, prefer
  the cheaper existing guard — route the read through `cache` (already dedups I/O, the cache-peek tier).
  A benign-telemetry side effect riding an RPC read is **legitimate and common** (the server firing it
  once during SSR is correct; only the client replay double-fires), so it is a framework footgun, not
  purely user error — but a side-effecting _reactive_ read re-fires on every reseed regardless, so it
  warrants a guard rail rather than fully-automatic invisibility.

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
