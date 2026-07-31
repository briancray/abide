# ADR 0024 — `memo` absorbs derivation; `state` keeps only what it owns

- **Status:** Accepted and IMPLEMENTED — 2026-07-25.
- **Amends:** ADR 0023 — specifically its `state` family table (§"Nodes, edges (`pipe`), and the
  source/sink grid", the `state`/`state.linked`/`state.computed` rows) and the line describing `state` as
  carrying `.computed`/`.linked`/`.shared`. Those rows are **superseded** by this ADR; the rest of 0023
  (three primitives, two transport laws, `socket : channel :: rpc : memo`) stands unchanged.
- **Updated on implementation:** root `CLAUDE.md`, `docs/spec/{abide-compiler,promise-read-model,
  rpc-core,replayable-streams}.md`, the `packages/docs` app (~40 call sites + CAPABILITIES). `packages/starter`
  needed no change — it uses neither retired factory.
- **One thing the design did not anticipate.** §Consequences assumed server memo slots are long-lived; a
  non-`shared` slot is per-REQUEST. So an auto-tracked fill created during a request subscribes to whatever
  the body read — often a MODULE-level `state` that outlives it — and without teardown each request would
  leave a dead observer there forever (unbounded memory, O(requests) work per write). The backing now
  registers teardown on its `MemoContext` and the request disposes it (after the drain, for a streamed
  reply). See `shared/internal/context.ts`'s `onContextDispose`/`disposeContext`.
- **§5 refined by contact with the docs app.** "A member access reads the VALUE" is not optional: leaving a
  memo alone before `.` made `{transcript.length}` render the callable's ARITY (`1`). A memo binding is
  cell-parity, so its own surface is not reachable through the binding — which costs nothing, because
  probes belong to RPC/socket callables, and those are imports.
- **Deciders:** Brian Cray

## Context

ADR 0023 established three primitives — `state` (own), `memo` (load), `channel` (subscribe) — and put
`computed` and `linked` on `state` as "a node + an optional feeding pipe", distinguished by writability:

| | fed by a pipe? | writable? |
|---|---|---|
| `state` | no (owned) | yes |
| `state.linked` | yes (reseeds) | yes (holds until reseed) |
| `state.computed` | yes | no |

That table is the thing this ADR replaces. The objection to moving them — that a `linked` cell's local
write must *persist until the next reseed*, whereas a `memo`'s `publish` is *provisional* ("the `fn`
re-fills and wins on `refresh`/`invalidate`") — **dissolves on inspection: those are the same sentence.**
"Provisional until re-fill" and "holds until the next reseed" describe one behaviour. `linked` was never a
distinct mechanism; it was a `memo` you happened to write to.

Once that is seen, `computed` and `linked` collapse into a single question — *do you write it?* — and the
answer is a property of the call site, not of the constructor. Two factories become zero.

## Decision

**Derivation is `memo`'s job. `state` keeps only what it owns.**

```ts
state(initial, transform?)      // the owned cell
state.shared(key, initial)      // owned, cross-instance + cross-tab
// state.computed — DELETED
// state.linked   — DELETED
```

### 1. A memo's dependencies are its declared inputs

Declare none, and they are inferred from the body. This one rule covers all three shapes:

| you write | declared inputs | tracks | is |
|---|---|---|---|
| `memo(() => count * 2)` | none | body reads (`count`) | the old `computed` |
| `memo(({ id }) => fetch(id))` | `args` | args only — the cache key | **today's memo / RPC, unchanged** |
| `memo(() => a, (v) => v + 2)` | source thunk | `a` only; transform runs untracked | the ADR 0023 implicit pipe |

The middle row is why this is safe: an arged `fn` keeps today's args-keyed behaviour exactly, so **RPC is
untouched**. `GET(({ id }) => …)` declares an arg and stays a plain cache slot.

The two-argument form mirrors `watch(source, handler)` precisely, including the mechanism — the
transform runs `untrack`ed, exactly as `watch.ts:27` already runs its handler. Same rule, two primitives.

### 2. Auto-tracking applies to argless **sync** bodies only

The substrate registers reads against `currentObserver` during synchronous execution
(`shared/internal/reactive.ts:57-72`). After the first `await`, the continuation runs on a later microtask
with the observer restored to `null`, so those reads register nothing:

```js
memo(async () => {
  const a = count()      // tracked
  await sleep(10)
  const b = other()      // NOT tracked — silently invisible
  return a + b
})
```

Half-tracked is worse than untracked, so an argless **async** body keeps today's behaviour: the slot
re-fills on `refresh`/`invalidate` only.

### 3. An argless sync memo's bare call returns `T`, not `Promise<T>`

This is not an ergonomic preference — hydration depends on it. `interpolate` sets `textNode.data = ''`
*before* awaiting a thenable (`ui/internal/runtime.ts:509-513`), so a promise-returning read would **blank
the server-rendered text and refill it a microtask later** — a visible flash on every derived value.

This does not leak into RPC: `makeRpc` builds its own callable, `const rpc = ((args) => backing(args)) as
Rpc<Args, T>` (`server/internal/makeRpc.ts:327`), explicitly typed `Promise<T>`. The RPC contract holds
regardless of what the backing memo returns.

Mechanically this is what "`memo` gains a sync mode" means: **a second fill path for the same slot**, not a
second surface. A sync argless `fn` makes the slot computed-backed, so `refresh`/`invalidate`/`watch` all
still work and a dependency change is an ordinary re-fill.

### 4. `.state(args)` is the writable projection — and *only* that

`.state()` does not exist to read a memo; reading is `memo()`, `{...}`, `.peek()` and `await`, which
already have defined blocking behaviour. `.state()` exists to make a memo **writable**:

```js
let draft = memo(() => count * 100).state()
draft = draft + 1        // → draft.set(…) → memo.publish → provisional until re-fill
```

`set` *is* `publish`. That is the whole of the old `linked`.

### 5. `.abide` auto-calls memo-bound identifiers, except in dependency position

> **SUPERSEDED by ADR 0025.** The dependency-position exception below was removed: a `memo`/`watch`
> source is always an argless THUNK, so a bare cell there is an ordinary read. The rest of this ADR
> (§1–4) stands. Kept for the record — the reasoning that follows is exactly what 0025 re-examined,
> and its "compiler-only change with no runtime or type change" claim is what did not hold: the change
> was un-type-checkable under `emitCheck`'s declaration-unwrapping strategy.

A memo-bound identifier reads as a bare identifier, exactly as a cell does today:

```js
const a = memo(() => b + c)
```
```html
<p>{a}</p>          <!-- → a() -->
```

Auto-call erases the node/value distinction, so any API wanting the *node* would otherwise need a thunk —
the wart that forces `watch(() => count, h)` and forced `state.linked(() => count)`. The compiler therefore
**suppresses the rewrite for a bare cell/memo identifier in dependency position**:

```js
watch(count, handler)            // ✓ the node
memo(a, (v) => v + 2)            // ✓ the node
memo(() => a.b.c, (v) => …)      // thunk still needed for an expression
```

This is a compiler-only change with **no runtime or type change** — a cell already *is* `(): T`, which is
what `watch`'s `source: () => T` expects. It fixes the wart in the existing `watch` API, not only in the
new form. `watch(count(), h)` fails loudly (`number` is not `() => T`), so the position-sensitivity cannot
silently mean the wrong thing.

Auto-call applies only where the compiler can see an **argless fn literal** at the declaration.
`memo(someFnRef)` is opaque and does not auto-call — guessing wrong would emit a call with `undefined`
args.

### 6. Blocking is unchanged, and the script is not a graph

`<script>` bodies are inlined verbatim and sequentially into `async function render($scope)`
(`ui/internal/emitSetup.ts:133`), with all markup generation emitted after. So a script-level `await`
blocks **everything below it** — the rest of the script, the component's entire markup, and the SSR response
for that subtree. It is plain JS sequencing, not a dependency graph.

> **CORRECTED by ADR 0031 D6.** This paragraph also claimed a script-level `await` blocks *the client
> mount*. It does not: `render` is `async`, `mount` is not, so the emitted client module fails to parse —
> green in `abide check`, correct on the server, broken in the browser. Top-level `await` in a `<script>`
> becomes a compile error in both lanes.

Markup-level `{#await}` is the parallel form: `awaitStream` kicks the read immediately
(`ui/internal/streamScope.ts:101`) and races it against a **single per-render** deadline
(`streamScope.ts:60`). The first slow block costs one 4ms deadline for the whole page; every later block
returns a placeholder immediately and all the reads run concurrently, streaming patches as they settle.

The rule to teach: **the script is sequential; the graph lives in memos and markup.** `await` in a script
when you want to block; `Promise.all` when you want to block on several at once. The compiler will *not*
silently auto-parallelize independent top-level awaits — it would reorder side effects, change rejection
semantics, and work against "high visibility into the stack for debugging", for a payoff `Promise.all`
already delivers visibly.

## Consequences

**Accepted, deliberately:** zero-arg RPCs become auto-tracked. `GET(() => total())` reading a module-level
`state` will re-fill when that state changes. This is the server-reactive graph the docs app already
demonstrates, but it is a live behaviour change to existing zero-arg RPCs and bites only on the server,
where memo slots are long-lived.

**Loud, not silent:** `fn.length` reports `0` for `(args = {}) => …` and `(...args) => …`, which would
silently reclassify an args-keyed memo as auto-tracked. These must error at construction, in the spirit of
the existing `deriveSchema` `any` warning. The form CLAUDE.md's type derivation relies on —
`({ n = 0 }) => …` — reports `1` and is unaffected.

**Cost:** this is new compiler behaviour, not a rename. Identifier rewriting keyed on memo-boundness,
argless-literal detection, dependency-position suppression, and reactive-component detection
(`emitClient.ts:612`, `runtime.ts:867`) all currently key on cell-ness and must learn memos.

**`memo(source, transform)`'s transform** sees `undefined` only when `source`'s own type includes it —
no special-casing, the signature is just `transform: (v: S) => T`.

## Rejected alternatives

- **`memo(fn)` infers sync mode and returns `T` for any sync `fn`.** Breaks the RPC read contract:
  `GET(() => 'a')` is a real, tested pattern, and `fn(args)` is documented as awaitable `Promise<T>`.
  Superseded by restricting the sync path to *argless* bodies, which RPC never takes.
- **Keeping `computed`/`linked` on `state`.** They are one mechanism, not two, and neither is *owned*
  state — both are fed. Leaving them on `state` keeps a distinction that does not exist.
- **`.state()` as the general memo read**, typed `State<T|undefined> & PromiseLike<State<T>>`. Clever but
  redundant: reading already has three well-defined forms. Narrowing `.state()` to the writable projection
  is strictly smaller.
- **Passing raw nodes as `memo(a, t)` without the compiler suppression.** (Moot under ADR 0025 — the
  source is a thunk, so there is no suppression to omit.) Auto-call reads `a` first, so
  the transform receives a value instead of a node. Either the thunk or the suppression is required; the
  suppression was chosen because it also improves `watch`.
- **Compiler auto-parallelization of independent top-level awaits.** See §6.
