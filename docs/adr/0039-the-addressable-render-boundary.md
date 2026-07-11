# ADR-0039: The addressable render boundary (automatic isolation, parallelism, and streaming)

**Status:** **proposed** (2026-07-11). Isolation and parallelism are **shipped**
([ADR-0037](0037-path-keyed-block-ids-enable-parallel-sibling-renders.md),
[ADR-0038](0038-parallelize-the-ssr-layout-chain.md)); the **streaming** facet's server half is
**spiked + validated** (`renderToStream` `htmlOnly` boundary — `uiComponentStreamSpike.test.ts`),
with the client adopter and the emitting codegen as the remaining implementation. Builds on the
render-path of [ADR-0033](0033-render-path-survives-a-renders-awaits.md), the async-cell barrier of
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
- **Emitting codegen — remaining.** `generateSSR`'s component case (`await $renderSource`) gains a
  streaming variant: emit the child's `<!--abide:await:ID-->…<!--/abide:await:ID-->` boundary and
  push the `htmlOnly` `SsrAwait` onto `$awaits`, instead of awaiting inline.
- **Client adopter — remaining, and the one real cost.** `mountChild` claims a synchronous, id-less
  range and requires the child DOM present; a streamed boundary is pending at boot and wrapped in
  `abide:await` markers. The streamed-child mount site must be re-generated in the **client build** as
  an `awaitBlock`-style async adopter (claim the boundary, mount the child as its resolved branch).
  This is the single place the streaming facet **forfeits the server-only property** ADR-0034/0037
  prized — accepted because the same adopter is the prerequisite for future island hydration.
- **Warm-seed — remaining.** A child rendered during the drain resolves its async cells after the
  head `__SSR__.cells` snapshot, so those cells must stream via the ADR-0035 `streamedCells`
  post-body path or they refetch/flash.

## Consequences

- One mental model — the component boundary — carries isolation, parallelism, and streaming, all
  automatic. Authors write plain components; the framework infers the rest.
- The streaming facet is the first capability that touches the client build; it is gated behind "does
  this child actually block the shell," so a page of fast children pays nothing.
- The spiked `htmlOnly` boundary is inert until the codegen emits it, so it ships now as a safe
  foundation with a regression test.

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
