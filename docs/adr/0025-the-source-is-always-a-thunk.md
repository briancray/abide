# ADR 0025 — the source is always a thunk

**Status:** accepted. Supersedes ADR 0024 §5 (dependency position).

## Context

ADR 0024 made a memo's dependencies its declared inputs. For the two-argument form —
`memo(source, transform)` and its mirror `watch(source, handler)` — §5 added a compiler exception:
a bare cell or memo in the FIRST argument stayed the NODE instead of being auto-called, so you wrote
`watch(count, handler)` rather than `watch(() => count, handler)`. The thunk was treated as ceremony.

That exception cost more than it saved.

1. **It only existed in the compiler.** The runtime never needed it — a cell already *is* `(): T`,
   which is what `source: () => T` expects. Nothing about the API required the sugar.
2. **It could not be type-checked.** `emitCheck` doesn't rewrite references; it unwraps declarations
   (`let count = __abideUnwrap(state(0))`) so a bare use is the VALUE. Under that strategy `count` is
   `number` and can never satisfy `() => T`, so every use of the mandated form reported an error.
   Two emitters, two different meanings for the same syntax — the docs app carried 5 standing errors
   that were not false positives: the checker was right and the sugar was wrong.
3. **It did not generalise.** Declaring SEVERAL inputs meant inventing more API — an array or an
   object of nodes — and then teaching the compiler to keep bare identifiers inside that literal as
   nodes too, including object shorthand. Each new shape needed a new exception.

## Decision

**The first argument of `memo(source, …)` and `watch(source, …)` is always an argless thunk.**

- The tracked region is the thunk's body. Nothing else is tracked; the transform/handler runs
  untracked, exactly as before.
- Several inputs need no API of their own — they are whatever the thunk returns:
  `memo(() => ({ a, b }), ({ a, b }) => a + b)`. The transform still takes ONE argument.
- A bare cell in the source slot is now an ordinary read, which is a type error at the call
  (`number` is not `() => T`). That is the correct diagnostic: the thunk is not optional.

This does **not** touch the keyed form. `memo(fn, opts?)` — where `fn` takes args and they are the
cache key — is what `GET`/`POST` build (`makeRpc.ts`: `memo<Args, T>(fn, memoOptions)`, a options
OBJECT in the second slot). The two forms are disjoint, and the SECOND argument tells them apart:
an object is options, a function is a transform. Pairing an args-taking body WITH a transform is
neither, and would call the handler with no arguments and memoize that under a single slot — so it is
now a loud construction-time `TypeError` rather than a silent misread.

## Consequences

Deleted, not fixed:

- `inDependencyPosition`, `opensDepCall`, and the `depCallees` plumbing through `CellScope`,
  `RawScript`, and `analyzeScope` (~17 references).
- `memoKind`'s bare-node and object-literal source cases, and with them the `known`/`outerNodes`
  scope threading that existed only so a node source could be recognised across scripts.
- The `Record<string, () => unknown>` overloads on `memo`/`watch`, their runtime key-walking, and the
  loud errors guarding them.
- All 5 `abide check` errors in the docs app. They stop existing rather than needing an
  `emitCheck` re-wrap.

Kept:

- `watch(thunk)`, the one-argument auto-tracked effect — unchanged.
- The argless-vs-args rule of ADR 0024 §1–4 — unchanged. This ADR narrows §5 only.
- In plain `.ts` a callable cell still satisfies `() => T` structurally, so `watch(count, handler)`
  keeps working there. Only the `.abide` sugar is gone.

One fix landed alongside and stays load-bearing: a destructured PARAMETER (`({ a, b }) => …`) whose
names collide with a cell's did not register as a binding, so it both lost its shadow and expanded as
if it were an object literal — emitting invalid JS (`({ a: a() }) =>`, `([a()]) =>`). The thunk form
makes `memo(() => ({ a, b }), ({ a, b }) => …)` the normal spelling, so parameter patterns had to
bind correctly. See `collectPatternBindings`.

## Corollary: a keyed body may be synchronous too

Making the thunk the only tracked region clarified what "declaring an arg" actually buys: the args
become the whole dependency set, so the body needs no tracking — it just runs. Nothing about that
requires a promise. A keyed body that returns a plain value now returns it **directly**:

```ts
const v = memo(({ a, b }) => a + b)
v({ a: 1, b: 2 })   // 3, not Promise<3>
```

Same reasoning as ADR 0024 §3: a promise-returning read blanks the server-rendered text and refills a
microtask later. It applies to any synchronous body, keyed or not.

The keyed sync path deliberately does NOT reuse the auto-tracked backing, for two reasons:

- The backing tracks the body's reads. Args-declared means args-only, so it would contradict §1.
- Its `fill` runs `fn` to decide anything, which would discard a value the slot already holds. That
  matters: a slot can be settled without the body ever running — a hydration `seed`, a `publish`.

Instead the read consults the ordinary slot state machine first, so `seed` / `publish` / `invalidate`
/ ttl stay authoritative, and only an **idle** slot runs the body (untracked). Two cases must not
short-circuit: a `stream` slot (a replayable transcript, and the SSR `seedStream` handoff exists
precisely so the client does not re-invoke the source), and a settled slot whose body has not yet been
classified (returning its value there would hand a raw `T` back from an async memo). Both were caught
by the existing suite.

**The second of those is a BREACH of the contract stated above, not merely a guard.** The
classification is evidence produced by RUNNING the body, so a memo whose slot was settled by `publish`
or a hydration `seed` before any body has ever run has no evidence, and its bare read returns a
`Promise` until some key runs cold — a keyed sync memo answering `Promise<3>` where this ADR promises
`3`. It is reachable from a documented surface: `memo.state()` on a sync memo needs no `initial` and
its `set` IS `publish`, so a write-before-first-read hands a template a promise.

The classification is the MEMO's, not the slot's, so one settled key answers for every other — which is
why `startLoad` now classifies from the run it was making anyway, closing the case where a `peek()` was
the first touch (that slot stayed UNCLASSIFIED permanently, and every later bare read returned a
promise, rendering `[object Promise]`). The remaining hole is left OPEN deliberately, because both fixes
are worse than it: running the body to classify is unacceptable when the body is an rpc handler reached
from a hydration seed, and choosing a default the first real run may contradict trades a visible wrong
type for a silent one.

Types follow via a `NotDeferred<T>` exclusion on a new overload, so a promise- or async-iterable-
returning body still resolves to `Memo<Args, T>` and its `Promise<T>` read.

## Rejected: the N-stage pipe

The thunk framing suggests a pipe — `memo(thunk, stage1, stage2, …)`. Stage 1 → 2 is a real boundary
(tracked becomes untracked), but stage 2 → 3 is not: both are untracked, so `memo(t, f, g)` is
exactly `memo(t, v => g(f(v)))`. Composition sugar against a stated goal of a small API surface.

It would only earn its place if stages memoized independently, and the propagation bailout is `===`
(`reactive.ts`), so any interesting stage output — a fresh object, a `.filter()` result — never
compares equal and never bails. Revisit only with a concrete case that wants value equality.
