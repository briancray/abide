# ADR-0042: `await` means "resolved" — the client suspends to mirror the server flush barrier

**Status:** accepted (2026-07-13); implemented 2026-07-13 with one simplification to D3's suspense-boundary mechanism — see the [Implementation note](#implementation-note-as-shipped-2026-07-13). **Amended by [ADR-0046](0046-pending-propagates-through-the-dependency-graph.md)** (2026-07-15): the suspend semantics stand, but D5's read-callee mechanism (a distinct `$$readCellBlocking`, the threaded `blockingCellNames`, client-template-only) is replaced by one node-aware `$$readCell` that pauses off the cell's own `blocking` bit, and the suspend now extends to **script** reads so pending propagates through the whole dependency graph. Amends [ADR-0032](0032-async-value-positions.md)'s "async reads are a `undefined`-while-pending peek *everywhere*" for the `await`-marked subset only; the bare/streaming read is untouched. Builds on [ADR-0019](0019-async-computeds-and-rpc-auto-reads.md) (the throwing-peek value rule, the reactive `{#try}` keep-the-watch loop), [ADR-0024](0024-ssr-auto-streaming-bare-reads.md) (streaming bare reads hold the SSR stream open), [ADR-0033](0033-render-path-survives-a-renders-awaits.md) / [ADR-0011](0011-warm-seed-uses-two-codecs.md) (render-path-keyed warm-seed), and [ADR-0034](0034-server-only-flight-holders-parallelize-ssr-awaits.md) (parallel SSR awaits).

## Context

Under ADR-0032 a promise/iterable read is a **throwing peek** in *every* position — `undefined` while pending, the settled value once resolved — regardless of whether the author wrote `await`. The author's `await` keyword controls only the **SSR tier**: blocking (join the `$$settleAsyncCells` `Promise.allSettled` barrier, `settleAsyncCells.ts:15`, render resolved inline) vs streaming (ship the shell pending, resolve on the client). The *client* read is identical either way: `$$readCell` returns `undefined` while the promise is unsettled (`readCell.ts:22-28`).

Two facts make this a footgun for the `await` case specifically:

- **`await` is type-invisible.** A lifted `const sources = state.computed(await getSources())` is read as `T | undefined` — the same type a bare read gets — so an author who wrote `await` *to say "this is resolved"* must still write `sources?.length`. Writing or deleting `await` changes nothing the type system can see. (This bit a real README/example: `open={!sources.length}` crashed on the pending render; the fix was `sources?.length`.)
- **The server already blocks; the client does not.** For an `await`-marked value the server withholds the entire layer flush until it settles. The client renders the same component eagerly against `undefined`, so on a cold client-side navigation (no SSR for that route) the pending window is observable and the `undefined` is real.

The insight this ADR turns into a decision: **for an explicitly `await`-marked value, blocking is the opted-in intent** — so the client should *mirror* the server and withhold the region reading it until it resolves. This is not the rejected "make the default blocking" waterfall (ADR-0032 Alternatives): it applies only to values the author marked `await`. Once the client withholds pending regions, the pending value is never observed for an `await` binding, so typing it `T` becomes sound.

## Decision

**`await` is the single, uniform marker that a value is resolved** — for the awaited binding *and* every dependent that reads it, on both sides. A bare read stays exactly ADR-0032.

### D1 — two modes, one marker

| authored form | type | server | client |
|---|---|---|---|
| **`await X`** (blocking) — `computed(await X)`, a top-level `await` in the seed body, inline `{await X}`, `{#await X}{:then}` | resolved `T` (frame `F` for a stream) | joins the `$$settleAsyncCells` barrier; renders resolved inline | **suspends** the reading region until the value exists; then reveals |
| **bare read** (streaming) — `{getFoo()}`, `computed(getFoo())`, `computed(async () => getFoo())` | `T \| undefined` | ships the shell pending, holds the stream open (ADR-0024) | throwing-peek: `undefined` while pending, streams in, composes with `??`/`?.` — **unchanged** |

The observable meaning of `await`: writing it makes the value `T` and defers its region; deleting it re-adds `| undefined` and streams. The distinction is only visible under `strictNullChecks` (which `verify` runs via `tsconfig.consumer.json`); a non-strict consumer erases the union with no runtime change.

### D2 — client suspense is **fine-grained**, at existing reactive ranges

The region a blocking read defers is the **nearest enclosing reactive range of that read site** — and nothing coarser. There is **no component-root fallback**: the suspend is always local to where the `await` was written.

- `{#if await foo()}` / `{#switch await foo()}` → the block's own subject range withholds (renders neither branch) until resolve — suspends *only that block*. This reuses the existing `$$cellPending` withhold the block readers already take (`when.ts`); a blocking subject makes that withhold the suspense.
- `{#each await getRows()}` → the `{#each}` range withholds until the source resolves.
- `{#await X}{:then}` → already withholds its range (unchanged).
- bare `{await foo()}` interpolation → that text node's effect self-withholds (renders empty) until resolve.
- `attr={await foo()}` → that attribute's effect leaves the attribute unset until resolve.

Dependent cells propagate transitively: a range reading a *dependent* cell stays suspended until that cell resolves, which is after its own `await` dependency resolves.

**Fine-grained is sound.** Suspense only ever bites on a cold client-side navigation — on SSR-hydrate every blocking cell is warm-seeded to `hasValue` before first paint (D4), so it never suspends. On a cold client nav the server rendered *nothing* for that route, so there is **no server markup to diverge from**; a region may reveal on its own dependency's settle with zero hydration-divergence risk. This is why coarse (whole-layer) reveal is *not* forced: the "faithful mirror of the layer flush" is aesthetic symmetry, not a correctness constraint. The only thing traded away by going fine-grained is one-shot coordinated reveal (all regions appear together, one layout shift); progressive per-region reveal is the accepted, usually-better behavior.

**Independent awaits still load in parallel.** Every blocking cell eager-runs its seed at construction (`createAsyncCell.ts` — "the effect runs the seed once at construction … so independent cells load in parallel and a dependent cell re-loads when its dependency settles"), so N independent `await`s are in flight concurrently — the client mirror of the server's `Promise.allSettled` barrier (ADR-0034). Only the *reveal* of each region is gated on its own dependency. A dependent cell serializes behind its dependency — an inherent data-dependency waterfall, accepted.

**v1 has no author-visible pending branch for a bare `await`.** A suspended region withholds to empty until resolve, matching the server (the shell shows nothing until it flushes). Layout shift on a cold nav is accepted. An opt-in pending-fallback construct is future work; `{#await X}spinner{:then v}` already covers the case where you want explicit pending markup.

### D3 — suspense is its own channel: `SuspenseSignal`, never `{#try}`

A pending read of a blocking cell throws a **`SuspenseSignal`** — a distinct sentinel class, sibling of `AsyncCellError` (`readCell.ts:3`), carrying the cell. A suspend is "no value **yet**," not an error, and it must **never** route through the author's `{#try}` boundary (`CURRENT_BOUNDARY`) — doing so would flash the author's `{:catch}` branch during loading. It routes through a **separate ambient `CURRENT_SUSPENSE` slot**, installed by the compiler at the component root. The boundary is:

- **opaque to `SuspenseSignal`** — withholds the region and keeps the watch;
- **transparent to `AsyncCellError`** — a real rejection still propagates to the nearest `{#try}` (ADR-0019 D3), unchanged.

The suspense boundary **reuses the reactive-`{#try}` keep-the-watch recovery loop** (ADR-0019 D3.3): subscribe the cell(s), skip the still-pending first run, re-arm and rebuild the region when every tracked cell reaches a value. Only the *installation* and the sentinel-vs-error discrimination are new; the anchored-branch + watch-cell machinery is factored into a sibling `suspenseBlock`, not duplicated. The DOM-block blocking form `{#await X}{:then v}` needs **zero change** — a blocking await block already detaches its branch until settle, which *is* local client suspense; the gap this ADR closes is the bare script `await X` / named blocking binding, which has no enclosing block today.

> **As shipped (2026-07-13):** the ambient `CURRENT_SUSPENSE` slot + compiler-installed `suspenseBlock` proved unnecessary and were **not built**. Every reading region already runs inside its own reactive effect, so it catches its own `SuspenseSignal` locally and re-runs on settle (the throwing read subscribed that effect to the cell) — which *is* the keep-the-watch loop, without a distinct boundary object. `flushEffects` keeps only the sentinel-vs-error discrimination (a `SuspenseSignal` is never routed to `{#try}`; a real error still is). See the [Implementation note](#implementation-note-as-shipped-2026-07-13).

### D4 — SWR on re-run; suspend only on first resolution

A region suspends **only when there is no value yet** (`pending()` — `inFlight && !hasValue`). Once resolved:

- **re-run / `refresh()` / dependency reseed → hold stale, never re-suspend.** `acceptValue` only ever sets `hasValue` true; a reseed keeps the retained value visible while the fresher source is in flight (`refreshing()`), so an `await` binding is stale-while-revalidate — the held value stays on screen, focus/scroll/input survive. This falls out of the existing cell (`peek()` is "the retained value/latest frame (stale-while-revalidate)"); no new retention machinery.
- **error with a retained value → SWR value shown**; **error with no retained value → `AsyncCellError` → `{#try}`** (D3, unchanged).

**The suspend predicate is `pending()`, never `inFlight` alone.** This is the highest-risk detail: on SSR-hydrate the warm-seed sets `hasValue` *before* the eager run flips `inFlight`, so first paint is `refreshing()`, not `pending()` → the read returns its held value and adopts the SSR markup in place, **no suspend, no flash**. Keying suspense on `inFlight` would re-blank every warm-seeded region on every revalidation and resurrect the hydration flash worse than today.

So the full contract: **an `await` binding is never `undefined` at a read site — it is the fresh resolved value, or (during revalidation) the last good one.** That is what makes the `?.`-free `T` typing honest.

### D5 — one blocking predicate, three consumers

The blocking bit is derived once and consumed by three sites so the type can never claim "resolved" while the runtime ships pending:

1. **Runtime `streaming` flag** — `desugarSignals` passes `streaming = !blocking` into `createAsyncCell` (the flag already exists: `trackedComputed(async …, streaming)` gates the SSR-barrier registration and the resolved-vs-streamed recording split).
2. **Shadow type** — `compileShadow` picks the existing resolved helper (`$$cellValue`, unwrapping `R extends AsyncIterable<infer F> ? F : Awaited<R>`) for a blocking read vs a **new `$$cellValuePending`** — the identical unwrap with an unconditional `| undefined` appended — for a streaming read. Selection is by the classifier, so no duplicated promise/iterable detection to drift. `await` in source stays verbatim in the async shadow render fn (TS already resolves `Promise<T> → T` there).
3. **Read callee** — `renameSignalRefs` gains `blockingCellNames` and emits a distinct **`$$readCellBlocking(name)`** at blocking read sites; streaming reads keep `$$readCell` byte-identical. `$$readCellBlocking` throws `SuspenseSignal` **iff `cell.pending()`** (hasValue-based) — never `peek() === undefined`, so a blocking cell that legitimately resolves to `undefined` does not suspend forever; error-with-no-value still throws `AsyncCellError`.

A parity/fuzz test asserts all three derive from the one predicate — the guard `blockingCellNames` and the two-pass classifier were built to demand.

### D6 — `await` is the sole blocking marker; the async modifier alone is streaming

Blocking is decided uniformly by the presence of `await`, across all three lowerings:

- `computed(await X)` (bare seed, `wrapSeed` async-wraps) → **blocking**
- `computed(async () => await X)` (top-level `await` in the thunk body) → **blocking**
- `computed(async () => getFoo())` (async modifier, **no `await`**) → **streaming** *(behavior change)*
- inline `{await X}` / `{#await}` → blocking (already correct)

Today the async *modifier* alone routes to a blocking cell. The flip requires extending blocking detection to descend one level into a thunk body — a bounded await-walk stopping at nested function boundaries (`hasTopLevelAwait` currently stops *at* the arrow). Rationale: otherwise a value is resolved-typed without the author writing `await`, which is precisely the marker this ADR makes load-bearing. This is a **breaking change** — examples migration + changeset required, alongside the `T | undefined` → `T` narrowing break for existing `await` bindings.

### D7 — barrier completeness is a build-time invariant

A blocking cell must be **constructed before its `$$settleAsyncCells` barrier**. If one were constructed after the barrier drained, the server would render its spot with pending `undefined` content (benign today — the client also renders `undefined` and matches), but under D2 the client would **suspend** against server markup that shipped `undefined`, with no warm-seed to adopt (the cell never resolved on the server) → a hydration claim mismatch.

**Decision: enforce at build time (hard assert), not a runtime fallback.** A graceful "revert to streaming on a claim mismatch" would mean `await` *silently sometimes* fails to deliver a resolved `T`, undermining the guarantee this ADR exists to provide. The compiler already injects `$$settleAsyncCells` after all cell declarations, so normal code satisfies the invariant by construction; any new blocking-construction site that could sit past its barrier fails the build with a clear message. (Blocking cells inside a streamed child resolve during the drain and ship as warm-seed deltas — present on the client, so no suspend.)

## Consequences

- **`await` becomes type-meaningful.** An `await` binding and its dependents are `T`; the `?.` disappears from the awaited path. A bare read stays `T | undefined` and keeps composing with `??`/`?.`. Writing/deleting `await` now has a visible type effect.
- **A bounded fracture of ADR-0032's uniform model.** "One read, `undefined` everywhere" becomes two read kinds — `$$readCell` (streaming, byte-identical) and `$$readCellBlocking` (throws `SuspenseSignal` on pending) — plus the `SuspenseSignal` class and each reading region's local suspend-catch (as shipped; the ambient boundary of the original D3 was simplified away). The fracture is confined to bindings the author opted into blocking on, reuses the `{#try}` recovery loop rather than reinventing it, leaves `{#await}` blocks untouched, and **closes a latent soundness lie** (today the shadow could type a lifted `await X` as `T` while the runtime returns `undefined` on a cold nav). The type change (D5) is unsound shipped alone, so **D2 + D5 ship as one atomic change** gated on the single predicate.
- **New runtime capability:** fine-grained per-region client suspense — each DOM primitive (`appendText`, `attr`, `each`, `spreadAttrs`, `watch`, and the `when`/`switchBlock` condition) discriminates `SuspenseSignal` vs error by `instanceof`, withholds to an empty fallback while pending, and reveals on settle via the effect's own re-run. Reuses the eager first-run, the warm-seed, and the ADR-0019 recovery loop; no ambient boundary object and no new async-cell primitive.
- **Breaking (D6):** `computed(async () => getFoo())` without `await` flips from blocking to streaming; existing `await` bindings narrow `T | undefined → T`. Examples migration + changeset.
- **Progressive reveal, not coordinated (D2).** Independent regions on a cold nav appear as each dependency settles, not all at once. Accepted; the usually-better behavior. Coordinate explicitly with a shared `{#await}` when a joint reveal is wanted.

## Implementation note (as shipped, 2026-07-13)

Three deltas from the decision above, all discovered while wiring it up:

- **D3's ambient boundary was simplified to per-region local catches.** The plan installed a `suspenseBlock` at the component root that set an ambient `CURRENT_SUSPENSE` slot so a thrown `SuspenseSignal` could be routed back to a boundary object (`suspenseFor` map). In practice every blocking read already happens *inside its own reactive effect* (the interpolation/attribute/`{#each}` source/spread/`watch`/condition effect), so that effect can `try/catch` its own `SuspenseSignal`, withhold to an empty fallback, and re-run on settle — the throwing read subscribed the effect to the cell, which is exactly "keep the watch." `CURRENT_SUSPENSE`, `suspenseFor`, the `Suspense` type, and the `suspenseBlock` construct were therefore never built (a first cut added them, then removed as dead). `flushEffects` retains only the load-bearing half: a `SuspenseSignal` is discriminated by `instanceof` and **never** routed to a `{#try}` boundary (that would flash `{:catch}` during load); a real error still routes there. The shared per-region helper is `withSuspense(read, fallback)` (text binds use `readTextOrSuspend`; an attribute unsets itself inline).

- **The blocking predicate is one shared walk, not two mirrors.** D5's "one predicate" was initially a hand-copied `hasTopLevelAwait` in `desugarSignals` and a second `expressionHasTopLevelAwait` in `compileShadow` with a *different* boundary set — safe only by accident (the runtime set was a superset, so the unsound direction couldn't occur). Unified into a single `compile/hasTopLevelAwait.ts` (over `compile/isFunctionScopeBoundary.ts`) that both import, closing the drift risk the D6 open question flagged.

- **Control-flow conditions needed the same local catch.** A blocking cell embedded in an `{#if}`/`{#switch}` condition via a member access or compound (`{#if !sources.length}`, `{#if user && await load()}`) is not the bare-`await`-subject form, so it lowers to `$$readCellBlocking(cell).member` with no `$$cellPending` gate and runs synchronously at `mountSwappableRange` build. `when`/`switchBlock` now catch the `SuspenseSignal` from the condition thunk and withhold the whole block (render neither branch) until settle — the same withhold a bare async subject already takes — rather than letting it escape the build. (An escaped `SuspenseSignal` with no local catch is surfaced as a fatal flush error, by design: it means a blocking read sits somewhere with no enclosing effect, e.g. an event handler.)

## Alternatives considered

- **Coarse (whole-component/layer) suspense** — reveal every blocking region together, mirroring the layer flush exactly. Rejected as the default: the mirror is aesthetic, not a correctness constraint (suspense bites only on cold nav, where no server markup exists to match), and it makes independent ready content wait on the slowest await. Fine-grained (D2) is the honest expression of "await blocks only its dependents." Trade: loses one-shot coordinated reveal.
- **Route the pending sentinel through `{#try}`/`CURRENT_BOUNDARY`** (extend the existing boundary handler). Rejected — conflates "loading" with "error," flashing the author's `{:catch}` during a normal load. D3's separate `CURRENT_SUSPENSE` channel keeps the two orthogonal.
- **Runtime fallback for a late-constructed blocking cell** (D7 alternative) — revert to streaming on a hydration claim mismatch. Rejected: silently defeats the `await = T` guarantee. Build-time assert fails loud instead.
- **Keep the async modifier as a blocking marker** (no D6 flip). Rejected — resolves a value without the author writing `await`, contradicting the single-marker model.
- **Suspend on `inFlight`** rather than `pending()`. Rejected — re-blanks warm-seeded regions on every revalidation and resurrects the hydration flash (D4).

## Open questions

- **Attribute / interpolation granularity — RESOLVED.** No bubbling to an enclosing element or the component root. The suspend unit is each read site's own reactive effect: a bare interpolation self-withholds its text node (renders empty until resolve), an attribute leaves *itself* unset until resolve, and a block (`{#if}`/`{#each}`/`{#switch}`/`{#await}`) withholds its own range. `{#if await foo()}` suspends only that `{#if}`. See D2.
- **Opt-in pending fallback for a bare `await`.** v1 withholds to empty (D2). A future `{await X | fallback}` (or reusing an ambient `{#suspense}`) would let a bare `await` show pending markup without dropping to a full `{#await}` block — deferred.
- **`abide check` parity for the D6 thunk-body await-walk — RESOLVED (2026-07-13).** The build lowering (`desugarSignals`) and the shadow (`compileShadow`) now import ONE shared `hasTopLevelAwait` (over a shared `isFunctionScopeBoundary` stopping at function/arrow/method/accessor/constructor), so there is no second walk to drift — a nested-method `await` classifies streaming on both sides. Pinned by the D5 parity test.
