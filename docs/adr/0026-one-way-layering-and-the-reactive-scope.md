# ADR 0026 — one-way layering and the reactive scope

**Status:** accepted. Closes `docs/TODO.md` #26 ¶1 and ¶2.

## Context

`src/` is split three ways — `server/`, `ui/`, `shared/` — with `shared/` as the bottom layer. The
real dependency graph does not match:

```
shared ← ui ← server        shared→ui: 0    ui→shared: 35
   ↖___________________|    server→ui: 9    shared→server: 8   ← the violation
```

Eight `shared/` modules import *up* into `server/internal/`: `memo.ts` (`registerTaggedMemo`,
`currentScope`, `runOutsideScope`), `route.ts`, `trace.ts`, and the four tag globals
`{invalidate,refresh,pending,refreshing}.ts`. The scar is in the tree: `server/internal/scope.ts`
lazily constructs its `AsyncLocalStorage` behind an `isBrowser` guard *because* a shared module
imports it, so a server-only module contorts itself to survive being loaded in a browser.

Separately, `MemoContext` (`shared/internal/context.ts`) — the ambient object the memo/state
primitive is built on — declares `StreamScope`, `StreamHandleRecord`, `DeferredSubtree`,
`DeferredStreamer`, `StreamFrame`, `states`, and `rendering`. The primitive knows about
`<abide-list>` handoff ids, hydration-seed buckets, and out-of-order patch ops.

Two premises that motivated earlier framings were tested and **rejected**:

1. **This is not a client-bundle change.** Moving files relocates bytes, it does not delete them. A
   fresh `abide build` of `packages/docs` shows `memoChannels.ts` is *already* tree-shaken out
   (`@tag:` absent from all 60 chunks), and `ChannelHub` is in the bundle regardless — via the public
   isomorphic `channel()` primitive, which a browser bundle carries by design. The TODO #6 client
   floor is untouched by this work. Client bundle size is an explicit **non-goal**.
2. **`StreamScope` is not on `MemoContext` out of laziness.** `emitServer` generates `async render()`
   with no ambient parameter, so AOT-emitted code cannot be handed a context. Every per-render fact
   *must* be reachable from a global accessor, and `MemoContext` was the only ambient that existed.

## Decision

### 1. The DAG is one-way, and enforced

`shared` ← `ui` ← `server`. A biome `noRestrictedImports` override forbids `packages/abide/src/shared/**`
from importing `**/server/**`. `**/*.test.ts` is **exempt**: the rule protects the production graph and
the client bundle, and a test is in neither. Three shared tests legitimately construct a request scope
(`shared/memo.test.ts`, `shared/streamShared.test.ts`, `shared/internal/sharedCache.test.ts`) — testing
the server-side behaviour of an isomorphic primitive requires `runInScope`, and there is no second
correct way to do it.

### 2. Admission rule for the ambient object: **lifetime**

> A field may live on the reactive scope only if its lifetime is identical to the scope's.

This is derived from the actual defect — `scope.ts:102` conditioned `disposeContext` on
`context.stream`, i.e. the primitive's teardown branched on a render field. `StreamScope` fails the
rule because a streamed reply outlives the request's synchronous work. `scope`, `route`,
`traceparent`, `requestScoped`, `retains` pass.

The rule does not stop accretion in general; what stops that is the object staying small enough to
review. It is preferred over a layering rule ("only what the primitive reads") because the layering
rule has no good home for `rendering` — see *Accepted residues*.

### 3. `memoChannels.ts` and `memoTags.ts` relocate whole

`memoChannels.ts` imports **only** `shared/internal/channelHub.ts` and
`shared/internal/memoChannelName.ts` — zero server dependencies. It is in `server/internal/` by
placement, not by any dependency. Both files move to `shared/internal/` unchanged.

No split, no injected broadcast sink, no registered global, **no behaviour change**. `invalidate({tags})`
still emits its `@tag:<tag>` frame from either side. The `@tag:` channel has no in-repo subscriber
(client bare-tag subscription is parked, TODO #4) but is retained as protocol surface for third-party
clients — the same call already made for `wsUnsubscribe` in TODO #25.

### 4. Fail-closed becomes structural; `runOutsideScope` is deleted

The scope `AsyncLocalStorage` **stays private to `server/`**. `runInScope` already gives the scope and
the context the same `slots` Map (`scope.ts:89`), so:

```ts
export function currentScope(): RequestScope | undefined {
    const scope = scopeStorage.getStore()
    if (scope === undefined) return undefined      // short-circuits: no reactiveScope(), no lazy create
    return scope.slots === reactiveScope().slots ? scope : undefined
}
```

`runOutsideContext` swaps the active scope; the slot maps no longer match; `currentScope()` returns
`undefined`; `identity()`/`cookies()`/`request()`/`context()` throw. The `shared`-memo fail-closed
guarantee (rpc-core §2) stops being maintained by entering and exiting two things in lockstep and
becomes structural. `memo.ts` calls the shared `runOutsideContext` directly.

**Rejected: collapsing the scope ALS into the reactive scope.** It would delete an ALS, but it moves
scope *entry* from a module-private `runInScope` call — greppable, async-confined, self-unsetting — to
a field write on an object any layer can obtain, which persists for the scope's lifetime and is
reachable from app code (the export map is a wildcard). For the carrier that holds `identity`, losing
entry confinement is the wrong trade. Keeping two ALSs is a cost in concept count, not correctness.

### 5. `requestScoped` collapses four predicates

Memo's three sites become `reactiveScope().requestScoped`, set only by `runInScope`:

| Site | Today |
| --- | --- |
| `memo.ts:468` | `shared && currentScope() === undefined` |
| `memo.ts:700` | `!isBrowser && currentScope() !== undefined` |
| `memo.ts:1195` | `!shared && !isBrowser && currentScope() !== undefined` |

Because the flag is only ever set server-side, the two `!isBrowser` guards become redundant and are
deleted, and three `AsyncLocalStorage.getStore()` calls in memo's hot path become property reads on an
object memo already holds.

**`serverRuntime.ts:39` is NOT the fourth spelling of this predicate** — an earlier draft of this ADR
said it was, and the change failed against `serverEffectScope.test.ts`. `getContext() !==
serverDefaultContext()` asks *"is this context disposable?"*, which is true of any non-default context
including one a caller builds and hands to `runInContext` directly. `requestScoped` asks the narrower
*"did `runInScope` build this?"*. They coincide in production and diverge for a hand-built context, and
the broader question is the correct one at that site. It stays as it is.

The converse holds for memo, which is why it cannot use `serverDefaultContext()` either: on the client
that returns `undefined` while `getContext()` returns the tab singleton, so the comparison would be
`true` and memo would register per-request disposers in the browser — exactly what the deleted
`!isBrowser` guards were preventing. `route` and `traceparent` move onto the scope for the same reason —
`route.ts` and `trace.ts` are the only shared consumers and they read nothing else.

Nothing in `shared/` reads `request`, `cookies`, `identity`, `bag`, or `server`. `RequestScope` keeps
those five Bun/HTTP fields and stays in `server/`.

### 6. Render state is owned by `ui/`, keyed by a `WeakMap`

`ui/internal/renderState.ts` owns `StreamScope` and its four interfaces, renamed to drop the
misleading "Scope" (it is a per-render work queue, not an extent):

```ts
const RENDER = new WeakMap<ReactiveScope, RenderState>()
export const renderState = () => RENDER.get(reactiveScope())
```

`ui → shared` and `server → ui` are both established directions. The entry dies with the scope. No
second `AsyncLocalStorage`. `states` moves here too — its only writer is
`server/internal/pages.ts:85` and its only reader `:291`; `shared/state.ts` never touches it.

D also ships `withoutRenderScope(fn)` and migrates `packages/docs/src/server/rpc/benchFrontend.ts`,
which today save/restores `context.stream` by hand.

### 7. Disposal is a retain/release refcount

`runInScope` can no longer read `context.stream` to decide whether to dispose, and should not learn to
ask `ui/` instead — that relocates the coupling rather than removing it.

```ts
retainScope(scope)    // +1
releaseScope(scope)   // -1; disposes at 0
```

`runInScope` releases when its synchronous work ends; the streaming drain retains before returning the
`ReadableStream` and releases in a `finally`. The primitive stops knowing what a stream *is* — it knows
only that someone still needs the scope, which generalises to the next thing that outlives a request.

An unmatched retain is a silent leak (a never-disposed scope keeps effect subscriptions live on
module-level `state`), so dev mode logs a retained-scope warning.

### 8. `MemoContext` → `ReactiveScope`

The name is wrong on both halves. "Memo" was accurate when it held only `slots`; it now holds six
things and one is memo's. "Context" collides with the public `context()` accessor, which returns
`scope.bag` — a collision `server/context.ts:1-3` already carries an apology for. And by the rule below
it is not a context at all: it is entered, exited, nested, and disposed. That is an extent.

> **Scope** = a region of execution you enter and leave; registrations die with it.
> **Context** = ambient facts readable at a point, with no lifecycle.
> **Bindings** = a compile-time name→meaning map.

`MemoContext` → `ReactiveScope`, `getContext()` → `reactiveScope()`. Renamed in D, not A: A leaves the
object still holding `stream`, so a name chosen then would describe something about to change.

`CLAUDE.md` needs no edit — its three "ambient" mentions (`:80`, `:152`, `:322`) all refer to *request*
scope, and `MemoContext` is never named there. `ReactiveScope` was preferred over `Ambient` partly for
that reason.

**Not renamed here:** the compile-time family (`CellScope`, `ShadowScope`, `analyzeScope`,
`buildPageScope`, the emitted `$scope`). It is a correct use of the JS meaning, it has zero overlap with
this work, and it lives behind the emit byte-parity oracle. Filed as a TODO with the rule attached.

## Accepted residues

- **`rendering` stays on the reactive scope.** Written by `pages.ts:155`, read by `shared/channel.ts:45`
  (the socket SSR snapshot-then-complete rule). It is a boolean phase flag with the scope's exact
  lifetime, so it passes the admission rule — but it is a render fact read by a primitive, which is the
  original complaint in miniature. Every alternative costs more: moving it to `ui/` creates a fresh
  wrong-direction import, and inverting `channel.ts:45` is unscoped work on the socket path.
- **`memo({ shared: true })` is server-only** (`memo.ts:408`: `opts?.shared === true && !isBrowser`).
  After this ADR that is a *behaviour* asymmetry, not a layering one — `shared/memo.ts` imports nothing
  from `server/`, and `sharedCache.ts`'s only import is `positiveEnvBytes`. It is the stated isomorphism
  principle ("same callable, same name, same intent, side-appropriate behaviour"), the same shape as
  `state.shared` degrading on the server and `trace()` returning `undefined` in the browser. Extracting
  it would need a pluggable store strategy — polymorphism in memo's hottest path, and it would not even
  partition cleanly, since `boundedStore` covers the shared store *and* the server default context.
- **The export map is a wildcard** (`"./shared/*": "./src/shared/*.ts"`), so `internal/` is convention,
  not a boundary — which is how `benchFrontend.ts` reached `getContext`. Tightening it is a public-API
  change with its own blast radius. Filed as a TODO, not folded in.

## Build order

| PR | Content | Gate |
| --- | --- | --- |
| **A1** | `memoChannels.ts` + `memoTags.ts` → `shared/internal/`. Pure relocation | unit + tsc + lint |
| **A2** | `route`/`traceparent`/`requestScoped` onto the scope; slots-identity `currentScope`; delete `runOutsideScope` + the lazy-ALS apparatus; collapse the four predicates | **fail-closed matrix (written first)** + unit + `abide check packages/docs` + docs e2e |
| **A3** | biome `noRestrictedImports`, tests exempt | lint |
| **D1** | render state → `ui/` `WeakMap`; `withoutRenderScope`; migrate `benchFrontend.ts`; retain/release replaces the `context.stream` disposal branch | **disposal accounting (written first)** + unit + `abide check` + **serial** docs e2e |
| **D2** | the renames | unit + tsc + lint + docs e2e |

A1 is provably inert; A2 carries the security-critical rewiring — separate commits so a bisect can tell
them apart. D2 last so the 79-site rename is never mixed with semantics.

### Gates in detail

**A2 — adversarial fail-closed matrix, written before the change.** A shared read: inside a request
(passes), outside any request (throws), inside `runOutsideContext` (throws). A nested non-shared memo
inside a shared handler lands in the default context, not the request's Map. A shared handler touching
`identity()`/`cookies()`/`request()`/`context()` — all four throw. Plus a dev-mode assertion in
`runInScope` that `scope.slots === reactiveScope().slots` immediately after entry: the whole guarantee
now rests on that identity, and today it is maintained by a comment.

**D1 — disposal accounting, written before the change.** Exactly-once disposal for a buffered reply;
exactly-once *and after the drain completes* for a streamed one; a deliberately-unmatched retain
produces the dev warning.

**Both — the docs Playwright lane is the real gate**, not `bun test`. The emit oracle proves emitted
bytes and cannot prove the seed's bucket ordering survived; `states` moving in D1 is exactly the class
of bug that has shipped green before. Run it **serially** (`bun run e2e:ci`) — a concurrent second suite
fakes 1–3 failures per run, and D1 is the change where a flake reads as a streaming break and vice versa.

**Performance claims must be measured or struck.** Two are made above (memo's hot path loses three ALS
lookups; the render `WeakMap` avoids a second ALS). `packages/bench` settles them; unverified, they come
out of the ADR.
