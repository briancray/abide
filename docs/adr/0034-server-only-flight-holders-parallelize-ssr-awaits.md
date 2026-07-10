# ADR-0034: Server-only eager flight-holders parallelize independent SSR awaits

**Status:** **proposed** (2026-07-10). Branch `perf/parallel-ssr-awaits`. Depends on nothing new
in the wire/hydration contract — it is a **server-side codegen** change only, so the client build
(`generateBuild`), the RESUME/`$resume`/`$awaits` streaming contract, the `CELL_SEED` warm-seed, and
the block-id counter (`$ctx`) are all untouched. Sits alongside the async-cell barrier
([ADR-0019](0019-async-computeds-and-rpc-auto-reads.md)), the async value positions
([ADR-0032](0032-async-value-positions.md)), and the render-path identity work
([ADR-0033](0033-render-path-survives-a-renders-awaits.md)).

## Context

An SSR page with two independent async data reads renders in **sum**, not **max**, of their
latencies. Measured on `examples/kitchen-sink` `templating/async`: a blocking value-form
`{await loadProfile(attempt).then((p) => p.name)}` plus a streaming `{#await loadNames(attempt)}{:then}`
(two 400ms fake-latency loaders) renders in **~842ms**, not **~432ms**.

The SSR render is one async function assembled as **prefix → barrier → body walk → drain**
(`compileSSR.ts:78`):

- The **prefix** is the lowered author script plus the injected async-cell declarations. A cell's
  eager effect starts its flight here, synchronously, and registers on `pendingAsyncCellsSlot`
  (`createAsyncCell.ts:192`).
- The **barrier** `await $$settleAsyncCells()` (`settleAsyncCells.ts`) awaits every registered
  blocking-cell flight with `Promise.allSettled`, *before* the body walk, so a blocking cell's
  value is resolved when the template peeks it.
- The **body walk** is linear `$out.push(...)`. A blocking `{await X}` — the value form desugars to
  a `{#await X then __v}` block (`parseTemplate.ts`) — is lowered by `generateBlockingAwait` to a
  **literal inline `await` at its structural position** (`generateSSR.ts:774`), which **halts the
  walk** until it settles. A streaming `{#await X}{:then}` registers a **deferred thunk**
  `promise: () => (X)` on `$awaits` (`generateSSR.ts:842`), started only when `renderToStream`
  drains it **after `render()` returns**.

So blocking and streaming flights **never overlap**: blocking flights resolve at the barrier or at
their inline-await position; streaming flights start after the whole body completes. A streaming
flight textually *after* a blocking `{await}` cannot even begin until the blocking await resolves.

**Proven empirically** (dev server, 2026-07-10):

- Converting the blocking `{await}` to the cell path (`{(await x).name}`) did **not** help
  (~840ms) — a blocking cell just relocates the 400ms from the inline await to the pre-body barrier.
- Manually hoisting the streaming flight to the prefix — `const namesFlight = loadNames(attempt);
  {#await namesFlight}` — dropped the page to **~432ms = max(400,400)**: the flight is now in-flight
  during the blocking wait, so the deferred drain finds it resolved.
- But that manual `const` hoist **broke reactivity** — `namesFlight` no longer re-runs when
  `attempt` changes — *because the const landed in the client build too*, severing the reactive
  thunk `() => loadNames(attempt)` the client re-evaluates on a signal change.

The pathology is **entirely server TTFB**. The client already parallelizes: its mount is
synchronous, so every `$$awaitBlock` starts its promise during the same synchronous mount, and
`renderToStream` races them. Nothing on the client serializes.

## Decision

Introduce a **server-only** primitive `flight(thunk)` (`ui/flight.ts`, alias `$$flight`) and an
SSR-codegen pass that hoists each **hoistable** await's promise-**start** into the synchronous SSR
prefix, leaving everything else — the block's markers, its `$ctx.next++` id, its inline-await
position, the RESUME/streaming wire, and **the entire client build** — untouched.

```
// prefix (after the lowered script, before the barrier):
const $flight0 = $$flight(() => (loadProfile($$read("attempt")).then((p) => p.name)));
const $flight1 = $$flight(() => (loadNames($$read("attempt"))));
// body walk — only the promise source changes:
const $av = await $flight0;                 // was: await (loadProfile(...).then(...))
$awaits.push({ id, promise: () => $flight1, then, catch });  // was: () => (loadNames(...))
```

`flight(thunk)` starts the flight immediately, converting a **synchronous throw** in the loader into
a rejected promise so the block's `{:catch}`/500 path is byte-identical, and attaches a no-op
rejection **keeper** (mirroring `createAsyncCell.ts:197`) so a flight that rejects before its real
consumer attaches a handler is never a Bun-fatal unhandled rejection:

```
export function flight(thunk: () => unknown): Promise<unknown> {
  let promise: Promise<unknown>
  try { promise = Promise.resolve(thunk() as PromiseLike<unknown> | unknown) }
  catch (error) { promise = Promise.reject(error) }
  promise.then(undefined, () => {})
  return promise
}
```

The flight decls are emitted **after the lowered script and before the barrier**, so a hoisted flight
is already in-flight while the barrier awaits any unrelated blocking cell — which is why **no
barrier registration is needed**: the overlap comes purely from both being live prefix promises.
(This sidesteps the cross-layer `pendingAsyncCellsSlot` contamination a register-on-barrier scheme
would risk.)

**Hoistable** iff the await node is at a position whose value is evaluable in the prefix — i.e. its
promise's free identifiers avoid every enclosing **template-local binder** (a `{#for}` item/index,
a `{#for await}` item, a `{:then}`/`{:catch}`/`then v` value binding, a snippet parameter, a nested
`<script>` local) **and** every **async cell** name (`cellReadNames`, unresolved at prefix time) —
**and** the node is not inside a **conditionally-rendered** branch (`{#if}`/`{#switch}`/`{#try}`, a
snippet/slot body, or another await's pending/then/catch branch) **and** is **statically-single**
(on the top-level spine, or inside a single-element-literal `{#for k of [expr] by k}` whose body
renders exactly once). The test is **fail-closed**: any free identifier not provably prefix-evaluable
blocks the hoist. `loadNames(attempt)` qualifies (free ids `loadNames`, `attempt`; the enclosing
`{#for k of [remountKey] by k}` binds `k`, which the promise ignores). `{#await load(row)}` inside a
real `{#for row of rows}` does **not** (its promise reads the row binding) and stays a per-row thunk.

### Why not the isomorphic reactive flight-holder (the rejected alternatives)

Two designs placed the holder on **both** sides — a `createSignalNode` + eager `createEffectNode`
that re-runs the seed on a dep change, consumed via `current()`. They preserve reactivity, but at a
cost the server-only design avoids entirely:

- They add a **client** two-effect cascade whose correctness hinges on the await-block subscribing to
  the promise node and never re-reading `attempt` — a latent double-run/flash, plus a
  premature-rejection window — **to parallelize a client path that is already parallel**.
- One variant additionally edits **both** back-ends and scopes a follow-on wire-contract change
  (path-keyed block ids for sibling child-render overlap).

The server render is single-pass with effects stripped (`compileSSR.ts:20`), so it needs **no
signal/effect machinery** — `$$flight` is ~6 lines. Keeping the client thunk verbatim preserves
ADR-0019/0032 revalidate-on-signal **for free** — which is exactly the failure mode of the
proven-broken manual const, whose only sin was landing in the client build. The server-only design
touches no wire, no id allocation, and no warm-seed index, so it cannot regress hydration by
construction.

## Consequences

- **Independent hoistable flights overlap on the server.** The empirical page ~842ms → ~432ms; N
  top-level blocking `{await}` collapse from N×latency to ~max; a streaming flight behind a blocking
  await overlaps it; a blocking-cell + streaming page settles concurrently (flights start before the
  barrier).
- **Zero wire/hydration change.** Byte-identical shell HTML, RESUME, and CELL_SEED; the client build
  and its reactivity are untouched; block-id and warm-seed congruence hold by construction. The
  pinned suites (`uiNestedBlockingAwait`, `uiSsrAsyncRender`, `awaitInterpolation`,
  `uiRenderToStream`, `ssrAsyncCell`, `uiRenderPathAcrossAwaits`, `uiCellWarmSeed`) stay green.
- **Server-only.** It does not parallelize the client render, sibling child-component renders (they
  share the linear `$ctx` counter — a genuine wire-contract change, deferred), or row/branch-local
  flights (correctly serial).
- **A hoisted flight in a single-element `{#for}` fires once even if the body renders zero rows;**
  safe for idempotent loaders (the framework's model), a documented caveat for effectful ones. A
  sync-throwing loader is normalized to a rejected promise so it still lands in `{:catch}` — a
  deliberate, tested change.

## Spike to run

No committed async-SSR bench exists — author one reusing the ADR-0033 interleaved A/B median harness
(A = branch base, B = this change). Require median B ≈ 432ms vs A ≈ 842ms on the target page, ≈ max
on a two-independent-blocking-`{await}` synthetic fixture, and **no first-byte regression** on a
pure-streaming fixture (the shell must still flush early; `needsAsync` unchanged). A real-timer
regression test (real `Bun.sleep`, two ~25ms independent flights) asserts elapsed < ~40ms (overlap,
not sum) and that a rejecting hoisted flight renders its `{:catch}` with no process-level unhandled
rejection. A byte-congruence guard snapshots the emitted SSR JS + flushed shell and requires the only
diff vs base to be the added prefix `const $flightN = $$flight(...)` lines and the rewired promise
references.

## Follow-up ADRs (deferred)

- **Client-side flight-holders** — only if client render is *measured* as a bottleneck (it is
  already parallel); additive and non-breaking on top of this.
- **Path-derived block ids `${scope.id}:${local}`** to unlock sibling child-component render overlap
  — a genuine `$ctx`-counter → path-keyed RESUME wire-contract change, its own ADR.
