# ADR-0023: Type-directed async-cell classification for `computed`/`linked` seeds

**Status:** proposed (2026-07-08). Extends
[ADR-0019](0019-async-computeds-and-rpc-auto-reads.md)'s type-directed lowering
from template *interpolations* to the `computed`/`linked` *cell* transform, closing
an asymmetry inside ADR-0019 itself. Reuses the warm-shadow classifier machinery
built for ADR-0019 stages A–B (`classifyInterpolationType`,
`interpolationClassifierForRoot`, `nodeAtShadowOffset`). Shares the "resolve through
the real type graph, never guess from syntax" instinct with
[ADR-0022](0022-build-transforms-resolve-through-the-module-graph.md) D1.

## Context

ADR-0019 lowers async values two ways, and the two halves disagree on *how they
decide what is async*:

- **The interpolation half is type-directed.** `{foo()}` / `{getStream()}` classify
  the expression's checker type (`classifyInterpolationType.ts`: `asyncIterable` /
  `promise` / `sync`) against the warm shadow program, then lower accordingly. Precise,
  and fail-open (a resolution hiccup degrades to a plain read).
- **The cell half is shape-directed.** `computed(EXPR)` / `linked(EXPR)` in
  `desugarSignals.ts` decide the same question — promise vs stream vs sync — from
  *syntax*: `isAsyncComputed` (an `async`/`await` modifier), `isBareCallComputed`
  (`ts.isCallExpression(argument) || ts.isIdentifier(argument)`, `desugarSignals.ts:97`).

The `await`-marker path (`isAsyncComputed`) is *deliberately* syntactic — ADR-0019 D1
makes `await` the author's disambiguation marker for a promise, and that must stay a
marker, not a type sniff. The problem is the **no-marker stream path**
(`isBareCallComputed`). It approximates "a source that may produce a
`NamedAsyncIterable`" by "the seed is a bare call or identifier," and hands the result to
`trackedComputed`, which *probes the seed once at runtime* to confirm
(`trackedComputed.ts:33-46`): a real async-iterable becomes an `AsyncComputed`, anything
else falls back to the lazy `Computed`.

Two consequences of the syntactic approximation:

1. **A stream produced by any non-call/identifier expression is missed.**
   `computed(cond ? streamA : streamB)` (conditional), `computed(this.socket)` /
   `computed(obj.stream)` (member access) are not `CallExpression`/`Identifier`, so
   `isBareCallComputed` returns false → the seed routes to the lazy `derive` doc slot
   (read as `name()`), which **never auto-tracks the stream**. The frames never drive the
   cell. A silent correctness gap — the exact "guess from syntax" failure the
   interpolation half already avoids by classifying the type.
2. **Every bare call/identifier pays the runtime probe, even when provably sync.**
   `computed(add(a, b))` where `add: (…) => number` routes to `trackedComputed`, which runs
   `untrack(compute)` (`trackedComputed.ts:40`) just to discover it is not an iterable, then
   falls back to lazy. The probe is cheap but unnecessary when the type is statically
   known non-async.

The warm classifier that fixes both already exists and is *already threaded to the caller*:
`analyzeComponent` receives the `classify` closure (`analyzeComponent.ts:28`) and calls
`lowerScript(…)` (`analyzeComponent.ts:95`) which calls `desugarSignals` — the classifier
just isn't passed the last hop.

## Decision

### D1 — the no-marker stream decision is type-directed, fail-open to today's shape heuristic

Replace the `isBareCallComputed` shape test, *as the classification authority*, with the
seed expression's checker type — reusing `classifyInterpolationType`'s three-way result:

- **`asyncIterable`** → the eager stream cell (`trackedComputed`, read via `$$readCell`) —
  the `cellReadNames` bucket, exactly as today, but now reached by *any* seed whose type is
  a `NamedAsyncIterable`, not only a bare call/identifier. This fixes gap #1.
- **`promise`** (a bare promise, no `await` marker) → held opaque, the lazy `derive` slot
  read as `name()` (`Computed<Promise<T>>`, ADR-0019 D1 table). Unchanged meaning; a bare
  promise still does not auto-track (only the `await` marker unwraps it).
- **`sync`** → the lazy `derive` doc slot, read as `name()` — routed directly, skipping
  `trackedComputed`'s probe. This closes gap #2.

**The `await`-marker path is untouched.** `isAsyncComputed` (D1's `async`-modifier seed)
still takes precedence and stays syntactic — `await` is the author's marker, not a type to
resolve. Type-direction governs *only* the no-marker branch that today is
`isBareCallComputed`.

**Fail-open, identically to the interpolation half.** When the classifier is absent (no
shadow program, no mapping for the seed, any checker throw), the routing falls back to
today's `isBareCallComputed` syntactic heuristic + the `trackedComputed` runtime probe. So
the change is a *strict refinement*: with types it is more precise; without them it is
exactly today's behavior. `trackedComputed` is therefore **not removed** — it remains both
the fail-open target and the runtime confirmation for the syntactic path.

### D2 — thread the seed-type resolver from `analyzeComponent` to `desugarSignals`

`analyzeComponent` already holds `classify` (the `InterpolationClassifier`). Thread a seed
classifier down the one hop it doesn't yet reach: `analyzeComponent` → `lowerScript`
(`lowerScript.ts:56`) → `desugarSignals` (`desugarSignals.ts:181`), as an **optional**
parameter (absent ⇒ fail-open ⇒ today's behavior, so no call site outside the shadow-warmed
path changes).

The resolver's job: given a seed `ts.Expression` in the *component script* AST, return its
`InterpolationKind`. It resolves through the same warm shadow program as the interpolation
classifier — map the seed's **source** location to a **shadow** offset
(`sourceToShadowOffset(mappings, loc)`), find the shadow node
(`nodeAtShadowOffset`-style), and `classifyInterpolationType(checker.getTypeAtLocation(node),
…)`.

**The one genuinely new mechanism — and the central risk — is script-region resolution.**
`interpolationClassifierForRoot` resolves *template-interpolation* locations, and
`nodeAtShadowOffset` assumes an interpolation's parenthesised-expression exact-span shape. A
seed lives in the `<script>` region, so this ADR needs (a) confirmation that the shadow
`mappings` cover the script region with usable source→shadow offsets — the shadow is a
virtual `.ts` at the source path (ADR-0010), so the script *should* map near-identically,
but it must be verified, not assumed — and (b) a seed-aware node finder (the seed is not
wrapped like an interpolation; find the expression node at the mapped seed offset). If (a)
proves false for the script region, this ADR does not ship as designed — see Open questions.

### D3 — `linked` rides the same refinement

`linked(EXPR)`'s seed classification is the same table, writable (ADR-0019 D1). Today
`linked` always lands in `cellReadNames` and wraps its seed (`cellStatements`,
`desugarSignals.ts:481`), delegating promise-vs-stream-vs-sync entirely to the runtime
`linked` primitive's own probe. Type-direction is a smaller win here (the read form does not
change — `linked` is always a `$$readCell`), but the same resolver can annotate the emit so a
provably-sync `linked` seed skips the runtime probe. **Scope this as optional / second
increment** — the headline correctness fix is the `computed` stream gap (D1); `linked`
already auto-tracks via its runtime probe, so it has no correctness gap, only the same
probe-skip perf opportunity.

## Consequences

- **The two halves of ADR-0019 agree.** Interpolations and cells both classify async-ness
  by type, with the identical fail-open contract. One mental model, one reused classifier.
- **Correctness:** a stream from a conditional, member access, or any non-call/identifier
  expression now auto-tracks in `computed(…)`, where today it silently does not.
- **Performance:** a provably-sync `computed(fn())` skips `trackedComputed`'s untracked
  probe, routing straight to the lazy `derive` slot.
- **No behavior change without a warm program.** Fail-open means a project whose shadow
  can't build (or a seed the mapping can't resolve) gets exactly today's syntactic routing —
  the change can never break a build, matching ADR-0019's stage-B guarantee.
- **`trackedComputed` stays.** It is the fail-open target and the runtime confirmation; the
  compile-time classification only decides *whether to emit it* vs. the lazy `derive`.
- **New runtime capability required:** none. This is a compile-time routing refinement over
  existing runtime primitives (`trackedComputed`, `derive`, `createAsyncCell`).
- **Cost:** one added resolver + the script-region mapping/node-finder (D2). The warm shadow
  program is already built once per root for interpolations, so there is no new program-build
  cost — only per-seed offset lookups, on the cold compile path.

## Alternatives considered

- **Keep it purely syntactic, widen `isBareCallComputed` to more node shapes** (member
  access, conditional). Rejected — it is the same "enumerate syntax that might be async"
  guess, never complete (what about `computed((s as Stream))`, `computed(pick())` returning a
  union?), and it is exactly the anti-pattern ADR-0022 D1 and the interpolation half reject.
- **Drop `trackedComputed`'s runtime probe entirely, trust the type.** Rejected — it is the
  fail-open path; without a warm program there is no type to trust, and a hard dependence on
  the checker would make the cell transform break where the interpolation transform gracefully
  degrades.
- **Resolve the seed type in a fresh one-off program** (like `lowerDocAccess` reparses).
  Rejected — a second program build per component is the cost the warm per-root shadow exists
  to avoid; reuse it.

## Open questions

- **Does the shadow `mappings` resolve a `<script>`-region source location to a shadow
  offset?** The load-bearing prerequisite (D2). Discovery-first in the handoff brief: confirm
  against `createShadowProgram` / the mapping builder before implementing. If the script
  region is not mapped with usable offsets, this ADR needs a prior step (extend the shadow
  mapping to the script region) or is deferred.
- **`linked` probe-skip (D3): worth the second increment, or leave `linked` on its runtime
  probe?** Leaning leave-it — no correctness gap, and the perf delta is a single untracked
  read per `linked` at construction.
- **Seed unions.** `computed(cond ? stream : 3)` types as `NamedAsyncIterable<T> | number`.
  `classifyInterpolationType` already splits unions and tests async-iterable first, so it
  would classify `asyncIterable` — routing to `trackedComputed`, whose runtime probe then
  handles the concrete value. Acceptable (the eager cell falls back to lazy on a non-iterable
  frame). Recorded so the brief keeps the union path on the classifier's existing semantics.
