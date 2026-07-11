# ADR-0038: Parallelize the SSR layout chain

**Status:** **accepted — shipped** (2026-07-11). A server-only change to `renderChain`; no wire,
hydration, or client-build change. Reuses the primitives of
[ADR-0037](0037-path-keyed-block-ids-enable-parallel-sibling-renders.md) (path-keyed block ids +
`isolateCellBarrier`) and the render-path of [ADR-0033](0033-render-path-survives-a-renders-awaits.md).
The layout-chain analogue of ADR-0037's parallel sibling child renders.

## Context

A route renders as a chain of layout layers wrapped around a page (`renderChain`, outermost layout →
… → page). The layers rendered **sequentially** — a `for`-loop awaiting each `view.render(props,
ctx)` before starting the next — so a route with N layouts each doing an independent I/O read paid
the **sum** of their latencies before the shell could flush, not the **max**. The sequential loop's
own comment justified it two ways: "so the counter advances deterministically and the reactive
scopes never interleave."

ADR-0037 removed the **counter** reason: block ids are now keyed by render-path (`${path}:${n}`), and
each layer roots a *distinct* route key as its path via `withPath` — so two layers' id allocations
live in different namespaces and can't collide even as their async continuations interleave. The
render-path is ALS-backed on the server (`pathStore`, ADR-0033), so each layer's path survives its
own inline awaits.

That left two candidate blockers, both of which resolve:

- **Reactive scope** (`CURRENT_SCOPE` / `ambientScopeBacking`) is a per-*request* mutable field, not
  per-render, so concurrent layers clobber it. But this is **benign** — for exactly the reasons
  ADR-0037's already-shipped parallel *child* renders tolerate the identical clobber: all
  scope-sensitive construction (`$$model`, cells, `state`) runs **synchronously** in each render's
  prefix right after `enterScope`, with no interleaving; the warm-seed key uses `CURRENT_PATH` (ALS,
  correct) not scope identity; SSR strips effects so the reactive-graph owner is irrelevant; and
  layers render with `children: CHILD_PRESENT`, never resolving through each other's scope chain.
- **Async-cell barrier** (`pendingAsyncCellsSlot`, `splice(0)`-drained by each layer's
  `$$settleAsyncCells`) IS a real hazard: two layers registering cells concurrently into the one
  per-request list means one layer's barrier drains the other's cells. This is the same hazard
  ADR-0037 fixed for children — so the fix is the same primitive.

## Decision

Render the layers in parallel with `Promise.all`, each under `isolateCellBarrier` (and its route-key
`withPath`); fold the html and aggregate awaits/state/resume after all settle, unchanged:

```
const collected = await Promise.all(views.map((view, index) => {
  const props = index < views.length - 1 ? { ...paramThunks, children: () => CHILD_PRESENT } : paramThunks
  const key = keys[index]
  const run = () => isolateCellBarrier(() => view.render(props, ctx))
  return key === undefined ? run() : withPath(key, run)
}))
```

- `isolateCellBarrier` gives each layer its own pending-cells list, so barriers don't cross-drain —
  the one genuine blocker, fixed by reusing ADR-0037's per-render isolation. Scope needs no isolation.
- The fold (inner-to-outer outlet fill) and the `flatMap(awaits)` / `Object.assign(state)` /
  `Object.assign(resume)` merges run *after* `Promise.all`, are index-ordered or keyed, and stay
  deterministic. Block ids are path-namespaced, so the streamed-fragment / resume alignment holds.
- **A lone page (no layouts) — the common case — renders directly**, with no `Promise.all` /
  `isolateCellBarrier` wrap. There is nothing to parallelize, and the direct `await` keeps its
  bare-read settle timing byte-identical to the pre-ADR-0038 path (a fast in-process read stays
  pending → streams, rather than slipping settled → inline behind an extra microtask).

## Consequences

- A route with layouts flushes its shell in ~max, not ~sum, of the layers' latencies. Verified: a
  three-layer chain each blocking ~40ms renders in <96ms (a timing test in `uiLayoutChain`), and the
  full hydration suite (congruence fuzz, SSR↔client parity, layout-chain markup, hydrate) stays green.
- Guardrail: layers are parallelized only when route keys are distinct (production always zips
  distinct layout dirs + the page route). The single-page fast path sidesteps the pathless case.
- Establishes the pattern that `isolateCellBarrier` is the reusable per-render isolation seam for any
  concurrent SSR render unit — layout layers here, sibling children in ADR-0037, and the render
  boundary of ADR-0039 next.
