# ADR-0032: Async reads are a `undefined`-while-pending peek everywhere — `await` blocks, `{#await}` narrows

**Status:** accepted (2026-07-09); implemented 2026-07-09 (`liftAsyncSubExpressions` walk +
value/content lift + the `trackedComputed` streaming tier; full suite green). Lifts the restriction
documented in AGENTS.md ("a `Promise`/`AsyncIterable` may only render in **content**
position") and unifies async reading across *all* template positions on one model:
a promise/iterable-typed **(sub)expression** reads as a **throwing peek** —
`undefined` while pending — so it composes with `??`, `?.`, member access, and every
surrounding operator. Extends
[ADR-0019](0019-async-computeds-and-rpc-auto-reads.md)'s throwing-peek value semantics
(declared there for cell/rpc sources) to a **raw** `Promise`/`AsyncIterable`
*expression*, and **amends** [ADR-0023](0023-type-directed-cell-classification.md)'s
content-interpolation lowering: a `promise`-typed `{expr}` stops becoming a synthetic
streaming `{#await}` and becomes the same peek-lift. Reuses the streaming-bare-read
tier of [ADR-0024](0024-ssr-auto-streaming-bare-reads.md). Keeps ADR-0019's marker
asymmetry: `await` disambiguates a promise; a named iterable auto-tracks.

## Context

Today the compiler lowers an async template read **three** different ways depending on
*where* it sits and *what kind* of source it is, and the three disagree:

- **A raw `Promise` in content position** (`{getFoo()}`, `getFoo(): Promise<T>`) →
  a synthetic streaming `{#await}` node (`lowerAsyncInterpolations.ts`
  `streamingAwaitNode:128`) whose pending branch is **empty**. The *whole interpolation
  expression* is awaited.
- **A raw `AsyncIterable` in content position** (`{getStream()}`) → an injected
  `const __cN = computed(<expr>)` stream cell read as a throwing peek
  (`$$readCell`, `dom/readCell.ts:22`) — `undefined`/latest-frame at the *value* level.
- **A raw `Promise`/`AsyncIterable` in a value position** (attribute, `{#if}`/`{#switch}`
  subject, plain `{#for}` source) → **rejected**, two ways: type-directed
  (`asyncValuePositionError.ts:12`, collected by `asyncValuePositionInterpolations.ts:17`,
  thrown at `lowerAsyncInterpolations.ts:49`, diagnosed by `collectAbideDiagnostics.ts:113`)
  and keyword-directed (`rejectAwaitValue` in `parseTemplate.ts` for a leading `await`).

The content-promise path is the outlier that bites. Because it awaits the *whole
interpolation*, the pending state is a **structural empty branch**, not an `undefined`
*value* — so nothing composes with it:

```
{getFoo() ?? 'Loading...'}   // ?? binds to the Promise object (never nullish) → 'Loading...' is dead
{getFoo()?.name}             // .name on a Promise → undefined; never the resolved field
```

Meanwhile the *cell/rpc* read and the *asyncIterable* read already do the right thing —
they surface pending as a real `undefined` value via a peek, so `{user ?? 'Loading...'}`
(cell) already works. **ADR-0019 D1 already declared this the model** — "*the compiled
read is a throwing peek … `undefined`-on-pending … applies uniformly in every
position*." The gap is that a *raw promise* was never lifted into something with a peek;
it was await-lowered instead.

**Everything to close the gap already exists.** The `asyncIterable` content path *is* the
target shape: hoist `const __vN = state.computed(<expr>)`
(`analyzeComponent.ts:91`), rewrite the reference to `__vN`, read `$$readCell(__vN)`.
The value-position leaves are already reactive effects that treat `undefined` as empty
(`mountSwappableRange`, `$$each`, `dom/attr.ts`). The `await`/no-`await` SSR split is one
boolean feeding `awaitPlan`→`generateBlockingAwait`/`generateStreamingAwait`. Only the
front-end decision — await-node vs peek-lift, and reject vs lift — is wrong/​missing.

## Decision

**One model: a promise/iterable-typed (sub)expression lifts to a peek-cell, in every
position. Pending is `undefined`. `await` picks the SSR tier. `{#await}` is the opt-in
for branch structure and `{:then}` narrowing.**

### D1 — an async **sub-expression** lifts to a peek-cell; the read is `undefined` while pending

For every interpolation (content *and* value position), find each
promise/asyncIterable-typed **sub-expression** the classifier resolves (reusing the
`asyncValuePositionInterpolations.ts` collector for value positions and the existing
content classifier for `{expr}`):

- Hoist it to `const __vN = state.computed(<sub-expr>)` — the same hoist the
  `asyncIterable` content path already emits — and **replace the sub-expression in place**
  with the bare reference `__vN`.
- `__vN` reads as a **throwing peek** (`$$readCell`): `undefined` while pending, the
  settled value once resolved (an `AsyncComputed` — the seed unwraps, so peek yields the
  resolved value, never the opaque `Promise`; an iterable seed yields the latest frame), a
  throw to the nearest `{#try}` on error-with-no-retained-value (ADR-0019 D3).

**Lift the sub-expression, not the whole interpolation.** This is the load-bearing choice
that makes composition work: `getFoo() ?? 'Loading...'` lifts only `getFoo()` →
`__v0 ?? 'Loading...'`, so while pending it is `undefined ?? 'Loading...'` → `'Loading...'`.
Lifting the *whole* interpolation (`state.computed(await (getFoo() ?? 'Loading...'))`)
would await the Promise and the fallback would stay dead — the exact bug this fixes. So
the transform targets the outermost promise/iterable-typed **operand**, leaving the
surrounding sync expression (`??`, `||`, `&&`, `?.`, member access, comparison, string
concat) intact around the peek.

**The walk.** Traverse the interpolation's expression AST top-down, classifying each
node: (1) a **sync-typed** node — recurse into its children (a sync parent can wrap an
async child: `String(getFoo())`, `` `${getFoo()}` ``); (2) an async-typed node under a
**pending-tolerant operator** (`??`, `||`, `&&`, `?.`) — *not* lifted; recurse into its
operands (the object base for `?.`) so the operator composes the peeks and reacts to
their `undefined`; (3) **any other async-typed node** — a call, identifier, member
access, or `?:` resolving to a promise/iterable — lifted as a unit, descent stops. Rule
(2) is what keeps `getFoo() ?? 'Loading...'` composing; rule (3) lifts `{cond ? getA() :
getB()}` as one peek (the `await` selects the branch). The walk is bounded to one
interpolation's AST on the cold compile path — one classifier query per node, no new
program build. Two residual, type-visible edges left as-is: a non-optional member on a
promise (`getFoo().name`) needs `?.`; and a `?:` whose *branches* are async is lifted
whole (rule 3), so an async *condition* in that same ternary awaits a truthy promise —
restructure to peek the condition.

Past the hoist every async read — raw promise, cell, rpc — lowers to the identical
`$$readCell` peek. `{getFoo()}`, `{user}`, `{getUser({id})}` differ only in whether the
compiler had to hoist a cell first.

### D2 — the author's `await` keyword sets the SSR tier, nothing else

The peek-cell always unwraps to the resolved value (D1). Whether SSR **blocks** on it or
**streams** it is the *only* thing the author's `await` keyword controls — matching
content position and `{#await p then}` vs `{#await p}`:

- **No `await` → streaming (Tier-3).** The shell renders the pending read as `undefined`
  (empty text / else branch / empty list / unset attribute, D3); the resolved value
  streams in; the client re-runs the read's effect and fills in. The cell does **not**
  join the SSR blocking barrier and its pending resolution holds the stream open
  (ADR-0024 D1/D2).
- **Leading `await` → blocking (Tier-2).** The cell joins the SSR `Promise.all` blocking
  barrier (ADR-0019 D2.2): the server awaits it inline before flush and renders the
  resolved value, hydration warm. `{await getFoo()}`, `href={await avatarUrl()}`,
  `{#if await ready()}`, `{#for row in await getRows()}`. Precedence: `await` binds
  tighter than `??`/`?.`, so `{await getFoo() ?? 'x'}` ≡ `{(await getFoo()) ?? 'x'}` — a
  *resolved*-nullish fallback (blocking), distinct from a *pending* fallback.

The `await` path is **syntactic** (the parser sees the keyword — `rejectAwaitValue`
becomes "mark blocking" instead of "throw"). The no-`await` streaming path is
**type-directed** (needs the classifier to know a sub-expression is async). Identical
fail-open contract to ADR-0019/0023: with no warm program the no-`await` lift is skipped
(degrades to today's runtime stringify), the `await` case still works. The change never
breaks a build.

### D3 — pending is `undefined`, and `undefined` composes

While a lifted cell is pending its peek is `undefined`, and every position renders the
natural empty state — never a throw, so *loading is never mistaken for error*:

| position | pending (`undefined`) | resolved |
|---|---|---|
| bare `{v}` | empty text (null/undefined → `""`) | the value |
| `{v ?? 'Loading...'}` / `{v?.name}` | `'Loading...'` / `undefined` | composes on the value |
| `{#if v}` | falsy → **else branch** | branch on the value |
| `{#switch v}` | matches no `case` → **default** | matches the value |
| `{#for x in v}` (promise of iterable) | **empty list** (ADR-0019 D1) | iterate the resolved iterable |
| whole attribute `attr={v}` | **attribute unset** | attribute set to the value |
| interpolated part `attr="a {v} b"` | part stringifies to `""` → `attr="a  b"` | `attr="a VALUE b"` |

The `??`/`?.` rows are the payoff of D1's sub-expression lift: pending is a real JS
`undefined` at the expression level, caught by `??`/`?.` *before* it reaches the DOM.
Two behavioral edits confirm/complete this: bare `{v}` and interpolated attribute parts
must stringify `undefined` to `""` (not `"undefined"`) — verify `dom/appendText.ts` and
the SSR attribute codegen; a *whole-value* `undefined` still **removes** the attribute.

### D4 — the boundary: a raw `AsyncIterable` in a plain `{#for}`, and `await` on an iterable, stay errors

A raw `AsyncIterable` lifts to a stream cell whose peek is the **latest frame**, so it is
meaningful in `{#if}`/`{#switch}`/attributes/content (react to the newest frame) — those
gain it. The exceptions, which remain compile errors:

- **A raw `AsyncIterable` in a plain `{#for}` source** — iterating an async iterable
  frame-by-frame is `{#for await}`'s job; a single frame is not a collection. Error,
  redirecting to `{#for await}`. (`Promise<Iterable<T>>` in a plain `{#for}` is fine —
  await-then-render.)
- **A leading `await` on an `asyncIterable`-typed position** — `await` unwraps a promise;
  awaiting an async iterable yields the iterable object (always truthy, meaningless).
  Error: drop the `await`, a stream auto-tracks (ADR-0019's marker asymmetry).

### D5 — `{#await}` is the opt-in for branches and narrowing; retire the rejections and the content await-node

With pending surfaced as `undefined` everywhere, the bare read covers the common case;
`{#await}` stays as the explicit tool when you want more than `undefined`:

- **`{:then value}` narrowing** — a bare read is honestly `T | undefined` (ADR-0019's
  accepted trade); `{#await p}{:then v}` narrows `v` to the resolved type. Now the *only*
  narrowing path for a raw promise interpolation.
- **Real pending / catch branches** — `{#await p}spinner{:then v}…{:catch e}…{/await}`
  when you need distinct pending markup or local catch instead of `??` / `{#try}`.

Retired: `asyncValuePositionError` and the parser's `rejectAwaitValue` as *rejections*
(the collector stays, now feeding the lift); and the **synthetic streaming `{#await}`
node for a content-position `promise` interpolation** (`streamingAwaitNode`) — a
`promise`-typed `{expr}` now peek-lifts like the `asyncIterable` path, amending ADR-0023.
`collectAbideDiagnostics` keeps only D4's two narrowed errors.

## Consequences

- **Async reads uniformly, in every position, and compose.** `{getFoo() ?? 'Loading...'}`,
  `{getFoo()?.name}`, `{#if getFoo()}`, `href={getFoo()}` all work; pending is `undefined`
  everywhere, `await` blocks SSR everywhere, `{#await}` narrows everywhere. One model, one
  `$$readCell` read past the hoist.
- **The look-alike footgun is gone.** `{cell ?? 'x'}` and `{rawPromise ?? 'x'}` — identical
  at the call site — now behave identically (both peek), where today the raw-promise form
  silently drops the fallback.
- **Loading ≠ false/empty is still silent in value positions — documented.** A value
  position has no `{:pending}` slot; pending collapses into the default (else / no match /
  empty list / unset attr). Distinguish loading from a settled falsy value with `??`,
  `{#if x.pending()}`, or `{#await}`. The conscious price of the terse form.
- **`{:then}` narrowing is now only via `{#await}`.** A bare interpolation is `T |
  undefined`. Accepted per ADR-0019; recorded because this ADR removes the synthetic-await
  path that some might have leaned on for the resolved type.
- **Unbounded raw-promise streaming.** A no-`await` raw promise has no endpoint `timeout`,
  so its streaming can hold the SSR stream open until it settles — same as content today.
  Bound it with `await` (blocking) or an rpc source.
- **Reuses existing machinery** — the collector, the `analyzeComponent` cell hoist,
  `$$readCell`, `awaitPlan`/blocking-streaming tiers, `mountSwappableRange`, `$$each`'s
  undefined-as-empty, ADR-0024's drain. **New/changed:** the front-end lift replacing the
  two rejections *and* the content await-node (D1/D2/D5), the sub-expression targeting
  (D1), the `undefined`→`""` stringify for bare reads and interpolated attribute parts
  (D3), the two narrowed errors (D4). No new runtime primitive.
- **Fail-open, build-safe** — no warm classifier ⇒ the no-`await` lift is skipped
  (unchanged runtime behavior), the syntactic `await`-blocking path still works.

## Alternatives considered

- **Classify + lift the *whole* interpolation** (today's content-promise shape, extended).
  Rejected — awaiting the whole expression puts `??`/`?.` *inside* the await, so the
  fallback stays dead. Sub-expression targeting (D1) is the whole point.
- **Keep the content-promise await-node, only add value positions.** Rejected — it leaves
  three inconsistent lowerings and the `{rawPromise ?? 'x'}` footgun in content. Unifying
  on the peek is cleaner and is what makes `??`/`?.` compose.
- **Add a `{:pending}` slot to value positions.** Rejected — re-invents `{#await}`'s
  branches at every position; the probe (`{#if x.pending()}`) and `{#await}` already express
  it.
- **A `??`/`||`-wrapping-a-promise warning instead of the lift.** Rejected as the *fix* —
  a warning documents the footgun; the peek-lift removes it. (A warning may still help where
  no classifier is available and the lift can't fire — Open questions.)
- **Make the no-`await` case blocking too.** Rejected — contradicts `await`-as-blocking-
  marker and reintroduces the request waterfall streaming avoids.

## Open questions

- **Blocking-barrier membership threads from the read site (D2 `await`).** Verify the
  `await`-marked lifted cell joins the SSR `Promise.all` barrier and the no-`await` cell is
  excluded, the tier bit reaching the barrier gather — not only the old content-`{#await}`
  path.
- **`{#for}` over `Promise<AsyncIterable<T>>`.** Await the promise, then require `{#for
  await}` on the result? Leaning: error, redirect to `{#for await (x of await p)}`.
- **Losing `{:then}` narrowing (D5) — acceptable?** Leaning yes (ADR-0019 already made the
  bare read `T | undefined`); recorded because this ADR removes the one content path that
  still narrowed a raw promise without `{#await}`.

## Resolved

- **The sub-expression lift boundary → a top-down walk (D1).** Descend through the
  pending-tolerant operators (`??`/`||`/`&&`/`?.`) into their operands; lift every other
  async-typed node as a unit; recurse through sync nodes into their async children. This
  replaces "classify one interpolation" with "walk and lift sub-nodes," and is written into
  D1's **The walk**.
- **SSR-streaming a keyless raw-promise cell → stream if the lifecycle drains a keyless
  cell, else degrade to buffered (D2 no-`await`).** A no-`await` raw-promise `AsyncComputed`
  has no cache key or `timeout`; it streams via the eager-cell wake if the async-cell
  lifecycle already drains a keyless cell, otherwise the shell ships pending-`undefined` and
  the client resolves on hydrate. Both are correct — pending renders `undefined`, resolves
  later — so implementation takes whichever the lifecycle already supports; no new streaming
  path is required for this ADR to be correct.

## As built

- **The walk is `compile/liftAsyncSubExpressions.ts`**, driven by `lowerAsyncInterpolations` over
  content parts and value positions; it reuses the existing `InterpolationClassifier` unchanged (the
  D1 gate held). It **stops at nested function boundaries** (arrow/function) — an async
  (sub)expression inside a callback (`items.map(x => fetch(x))`) is NOT hoisted, or the callback's
  params would become free identifiers — mirroring `desugarSignals.hasTopLevelAwait`.
- **The tier is one runtime flag.** A lifted promise cell emits `computed(async () => await (<expr>))`;
  `desugarSignals` routes it to `scope().trackedComputed(async …, <streaming>)` with `streaming =
  !blocking`. `trackedComputed`/`createAsyncCell` gained a `streaming` option gating SSR-barrier
  registration (`pendingAsyncCellsSlot`): streaming (no-`await`) ships pending and resolves on the
  client; blocking (`await`) joins the `Promise.all` barrier and resolves inline. An `AsyncIterable`
  cell stays a bare `computed(<expr>)` → `trackedComputed(() => <expr>)`, byte-identical to the
  explicit form (a stream never registers on the barrier).
- **The promise seed is an explicit async arrow**, not bare `await <expr>` text: inside an async
  arrow `await` is a keyword and the parens are unambiguous, whereas `computed(await (X))` reparsed
  at module scope reads `await(X)` as a *call* to a function `await`. The parens also give a lifted
  ternary the correct precedence (`await (cond ? a : b)`).
- **Content-position inline `{await expr}` awaits the WHOLE interpolation — by design.** It
  shorthands the `{#await expr}` block, so `{await getUser() ?? 'Guest'}` awaits
  `getUser() ?? 'Guest'` as one unit (consistent with the block form) — a well-defined, syntactically
  correct grouping, not the sub-expression split. D2's `await`-precedence rule (`(await X) ?? Y`) is
  the *value-position* semantics, where the walk splits the operand; both agree for the common
  `{await getFoo()}`.
- **The type-check shadow mirrors the peek, so `abide check`/the LSP see the RESOLVED type — no
  false errors, and hover/completion are correct.** The runtime lift makes `getFoo()?.name` and
  `{#if getFoo()}` read the resolved value, but a verbatim shadow type-checks the RAW expression —
  `.name` on the un-awaited `Promise`, the promise always-truthy. So the shadow now **peek-wraps**
  each async (sub)expression: `compileShadow` (given an `InterpolationClassifier`) emits
  `$$peek(getFoo())?.name` / `if ($$peek(getFoo()))`, where `$$peek<T>(v): Awaited<T> | undefined`
  and `$$peekStream<S>(v): (S extends AsyncIterable<infer F> ? F : unknown) | undefined`. Every
  source char stays mapped 1:1 (the inserted wrapper chars are unmapped), so diagnostics and
  hover-spans land precisely, and `?.`/`??`/`{#if}` compose on the resolved value exactly as at
  runtime — a typo is now caught against the *awaited* shape, and hovering the member shows its real
  type. The wrap reuses the runtime walk (`liftAsyncSubExpressions` now also returns its lifted
  `spans`) and is gated to content/attribute/`{#if}`/`{#switch}`/`{:elseif}`; `await` stays verbatim
  (it already resolves in the async shadow render fn), and component props / plain-`{#for}` sources
  are left raw (they don't peek at runtime).
- **The classifier rides a separate verbatim program (two passes).** Deciding *which*
  sub-expressions are async needs types, and a classifier reading the peek-wrapped shadows would be
  circular — so a verbatim shadow program is built first (`getFoo()` still `Promise`) and its
  classifier drives the wrapped pass. `abide check` builds both per project root
  (`interpolationClassifierForRoot` for the verbatim source); the LSP runs two `LanguageService`s
  sharing `overlays`/`versions` (so both track unsaved edits) but with separate shadow caches +
  document registries — the verbatim one classifies, the wrapped one answers diagnostics/hover/
  tokens. `shadowInterpolationClassifier` is the shared core.
- **`isSpuriousAsyncReadDiagnostic` remains as a fail-open backstop.** When no classifier is
  available (no warm program, an unparseable field, a `classify` throw) the shadow falls back to
  verbatim, which re-raises the spurious 2339 (missing property on `Promise`) / 2801 (always-defined
  condition). The predicate drops exactly those two — 2339 only via `?.` on a promise/iterable whose
  member resolves on the awaited/frame type (a bare `.name` and a real typo both stay), 2801 only
  for a genuinely async subject, both only inside the template region — so a fail-open never leaks a
  false error (it only loses the resolved-type hover). It is a no-op whenever the wrap succeeded (the
  base is then the resolved type, not a promise).

## Known limitations

- **`abide check` classifies whole interpolations, not sub-nodes.** A D4a `AsyncIterable` nested in a
  larger `{#for}` source, and the D4b `await`-on-a-stream case, throw at build but aren't surfaced by
  `abide check`. Parity gap, not a runtime bug.
- **An interpolation that doesn't re-parse as a single expression skips the lift** (a bare object
  literal `{ {a: getFoo()} }`), degrading to today's stringify — fail-open, acceptable, documented.
- **A probe fed a lifted async expression sees `undefined` first.** `{done(getFeed())}` /
  `{peek(getFeed())}` want the *subscribable itself*, but the peek-lift hands the probe `undefined`
  while pending (and, for an `AsyncIterable`, the latest *frame* once settled — not the source). The
  idiom is to probe in script (`const closed = state.computed(() => done(feed))`) and read the boolean
  in markup. `done()` / `peek()` are now null-tolerant (return `false` / `undefined` on a nullish
  argument) so the inline form renders gracefully instead of throwing on `subscribable.name`; the
  script form remains the correct way to get an accurate stream probe.
