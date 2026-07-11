# ADR-0039: The addressable render boundary (automatic isolation, parallelism, and streaming)

**Status:** **accepted — isolation, parallelism, and streaming shipped** (2026-07-11). Isolation and
parallelism: [ADR-0037](0037-path-keyed-block-ids-enable-parallel-sibling-renders.md),
[ADR-0038](0038-parallelize-the-ssr-layout-chain.md). Streaming: the server emit (per-render
inline-vs-stream by flight settledness — `finalizeStreamedChildren`) and the dual-mode client adopter
(`mountStreamedChild`) are implemented and verified (a slow hoistable child streams and hydrates with
no desync — `uiParallelChildRenders`, `uiStreamedChildAdopt`, `uiComponentStreamSpike`). Warm-seeding
a streamed child's LATE-resolving async **cells** is also done: a `{cellSeed}` streamed-resolution arm
ships the child's post-head cell values into `CELL_SEED` before its deferred mount
(`uiStreamedChildCellSeed`), so it constructs resolved rather than re-running. Builds on the render-path
of [ADR-0033](0033-render-path-survives-a-renders-awaits.md), the async-cell barrier of
[ADR-0019](0019-async-computeds-and-rpc-auto-reads.md), and the streamed-cell path of
[ADR-0035](0035-render-path-streamed-resolution-for-streaming-cells.md).

## Context

Two of the follow-ons ADR-0037 opened were scoped separately: *out-of-order component streaming* (flush
a parent shell, stream a slow child's fragment when it settles) and a *render-scoped isolation
primitive* (a subtree rendering under its own ambient context). Researched independently, streaming
looked marginal ("a streaming `{#await}` inside the child already delivers server TTFB, for a large
client surface").

They are not two features. They are two facets of one thing: **a component is already an addressable,
self-contained render unit**, and the framework can give that unit new capabilities *automatically*.
The render-path (ADR-0037) is its stable address; `isolateCellBarrier` (ADR-0037) is its isolation;
`$$flight` + `renderToStream` is its streaming. Unifying them dissolves the marginal-value objection:
the client machinery streaming needs is the same machinery future island hydration needs, and the
isolation is already shipped and reused by parallel layouts — one primitive, several payoffs.

The unit is the **component** (`.abide` file), not a new authored construct. A component already
compiles to its own `render(props, ctx)` returning `{ html, awaits, resume }`, with **no dependence
on the enclosing render's body-locals** — which is precisely why hoisting an *inline* fragment (a
slot builder) hits a TDZ on `$text`/`$snip` (the deferred ADR-0038-hoist spike), while a component
does not. The component boundary is therefore the natural seam that makes isolation, streaming, and
(later) selective hydration all fall out cleanly instead of four ad-hoc hacks fighting inline codegen.

## Decision

Treat the component boundary as a render unit with three **automatic** capabilities — inferred from
the shape of the code, never authored (matching how ADR-0024 auto-streams a bare read and ADR-0037
auto-hoists a sibling):

1. **Isolation (shipped).** Each concurrent render unit runs under its own async-cell barrier
   (`isolateCellBarrier`), so siblings/layers don't cross-drain. — ADR-0037 / ADR-0038.
2. **Parallelism (shipped).** Independent hoistable children and layout layers render concurrently. —
   ADR-0037 / ADR-0038.
3. **Streaming (this ADR).** A hoisted child whose render does not settle by shell-flush time streams
   its fragment out-of-order instead of blocking the shell: flush a pending placeholder, stream the
   child's html when its flight settles. Automatic — the compiler emits the streaming boundary and
   the runtime decides *per render* whether it actually streams (a fast child still inlines), exactly
   as the cache seed already inlines a settled read and streams a pending one.

There is **no authored `{#boundary}` construct and no fallback prop**: the boundary is the component
you already wrote; its SSR HTML (or its own peek-`undefined`-while-pending render, ADR-0024) is the
placeholder. Client-facing *deferred/lazy* hydration (`client:visible` islands) is deliberately a
**non-goal** here — it changes runtime behaviour (inert-until-visible) and so must be author intent,
not inference; it is left for a later ADR if an opt-in surface is ever wanted.

### What the streaming facet needs (spike results)

- **Server half — validated.** A streamed child is an `SsrAwait` with `htmlOnly: true`: its `then`
  returns the child's rendered html and merges the child's own `awaits`/`resume` for nested
  composition; `settle` emits an html-only `<abide-resolve>` fragment with **no** resume seed (the
  child re-mounts client-side, it doesn't adopt a `RESUME[id]` value). The spike proves the shell
  flushes first, the fragment streams keyed by the child's path, and a nested `{#await}` inside the
  child composes through the same drain. This required only the additive `htmlOnly` flag on
  `SsrAwait` + a two-line `renderToStream` branch — the drain machinery is otherwise reused.
- **Emitting codegen — DONE, and per-render.** `generateSSR`'s hoistable-child case no longer awaits
  inline: it starts the isolated `$$flight` and RESERVES the child's output slot; after the walk,
  `finalizeStreamedChildren` fills it — inline `<!--[-->html<!--]-->` if the flight already settled
  (byte-identical to the old path, so an all-fast page is unchanged), or the empty
  `<!--abide:await:CHILDPATH-->…<!--/abide:await:CHILDPATH-->` boundary + `htmlOnly` `SsrAwait` if
  still pending. CHILDPATH is the child's render-path (`renderPath(ordinal)`), matching the client. A
  single microtask drain settles sync children; one shared macrotask is paid only if some child is
  genuinely pending.
- **Client adopter — DONE, the one place streaming touches the client build.** `generateBuild` emits
  `$$mountStreamedChild` for the SAME hoistable set. It is DUAL-MODE: it probes the hydration cursor —
  a `[` (RANGE_OPEN) means the server inlined a fast child (adopt exactly as `mountChild`); an
  `abide:await:CHILDPATH` comment means it streamed (claim the boundary, adopt the swapped-in inner
  range, claim the close). No hydration → a plain create-mode mount. This is the single place the
  streaming facet touches the client build — accepted because the same adopter is the prerequisite for
  future island hydration.
- **Warm-seed of a streamed child's async CELLS — DONE.** A blocking `{#await}` inside a streamed
  child adopts via its RESUME delta; an async CELL resolves after the head `__SSR__.cells` snapshot, so
  `createUiPageRenderer` ships the post-head delta from `store.resolvedCells` as `{cellSeed}` chunks
  after the drain, and `seedStreamedResolution` seeds them into `CELL_SEED` — the same pre-mount warm
  partition `__SSR__.cells` fills — so the deferred child's cell constructs resolved, no re-run.

## Consequences

- One mental model — the component boundary — carries isolation, parallelism, and streaming, all
  automatic. Authors write plain components; the framework infers the rest.
- The streaming facet is the first capability that touches the client build; it is gated behind "does
  this child actually block the shell," so a page of fast children pays nothing.
- The spiked `htmlOnly` boundary is inert until the codegen emits it, so it ships now as a safe
  foundation with a regression test.

### On the downstream "unlocks" — optionality, not a roadmap

This ADR's value is what shipped: parallel sibling/layout renders + out-of-order streaming, which
flush the shell measurably earlier. The boundary also *affords* three further capabilities, but none
has demonstrated product demand and none should be built speculatively. Recording them honestly so we
don't over-promise:

- **Islands / deferred hydration** — the client adopter (`mountStreamedChild`), the `renderPath`
  address, and the `CELL_SEED` warm channel are the prerequisites, so the remaining work is only an
  author opt-in directive (`client:visible`) guarding the existing mount. But the payoff is real
  *only* when hydration cost is genuinely large (many interactive components, heavy client graph,
  much below the fold). The strongest in-repo case is the kitchen-sink docs page (dozens of
  interactive code samples, most off-screen). For a light-client-graph app it buys little. First to
  revisit if a real case appears; cheap to pick up because the machinery exists.
- **Server-pushed / targeted subtree re-render** — the `abide:await:PATH` boundary is a general
  transport for "a subtree's html, later, by address." But this overlaps heavily with `socket` +
  client `state`/`cache`, which already do live regions client-side. The only delta is letting the
  *server* own the re-render (for server-held secrets / heavy data). Redundant absent that specific
  need.
- **Unit-level error boundaries** — *already shipped*, not an unlock: `{#await}…{:catch}` and
  `{#try}…{:catch}` cover async and sync failures today, streaming or not. The only residual is a
  streamed child whose own top-level flight rejects with no internal boundary (it 500s, matching the
  inline "no catch → surface" behavior), and an author catches that by wrapping the child body in
  `{#try}`. No new work warranted.

Net: file these as "possible if a concrete use case shows up." The shipped streaming + parallelism
stands on its own; the follow-ons are affordances, not committed direction.

## Rejected alternatives

- **An authored `{#boundary}` / `<Suspense>` construct.** The component already *is* the boundary and
  is already path-addressed; a parallel construct would compete with it and add ceremony for what the
  compiler can infer.
- **A manual streaming fallback prop.** The SSR HTML / peek-pending render already serves as the
  placeholder.
- **Streaming every child.** Boundary overhead everywhere for no gain; stream only a child that would
  otherwise block the shell (runtime-decided, like the inline-vs-streamed cache seed).
- **Author-opt-in lazy hydration in this ADR.** Out of scope by design — it is the one non-automatic
  piece; deferred to a future ADR.
