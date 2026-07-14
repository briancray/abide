# ADR-0043: `amend` with a value is an isomorphic push-refresh that broadcasts a keyed cache value across clients

**Status:** accepted (2026-07-14)

## Context

`amend` (`shared/amend.ts`, née `patch`) is today a **client-local** optimistic-update / real-time primitive: it mutates the retained value of matching cached read entries in place via an updater `(current: Return) => Return`, reactively and with no network. Its idiomatic real-time use pairs it with a hand-defined socket:

```ts
export const chat = defineSocket('chat', { message: string })   // define a channel
chat.publish(message)                                            // server publishes
on(chat, (m) => getList.amend((l) => [...l, m]))                // each client folds
```

We want the server to be able to push a cache update directly — `getItem.amend({ id: 1 }, item)` on the server should land the new value in every browser reading `getItem({ id: 1 })`, with no hand-defined socket and no per-client refetch.

This is the same server→client reach ADR-0041 gave `invalidate`/`refresh`, but three facts stopped `amend` from getting it for free:

1. **The updater is a closure over per-client state.** `amend(getList, (l) => [...l, m])` ships a function that closes over `l` — the client's *current* value. A closure can't cross the wire, and the server has no `current` to run it against (`materializeRetained` is client-only; the server cache store is request-scoped and empty — ADR-0041 §Context). So the closure form has no server-broadcast meaning.

2. **A closure fold is non-convergent.** `[...l, m]` applied twice, or on a client that missed a frame over the live-only cache pipe (ADR-0041), permanently drifts from server truth — there is no refetch to heal it, unlike `invalidate`/`refresh` which end in an authoritative re-pull.

3. **`amend` carries data, not a selector.** `invalidate`/`refresh` broadcast a selector envelope (`serializeSelector`) that ships *no* data — every client re-pulls through its own auth. Broadcasting a cache *value* ships app data to every subscriber, bypassing per-client authorization.

## Decision

Add a **value overload** to `amend`, constrained to the rpc's own `Return` type, and make *that form* an isomorphic broadcast via the ADR-0041 resolver-slot pattern. The updater form stays client-local.

### 1. Value form, constrained to `Return`

```ts
amend(getItem, { id: 1 }, item)          // keyed rpc: (fn, args, value)
amend(getConfig, config)                 // no-input rpc: (fn, value)
getItem.amend({ id: 1 }, item)           // instance sugar, keyed
getConfig.amend(config)                  // instance sugar, no-input
```

Constraining the broadcast payload to `Return` is what unlocks everything:

- **It rides the rpc's own codec.** A `Return` value is exactly what the rpc already encodes for a normal fetch response. The wire frame is `{ key, encodedReturn }`; the client decodes it through the *same* `decodeResponse` path a fetch takes into `entry.value`. No new serialization surface, no new type risk.
- **It is convergent.** `entry.value = value` is idempotent — applied twice, same state; a dropped frame just leaves a client one revision stale until the next `amend` overwrites cleanly, and reconnect-refresh (ADR-0041) heals it. This is strictly better-behaved over the lossy pipe than a closure fold.
- **The server can produce it.** The server isn't transforming anything — it hands over a finished value it already has (the write result, the inbound event). No `current` needed.

### 2. Side-swap via a resolver slot (the ADR-0041 pattern)

`amend`'s value form routes through a new `amendBroadcastSlot = createResolverSlot(localAmend)`, mirroring `cacheStalenessSlot`:

- **Client entry (`startClient.ts`)** installs the local apply — set `entry.value`, `notify`. Same function as the fallback so local and wire-driven applies can't diverge (the `applyPatch`-by-matcher seam, `cache.ts`).
- **Server entry (`serverEntry.ts`)** installs the broadcaster, imported *only* there so its socket code never enters the client reachability graph (ADR-0041 import discipline).

The **updater form never broadcasts.** Server-side it is inert by construction (no `current`); the broadcaster **throws** on a function payload — "`amend` with an updater is client-local; pass a value to broadcast" — rather than silently no-op, so the mistake is cheap to learn.

### 3. The value form is keyed; the topic is the rpc address

The broadcast form **requires args** (a concrete key) — a value has to target one entry. It publishes on a per-rpc, args-partitioned topic (`__abide/amend/<rpc-key>/<args-hash>`), so fan-out reaches only clients reading that exact call, not every reader of the rpc. Bare-fn and `{tags}` selectors have no single value target and are **not** valid for the value form (they remain valid for the client-local updater form). Tag-addressed staleness stays on the global `__abide/cache` pipe — tags are cross-rpc and have no per-rpc address.

This makes value-`amend` the **push** counterpart to the pull verbs: `invalidate`/`refresh` say "your data is stale, re-pull" (N refetches); `amend(args, value)` says "here is the data" (zero refetches). Three verbs, one address (the rpc key).

### 4. No opt-in — the args-partitioned channel exposes nothing new

The author calling `amend(args, value)` *from the server* is itself the opt-in: broadcasting is an explicit server-side act, not an ambient default, so there is no separate broadcast-safe flag or visibility predicate. And it leaks nothing, because §3's args-partitioned topic delivers the value only to clients **already reading that exact keyed call** — clients that necessarily already fetched `<rpc-key>/<args-hash>` through the rpc's own auth. A pushed value for a key you are already subscribed to exposes no data you were not already cleared to GET. This is why the args-partitioned topic (not a per-rpc-wide blast) is load-bearing for security, not just fan-out: the subscription set *is* the authorized-reader set.

This holds because the rpc's value is a function of its args (the normal case). An rpc that returns *identity-varying content for the same args* (per-user filtering keyed off session rather than args) is already mis-modelled for a single broadcast value — that is a smell in the rpc, not a gap in `amend`, and is out of scope.

### 5. Type shape — the args-collapse

`amend`'s method type keys on `undefined extends Args` — the same discriminant `RemoteCallable.ts:38` uses to decide `fn()` vs `fn(args)`. If you can call `fn()`, you can `fn.amend(value)`; if `fn(args)` requires a key, you `fn.amend(args, value)`:

```ts
& ([Return] extends [AsyncIterable<unknown>]
    ? Record<never, never>
    : undefined extends Args
        ? {
              amend(value: Return): void
              amend(updater: (current: Return) => Return): void
          }
        : {
              amend(args: Args, value: Return): void
              amend(args: Args, updater: (current: Return) => Return): void
              amend(updater: (current: Return) => Return): void   // all variants, client-local
          })
```

The collapse is **required** for `amend` (not cosmetic): the value form is keyed, so a no-input rpc must expose `amend(value)` directly rather than the `amend(undefined, value)` ugliness `RemoteCallable` already went out of its way to kill. It generalizes to **any rpc method carrying a positional payload after the key** — today that is also `watch` (`watch(handler)` / `watch(args, handler)`, RemoteFunction.ts:93-94), which gets the same `undefined extends Args` collapse to drop the spurious `watch(void, handler)` form on no-input rpcs. This is a **type-only tightening for `watch`** — `watch` is client-only reaction sugar (run the rpc as a reactive read, pipe each resolved value to the handler, return a disposer; inert server-side) with no broadcast semantics; only its arity shape is shared with `amend`. The pure `(args?)` selectors (`pending`/`refreshing`/`refresh`/`invalidate`/`peek`/`error`) already treat the key as optional and need no change.

Edge case: a `Return` that is itself a function type makes `amend(x)` ambiguous between value and updater — document `amend(() => theFn)` as the disambiguation.

## Consequences

- `amend` joins `cache`/`invalidate`/`refresh` as an isomorphic verb whose *runtime* is entry-swapped, not its source — the value form broadcasts from the server and applies locally on the client; the updater form is client-local both sides.
- A server write can push the new value to every relevant client with **zero refetches**, complementing the pull-based staleness verbs.
- Value-`amend` fits **per-entity / keyed reads** (`getItem({ id })`); list-aggregate updates (`getList()` → append) still want the client-local updater, since broadcasting a whole list is just a refetch with extra steps. This is the natural domain split, not a limitation.
- No new author-facing opt-in surface: calling `amend(args, value)` from the server *is* the decision, and the args-partitioned channel confines delivery to already-authorized readers of that key.
- Subscription is **dynamic**: a tab subscribes/unsubscribes from `__abide/amend/<rpc-key>/<args-hash>` as keyed reads mount and unmount — deliberately, since the subscription set doubling as the authorized-reader set is what makes the no-opt-in security model hold. This is new churn versus the single static `__abide/cache` subscription (ADR-0041), and accepted for that property.
- New surface: the per-rpc args-partitioned amend topic + its dynamic subscription lifecycle, and the `undefined extends Args` collapse on `amend` (required) and `watch` (type-only tightening).
- Composes with ADR-0041 rather than superseding it: tag staleness stays on the global pipe; the reconnect-refresh convergence rule is reused to heal dropped value frames.

## Implementation phasing

**Phase 1 (done):** the value form is a client-local reality — `amend(fn, args, value)` / `fn.amend(value)` (+ updater form unchanged), the `Return`-constrained overloads, and the `undefined extends Args` collapse on `amend` (required) and `watch` (type-only). A value folds to an updater that ignores `current`, so it reuses the existing `applyAmend` seam. This alone gives a closure-free optimistic set and the type ergonomics; it fires no network and does not yet broadcast.

**Phase 2 (done):** the server→client broadcast. Both capabilities below were built:
`broadcastAmend` (server) publishes the keyed value on `socket:__abide/amend/<key>`, installed as the `amendBroadcastSlot` resolver by `serverEntry` (client installs `applyAmendLocally`); the dispatcher resolves the `__abide/amend/` family to one synthetic subscribe-only entry (`amendFamilyEntry`); and `createAmendReaderHook` (installed into `cacheReaderSocketSlot` by `startClient`) opens/refcounts a per-key subscription driven by the store's reactive-reader edges, folding pushes via `cache.amendByKey` and reconnect-refreshing to reconcile missed frames. Two runtime notes: opening the shared ws channel on first read is non-throwing (a cache read never fails because an optional real-time subscription couldn't open), and the hook resolver is cleared in the `startClient` disposer so it never outlives its client. Follow-up: the pushed value rides the socket's ref-json transport rather than the rpc's output wire plan, so a `Return` carrying `Date`/`Set`/`Map` revives with ref-json fidelity, not the rpc codec's — reconcile if it matters.

The two capabilities this required (kept for the record):

1. **Dynamic reserved-topic families in the socket dispatcher.** Today `resolveEntry` (`createSocketDispatcher.ts`) gates every client `sub` to a *statically-registered* socket (reserved-at-boot or a loadable user module). The args-partitioned topic `__abide/amend/<key>` is per-call and cannot be pre-registered, so the dispatcher must recognize the `__abide/amend/` prefix and resolve the whole family to one synthetic handler, subscribing the ws to the exact per-key Bun topic. The server broadcaster then publishes straight to `socket:__abide/amend/<key>` (subscriber-gated), bypassing a per-key `defineSocket`.
2. **Read-driven subscription lifecycle.** "A mounted reader is already subscribed" requires the smart-read path to open/refcount a per-key amend subscription tied to the reactive scope — subscribe on first reactive keyed read, feed frames to the local apply, dispose (and unsubscribe) on scope teardown, shared across co-readers of the same key. This is the integration seam between the cache read path and the socket layer, and its exact shape (where the subscription is owned, refcount granularity) is the main phase-2 design decision.

The slot side-swap (`amendBroadcastSlot`, server-installed broadcaster vs. client-installed local apply, mirroring `cacheStalenessSlot`) and the `throw`-on-updater-server-side rule are the straightforward parts once (1) and (2) exist.

## Open questions

- **Args-hash canonicalization:** the topic suffix must hash args identically on the server (publish) and client (subscribe) — reuse the existing cache-key derivation (`keyForRemoteCall`) so the amend topic and the cache entry key agree by construction, rather than introducing a second args-hashing path.
