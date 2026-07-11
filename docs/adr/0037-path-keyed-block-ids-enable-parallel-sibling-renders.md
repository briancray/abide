# ADR-0037: Path-keyed block ids (the prerequisite for parallel sibling child renders)

**Status:** **accepted — both phases shipped** (2026-07-11). Phase 1 (path-keyed block ids) and
Phase 2 (parallel sibling child renders + per-render async-cell barrier isolation) are implemented
and verified: the full UI hydration suite is green and deterministic, a timing test proves three
sibling cards render in ~max not ~sum of their latencies, and the kitchen-sink `rpc/request-scope`
page (3 `CodeBlock` children) hydrates warm with zero refetch and its `highlightCode` SSR runs now
overlap. Delivers the prerequisite [ADR-0034](0034-server-only-flight-holders-parallelize-ssr-awaits.md)
explicitly deferred ("sibling child-render overlap … a follow-on wire-contract change: path-keyed
block ids"). Builds on the render-path identity of
[ADR-0033](0033-render-path-survives-a-renders-awaits.md) and the async-cell barrier of
[ADR-0019](0019-async-computeds-and-rpc-auto-reads.md).

## Context

Sibling child components render **sequentially** during SSR. Each `<Child/>` lowers to an inline
`await $$withPath(ordinal, () => Child.render(props, $ctx))` (`generateSSR.ts`), so child B's render
cannot begin until child A's has fully settled — a page of N independent data-fetching cards pays
the **sum** of their latencies before the shell can flush, not the **max**. `renderChain` renders the
layout chain sequentially for the same reason.

The blocker to parallelizing them was the **block-id counter**. Every `await`/`try` block draws a
unique id — the `<!--abide:await:N-->` boundary markers, the `RESUME[N]` resume-manifest keys, the
streamed `<abide-resolve data-id="N">` fragments. That id came from a single flat counter
(`$ctx.next++` on the server, `RENDER.blockId` on the client), **shared across a component and every
child it inlines**, incremented in depth-first document order. It stays congruent SSR↔client only
because both walk that order — the server sequentially (each child fully awaited before the next),
the client synchronously. Run sibling child renders concurrently and their `$ctx.next++` calls
interleave in promise-settlement order — data-dependent, non-deterministic — scrambling the ids so
the client adopts the wrong resume value into the wrong boundary.

Two facts made the fix tractable:

- The render-path (ADR-0033) already gives every child an **isolated, await-surviving namespace**:
  `$$withPath(ordinal, …)` composes a path (`route/0`, `route/0/row-key`, …), and on the server the
  backing is an `AsyncLocalStorage` (`pathStore`) so a child's path survives its own awaits and
  isolates across concurrent renders. The client backing is a synchronous module var — correct
  because the client mount is synchronous. Both compose byte-identical paths.
- DOM adoption is **positional, not id-validated**: `claimExpected` claims the next boundary comment
  without comparing its id text (the id is error-message text only). So the *only* id-coupled surface
  is the `RESUME` key — change the id format and nothing else needs a parser change.

## Decision — Phase 1 (shipped): key block ids by render-path

A block id is `${CURRENT_PATH.current}:${n}` where `n` is a per-path counter (a `Map<path, number>`)
counted in document order **within** each path. Blocks within one component/branch/row share a path
and number `0,1,2…`; a child component (its own path segment) gets its own independent sequence. The
pathless case — a top-level page whose route key is `''`, or a bare component in a test — keeps the
plain `0,1,2…` form, so the common case is byte-identical to the old flat counter and needs no test
churn.

- `RenderContext` is now a `Map<string, number>` (was `{ next: number }`); the shared
  `blockId(counters)` runtime helper (SSR-generated code calls `$$blockId($ctx)`; the client's
  `nextBlockId()` delegates over `RENDER.blockCounters`) reads `CURRENT_PATH.current` and bumps the
  per-path count. `enterRenderPass` clears the client map at depth 0.
- Wire types widened `number → string`: `SsrAwait.id`, `SsrRender.resume`, `RESUME`,
  `CacheSnapshotEntry` is untouched; the markers, `data-id`, and the swap script (`c.data ===
  'abide:await:' + id`, exact-match) carry the qualified string transparently.
- **Because each render-path is its own namespace, concurrent allocation is safe by construction** —
  the whole point. Two sibling child renders write different path keys; within a path the walk is
  still document-order deterministic on both sides.

Tests install the production SSR path backing (`installAmbientScopeStore`, the ALS `pathStore`) in
the shared preload so a miniDom async render allocates ids under the same await-surviving path as a
booted server — otherwise the sync default backing diverges for an async child, making ids
test-order-dependent. For synchronous execution the ALS `run` behaves like the sync save/restore it
replaces, so congruence is unaffected.

## Decision — Phase 2 (shipped): parallelize the sibling renders

With ids path-namespaced, the renders overlap. The mechanism mirrors ADR-0034: `hoistableChildRenders`
picks each **hoistable** `<Child/>` — on the TOP-LEVEL SPINE (reachable from root through only plain
elements, so no control-flow / await / snippet / slot binder is in scope), childless (no slot
content), no `bind:` prop, and with a prefix-evaluable tag + props (no async-cell name, no
nested-`<script>` local, no snippet name). The component walk emits each hoisted render into the
prefix as `$$flight(() => $$isolateCellBarrier(() => $$withPath(ordinal, () => Child.render(props,
$ctx))))` — computing its `childOrdinal` and lowered props at the SAME site as the body's `await`, so
they can't drift — and `await`s the flight const at the structural position. All sibling flights are
in-flight before any is awaited, so their async work overlaps while the HTML assembles in source
order (the `await` + `$out.push` stay at the child's position). Off-spine children stay sequential.

**Per-render async-cell barrier isolation — why this isn't a pure ADR-0034 extension.** ADR-0034
hoisted *fetch-promises*, which register nothing. A *child render* additionally registers its async
cells (ADR-0019) on `pendingAsyncCellsSlot`, and the SSR barrier `settleAsyncCells` drains that list
with `splice(0)`. The slot is per-**request**, not per-render — so two concurrent child renders would
register cells into one shared list, and whichever barrier drains first would await *both* children's
cells, letting the other child's template read a cell before its own barrier awaited it (a pending
value baked into the shell). So each hoisted render runs under `$$isolateCellBarrier`, which gives it
its OWN pending-cells list: the two barrier consumers (`createAsyncCell` push, `settleAsyncCells`
drain) read through `activePendingCells()`, which returns a per-render list when one is active (a
server-only `renderCellBarrierStore` ALS, swapped in via the `cellBarrierBacking` seam that is an
inert passthrough on the client) else the request list. The path is untouched, and only the *pending*
(barrier) list is isolated — resolved/streamed cell values still aggregate on the request store for
the warm-seed snapshot. Cell-free children (props + cache reads — e.g. `CodeBlock`) were already safe;
the isolation generalizes it to any child.

Phase 1 alone changed no runtime behaviour (ids reformatted, allocation order unchanged); Phase 2 is
transparent too (same HTML, same hydration) — it only makes independent child work overlap. The whole
hydration suite stays green, and a dedicated timing test asserts the ~max-not-~sum overlap.

## Consequences

- The block-id scheme is now concurrency-safe and order-independent — the foundation for Phase 2 and
  for parallelizing the layout chain later.
- Wire ids are path-qualified strings in a routed context (`~1rpc~1request-scope/0:0`); pathless
  renders keep the plain numeric form.
- A latent robustness gain independent of parallelism: block ids inside a keyed `{#each}` now ride
  the row-key path, so a reorder can't drift them the way a flat positional counter could.
