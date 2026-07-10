# ADR-0033: The SSR render-path survives a render's awaits

**Status:** **accepted — D1 shipped** (2026-07-10). A gating perf spike (below) cleared D1 and
its correctness across all three blast-radius cases; D2 was not needed. Records the load-bearing
gap discovered while closing the per-row/branch segment divergence in
[ADR-0019](0019-async-computeds-and-rpc-auto-reads.md)'s warm-seed line (the each/if/switch
segment fix shipped alongside this proposal). Depends on the render-path identity work
(`createScope` id = serialization-stable render-path) and the `AsyncLocalStorage` per-request
backing (`installAmbientScopeStore` / `ambientPathBacking`). Does **not** touch the block-id
counter (`$ctx`), the client mount path, or the wire codecs.

## Context

Render-path identity gives every reactive scope a serialization-stable id composed from its
render path — route + layout + branch/row + component ordinal — read from `CURRENT_PATH.current`
at `createScope` time (`createScope.ts:47`). The async-cell warm-seed keys off it
(`createAsyncCell.ts:68`, `` `${scope.id}:${scope.nextCellIndex()}` ``): if SSR and the client
compose the **same** id for the same node, the client hydrates to SSR's value instead of
refetching. The whole "coordinate system" rests on SSR and client composing byte-identical ids.

**The client composes them correctly** — its mount is synchronous, so `withPath(seg, build)` sets
`CURRENT_PATH`, runs the whole subtree build, and restores, all before control returns. Every
scope created during that build reads the right path.

**SSR does not, past a render's first `await`.** `withPath`/`withPathFrom` are synchronous: they
set `CURRENT_PATH.current`, call `build()`, and restore it in `finally` (`withPathFrom.ts:13-18`).
But an SSR component render's `build()` returns a **pending promise** that is awaited *outside* the
wrapper (`renderChain.ts:65`, `generateSSR.ts:572` — `await $$withPath(ord, () => child.render(...))`).
So the wrapper restores `CURRENT_PATH` to the parent's value the instant `render()` yields, **before
the render's own post-await body runs**. Any scope created after the first `await` in a render
composes against an ancestor's path, not the render's own.

The per-request `AsyncLocalStorage` (`installAmbientScopeStore.ts`) does **not** save this. It
propagates the *store reference* across awaits so concurrent requests don't interleave — but
`currentPath` is a **mutable field** on that store, restored synchronously by the same `finally`.
The ALS buys request-isolation, not await-survival of a pushed segment. A mutable slot restored
synchronously is structurally incapable of following an async continuation.

### Blast radius (why this is not a corner case)

The base is intact only for a render's **synchronous prefix**. It is lost for:

- **The second-and-later sibling child component in any layer.** Rendering child A is
  `await $$withPath(0, () => A.render())` — the parent's first `await`. Its outer `withPath(pageKey)`
  restores to the route root the moment `A.render()` yields, so child B's `$$withPath(1, …)` composes
  `1` where the client composes `pageKey/1`. Every page with two children misses warm-seed on the
  second child's cells.
- **Anything after a page-level barrier.** A page with a page-level async cell (Tier-2 blocking
  barrier) `await`s before it reaches a later `{#each}`/`{#if}`, so the block — and the ADR-0019
  per-row/branch segments just added — composes against the restored (empty) base.
- **A child two or more awaits deep**, transitively.

The each/if/switch **segment** fix (shipped with this proposal) is correct and necessary — it makes
the segment right *relative to* the ambient base — but it cannot help while the base itself is wrong.
Its regression tests deliberately keep the base intact (single-scope-deep, no page barrier), so they
exercise the segment fix cleanly and do **not** cover this.

## Decision (sketch)

Make the active render's path an **async-context value** that continuations inherit, instead of a
mutable slot restored synchronously. Two viable shapes; **D1 is recommended, gated on a perf spike**;
D2 is the fallback if the spike fails.

### D1 (SHIPPED) — back `CURRENT_PATH` with `AsyncLocalStorage.run`, not a mutable field

**Refinement over the original sketch (load-bearing):** `AsyncLocalStorage` is `node:async_hooks`,
and `withPathFrom` ships in the **browser bundle** (client dom helpers `each`/`eachAsync`/
`mountSwappableRange` import it). So D1 does **not** hard-wire an ALS into shared UI runtime — it
keeps the backing **swappable** (mirroring `CURRENT_SCOPE`/`ambientScopeBacking`): the `PathBacking`
type widens from `{ get, set }` to `{ run, get }`, the client default `run` is a synchronous
save/set/restore module-var (correct — the client mount is synchronous, no slot ever crosses an
`await`), and the **server** installs a `run` backed by a dedicated server-only
`AsyncLocalStorage<string>` (`pathStore`). `CURRENT_PATH.current` becomes **read-only** — a segment
is established only through `run`, never by assignment. This is behaviorally identical to the literal
sketch on the server while keeping `node:async_hooks` out of the client bundle.

Replace the path's get/set-a-slot model with a dedicated `AsyncLocalStorage<string>` whose value is
the *composed path*, pushed by `run` at each segment:

```
withPathFrom(base, seg, build) → pathStore.run(compose(base, seg), build)
withPath(seg, build)           → withPathFrom(CURRENT_PATH.current, seg, build)
CURRENT_PATH.current (get)     → pathStore.getStore() ?? ''
```

Because `run`'s value is inherited by every async continuation spawned inside it, a render body
resuming after an `await` still reads its own path, and sibling rows/children — which are
continuations of the enclosing render body — read the enclosing render's path. Nesting composes
correctly (child inside row inside if), and per-request isolation falls out for free (each route
render is its own `run` tree), so the path half of `installAmbientScopeStore` is subsumed. No
compiler change: `generateSSR`'s emitted `$$withPath`/`withPathBranch` calls are unchanged; only the
runtime backing changes.

**The cost — spiked, and cleared.** `run` per push is heavier than a field write, but a render only
pushes without an `await` between siblings in its synchronous prefix; real SSR awaits at every child
render and cell barrier. The gating spike (interleaved A/B, WARMUP=30, ITER=400) measured the pure
per-push mechanism at **~29–31% slower** in isolation (no awaits between pushes — not a real render
shape), but the **render-level** delta on the ADR's exact structure (route → page barrier → N rows,
each with an awaited child + nested `{#if}`) collapsed to **−0.4%…+2.1% median** — inside run-to-run
noise:

| Scenario | baseline median | D1 median | median Δ |
|---|---|---|---|
| async-render N=100 | 0.088–0.138 ms | 0.089–0.206 ms | −0.4%…+1.2% |
| async-render N=1000 | 0.92–1.25 ms | 0.92–1.28 ms | +0.3%…+2.1% |
| sync-push P=3000 (mechanism only) | 0.62–0.96 ms | 0.80–1.24 ms | +29–31% |

Absolute D1 cost on a 1000-row page is ~0.003–0.03 ms (≈2% of a ~1 ms render); on N=100 it's below
timer noise. Kitchen-sink's real render (HTML/RPC/cache work, backing-independent) would show an even
smaller delta, so the synthetic is the conservative upper bound. Overhead is immaterial ⇒ **D1
committed**; D2 not built. Setting the path fails open exactly as today (no store ⇒ `''`), so it can
never break a render. Correctness confirmed: the three regression cases (`uiRenderPathAcrossAwaits`)
**fail on the current backing and pass under D1** (SSR-composed id now equals the client's).

### D2 (fallback) — thread the composed path explicitly through `RenderContext`

If `run`-per-push is too costly, carry the composed path as an explicit value: `RenderContext` gains
the current path; each emitted block push composes from the carried value (`withPathFrom(ctx.path, …)`)
and threads the extended path into its body closure, never reading a live ambient. Await-immune with
no `AsyncLocalStorage` overhead, at the cost of a more invasive `generateSSR` change (every push site
+ `RenderContext` shape). This is the "high-visibility, no magic" option abide's ethos otherwise
prefers; it loses only on codegen surface area. `withPathFrom` already exists for exactly this shape
("a base no longer on the stack").

## Consequences (anticipated)

- **Warm-seed hits for nested and post-await cells** — the coordinate system holds across a render's
  awaits, so async cells in a second sibling child, after a page barrier, or deep in the tree adopt
  SSR's value instead of refetching/flashing. This is the payoff the render-path identity work was
  building toward; without it the identity is correct only for a render's synchronous prefix.
- **The block-id counter is untouched.** `$ctx.next` is threaded explicitly and drawn in
  layer-sequential await order (`renderChain.ts:14-21`); it is a separate mechanism from the path and
  neither D1 nor D2 changes it.
- **The client is untouched** — its synchronous mount already composes the right path.
- **D1 subsumes the path backing.** The `currentPath` field on the request store and its half of
  `installAmbientScopeStore` retire in favor of `pathStore`; the `currentScope` half stays.

## Resolved by the spike (2026-07-10)

- **Does `CURRENT_SCOPE.current` share the bug? → NO. No fix needed.** It uses the same
  mutable-slot-on-request-store model (`installAmbientScopeStore.ts:21-34`) but does *not* lose the
  parent across an await: the compiler brackets a scope as `const prev = enterScope(); try { …await… }
  finally { exitScope(prev) }`, so `exitScope` restores at **render completion** (its own `finally`,
  after the post-await body) — whereas the path's `withPath(seg, () => child.render())` restored the
  instant `render()` returned its *promise* (early). Plus the per-request store isolates the scope
  across the render's own awaits (already covered by `uiScopeConcurrentSsr`), and a scope's parent is
  captured in the synchronous prefix. All six scope-linkage checks (second-sibling, post-barrier,
  grandchild, two-deep) pass on the current backing. Recorded as a non-issue.
- **D1 perf on a large list. → CLEARED.** See the spike table above — render-level Δ is inside noise.
- **Detached-scope fallback. → UNCHANGED.** `createScope` still falls back to a run-unique counter
  when the ambient path is empty (`createScope.ts:18-23`); D1 only changes *how* a segment is
  established (`run` vs slot), and `get()` still returns `''` outside any push, so genuine
  out-of-render `scope()` use is untouched.
