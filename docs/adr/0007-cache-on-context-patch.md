# ADR-0007: cache.on gains context.patch — fold server-pushed deltas without refetching

**Status:** reverted (2026-06-26) — `context.patch` was removed alongside `cache.patch` (see ADR-0009): both were undocumented orphan surface, pulled pending a fuller revisit of the patch/fold story. `cache.on`'s `invalidate` + reconnect coverage remain. This record is retained for that revisit. Originally accepted (2026-06-13).

## Context

The cache is drop-and-refetch: `cache.invalidate` removes an entry's claim to
freshness and the next read re-invokes the source. Value always originates from
the producer/remote, never from a caller-supplied write (ADR-0001). Under
`cache.on`, the idiom is `(frame, ctx) => ctx.invalidate(fn)` — every broadcast
drops the entry and the next read refetches.

That refetch is wasteful when (a) the cached value is a large structure and
(b) the broadcast frame already carries the change. The consuming app that
motivated this was refetching a whole structure on every broadcast of a
one-field delta. ADR-0006 named `cache.on` (not `cache.invalidate.on`)
precisely for this future: "a prime/set verb would join `context` and the gap
recovery already generalizes — invalidation is the universal conservative
fallback for any missed cache write."

This ADR is about **server-authoritative deltas pushed over a live
subscription** — not optimistic updates. Optimistic updates are a different
temporality (the client predicts a value during an in-flight mutation, then
confirms or rolls back); conflating the two would put two reconciliation
policies on one verb. Optimistic updates are left unbuilt (see Consequences).

Granularity comes first. If the structure partitions, the existing grammar
already does surgical refetch: `ctx.invalidate(getItem, { id: frame.id })`
drops one key (per-call selectors, ADR-0006) and refetches one item, with no
new API, no client-side merge, and single-source-of-truth fully intact. The
monolith-refetch pain is usually "we keyed one big structure instead of N
small ones." `patch` is the escalation for when the structure genuinely won't
partition, or when the frame already hands you the delta and even a one-item
round-trip is pure waste.

Shapes considered and rejected:

- **A global `cache.patch` with rollback** — that is the optimistic-update
  problem (client prediction, bounded in-flight window, rollback on reject), a
  different temporality from an authoritative broadcast. Folding both onto one
  verb forces a reconciliation-policy flag. Deferred to its own design.
- **Clobbering `entry.promise` with the patched value** — raw and decoded
  readers share one entry (same method+url key); the promise resolves to a
  `Response`. Writing a decoded object onto it hands `fn.raw()` readers an
  object where they expect a `Response`. `patch` writes `entry.value` only.
- **A synchronous `patch`** — `entry.value` is populated only at hydration
  (ADR: warm SSR snapshot); a live-fetched entry decodes its `Response`
  per-read and stores nothing. So reading the *current* value of a
  not-yet-warmed entry requires an async decode. `patch` returns a Promise;
  hydrated (and already-patched) entries resolve effectively immediately.
- **Mutation-result-as-truth** (feed a POST response into a query entry) —
  shape mismatch between the write's response and the query's value; a
  separate feature, not delta-folding.
- **A per-wrap `patch` option** — same objections as ADR-0006's per-wrap
  rejection: options attach at wrap time, can't see the frame, and one wrap
  can't fan one subscription out to many functions.
- **Recommending fetch-then-invalidate inside the handler** — defeats the
  bandwidth goal, reintroduces a round-trip into the serialized delivery
  pipeline, and swallows fetch errors (see below).

## Decision

`cache.on`'s `context` gains `patch`, a sibling to `invalidate`:

```ts
ctx.patch(selector, (current) => next, args?)  // → Promise<string[]> (touched keys)
```

**Write semantics.** For each decoded remote entry matching the selector
(producers — no `request` — and the raw view are skipped; patching is a
decoded-value operation), `patch` resolves the current value, applies
`updater`, and writes the result to `entry.value` only, then pings lifecycle
so readers re-run and serve the new value on the warm-sync read path. It does
not touch `entry.promise` (raw readers of the same key keep reading the wire
`Response`), does not refetch, and has no rollback — the broadcast is the
authority.

**Sourcing `current`.** Prefer `entry.value` (hydrated or previously patched →
synchronous); fall back to decoding the settled `Response`
(`decodeResponse(response.clone())` → async, hence the Promise return). After
the first patch, `value` is set, so subsequent patches on the same key are
synchronous. **Await `patch` in the handler:** delivery is sequential (ADR-0006),
so awaiting keeps deltas applied in broadcast order.

**Reconnect.** `patch` registers the *selector* (not the delta) into the
binding's coverage set as an `invalidate` replay. A delta can't be replayed
once discarded, so on `SocketDisconnectedError` the patched keys resync by full
refetch — reusing ADR-0006's coverage machinery unchanged. This bounds
client↔server drift to a single connected, gapless session; within that
session delivery is ordered and complete, which is exactly the regime where
applying deltas is sound.

**Handler discipline (documented, not enforced).** A handler should be either
synchronous frame→`patch` (the frame carries the delta) or `ctx.invalidate`
(let the read path refetch, with proper error/`refreshing` states). Fetching
inside the handler is legitimate only for a *small* frame-keyed delta endpoint,
awaited, passing `ctx.signal`. The four ways fetch-in-handler misfires:

1. `await cache(fn)()` returns the warm cache, not the network — a "data
   changed" handler reading stale data. To refetch, `ctx.invalidate(fn)` first.
2. `await fn.raw()` then `patch` of the whole structure *is* the
   drop-and-refetch cost being avoided — use `ctx.invalidate`, it's simpler and
   equally expensive.
3. A per-frame fetch puts a round-trip inside the serialized pipeline (frame
   N+1 waits on N's handler); a fast stream + slow fetch grows an unbounded
   queue. Pure frame→`patch` never stalls.
4. A handler fetch failure is caught and logged (binding survives) but the
   frame's update is silently lost until the next disconnect resyncs.
   `ctx.invalidate` defers the fetch to the read path, where failure surfaces
   to the reader.

## Consequences

- Large SSR-seeded structures fold deltas in place with zero refetch; any
  transport gap full-resyncs the patched keys via existing coverage. The
  conservative fallback ADR-0006 anticipated is now realized for cache writes,
  not just invalidations.
- Leaving drop-and-refetch costs a second site that knows the value's shape
  (the `updater`), which must stay congruent with the producer. Surgical
  `invalidate(fn, args)` has no such cost — prefer it whenever the structure
  partitions; reach for `patch` only when it won't or the frame carries the
  delta.
- Raw and patched-decoded reads of one key go briefly inconsistent (raw reads
  the unrefreshed `Response`) until the next `invalidate`. Acceptable: raw is
  the escape hatch; documented at the call site.
- `patch` returns `Promise<string[]>` (touched keys); await for ordering under
  sequential delivery. A patch that matches no live entry is a no-op (nothing
  is reading it; nothing to fold).
- `entry.value` is now written by something other than hydration — its
  `CacheEntry` doc comment must be updated to say so.
- Optimistic updates stay unbuilt. If added, they share this write primitive
  but add a rollback handle and a post-mutation reconcile (invalidate to
  server truth on resolve, rollback on reject), bent only inside the in-flight
  window so the cache is single-source-of-truth at rest. That is its own ADR.
