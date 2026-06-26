# ADR-0009: cache.patch — the optimistic write, predict-then-reconcile

**Status:** reverted (2026-06-26) — `cache.patch` shipped but stayed undocumented and undemonstrated (orphan public surface, tests only); the verb was removed pending a fuller revisit. This record is retained as the starting point for that revisit. Originally accepted (2026-06-16).

## Context

ADR-0007 added `context.patch` to fold an authoritative, server-pushed delta
onto a cached value with no refetch, and explicitly deferred optimistic
updates: "the client predicts a value during an in-flight mutation, then
confirms or rolls back" — a different temporality (tentative, with rollback)
that "would put two reconciliation policies on one verb" if merged with the
authoritative fold. It named the gap precisely: optimistic updates "share this
write primitive but add a rollback handle and a post-mutation reconcile."

Two things make building it now correct. First, the cache already coalesces
mutations (`cache(fn, { ttl: 0 })`) and folds deltas (`context.patch`), so the
in-flight UX gap — show the predicted value before the round-trip — is the only
missing piece. Second, reconciliation has a home: a mutation's result is rarely
the same shape as the query it affects (`createItem` returns an item;
`getList` holds a list), so there is no general way to *compare* the prediction
against the call's return. The cache already owns the universal reconciler —
`invalidate` — which re-derives truth from the producer regardless of shape.

## Decision

A global `cache.patch`, sibling to `cache.invalidate` and `cache.on`:

```ts
cache.patch(selector, updater, call, args?)  // → Promise<typeof await call>
```

- **Predict.** Apply `updater` to every matching decoded entry now (the shared
  `foldEntries` core, ADR-0007's write), recording each prior value. The
  reactive read serves the prediction immediately — no await needed.
- **Reconcile on resolve.** The server is the truth, so drop the prediction and
  `invalidate(selector)`. The value refetches authoritatively, **coalesced per
  the read's own invalidate policy** (`cache(fn, { invalidate: { throttle } })`)
  — so a rapid optimistic-write stream refetches at most once per window with no
  knob on `patch` itself; the prediction (still in `entry.value`) bridges the
  policy's stale-while-revalidate gap. Without a policy it is a plain
  drop-and-refetch.
- **Rollback on reject.** Restore each recorded prior value, then re-emit so
  readers revert.
- **Transparent over `call`.** The returned promise resolves to `call`'s value
  (the mutation result — a created id, etc.), rejects with its error, and
  settles only after the cache reflects the reconciled state. An explicit
  `await` reads truth; an ignored call is fire-and-forget. A pre-attached no-op
  `.catch` keeps an un-awaited rejection from surfacing as unhandled while an
  explicit `await` still receives it (both handlers fire).

**`call` is required.** This is the constraint that lets the verb be global
without breaking ADR-0001's "value originates from the producer/remote, never
from a caller-supplied write." A no-call global `cache.patch(sel, updater)`
would be a free-form client-authored write — the API can't tell server-truth
from a fabricated value, degrading a structural invariant to a by-convention
one. Mandating `call` anchors every global patch to a reconciling operation, so
the value's origin stays the server (via the post-resolve invalidate). The
authoritative no-rollback fold stays where it is sound — `context.patch`, inside
a gapless `cache.on` subscription with reconnect coverage.

Shapes considered and rejected:

- **Overloading `context.patch` with an optional `call`** — the authoritative
  fold (no rollback, frame is truth) and the optimistic fold (rollback, call is
  truth) are different temporalities living in different places (a `cache.on`
  frame handler vs. a mutation call site). Inside `cache.on` a `call` arg is
  meaningless; at the call site the no-call form is the origin-breaking write
  above. Two verbs sharing one `foldEntries` engine keeps the temporalities
  legible — and keeps `createItem` from reading as argument #3 of something
  named `patch`.
- **`cache.optimistic` as the name** — the only adjective in a set of verbs
  (`invalidate`, `on`, `patch`). `cache.patch` composes the existing
  `context.patch` vocabulary; `call`-presence is the temporality signal.
- **A `settle` reconcile callback `(current, result) => next`** to fold the
  call's return into the entry with no refetch — defers to the app to bridge the
  shape gap. Rejected for v1: always-invalidate is shape-agnostic, never drifts,
  and inherits the read's invalidate policy for free. A `settle` fold is the
  bandwidth optimization to add only when a response shape *is* the query's
  value and the refetch measurably hurts (mirrors ADR-0007's `invalidate`-first,
  `patch`-when-it-won't-partition discipline).
- **Returning the reconciled query value instead of `call`'s result** — the
  list already lives in the reactive read; returning it duplicates the source
  and discards the id the caller needs. Worse, the authoritative list lands on
  the policy's schedule, so returning it would couple the await to the throttle
  window. The return carries the mutation result; the read carries the value.
- **Layered entry value (base + tentative ops)** for correct concurrent
  optimism on one key — the right model, but a representation change to
  `CacheEntry.value`, not an additive verb.

## Consequences

- Optimistic UX is one call: the prediction paints instantly, the cache reaches
  truth via the policy-aware refetch, and the awaited promise carries the
  mutation result. No client-side merge, no second reconciliation policy.
- **Rollback restores by snapshot, so the contract is single-flight per key:**
  keep one mutation per key in flight (disable the trigger while pending). Two
  overlapping optimistic writes on one key can corrupt each other's rollback
  because `entry.value` is a flat slot, not a layer stack. Restore is guarded —
  it reverts only if `entry.value` still holds exactly the prediction it wrote
  (a refetch or later write that replaced it is newer truth, left intact) — so
  the failure mode is a lost revert under overlap, never a clobbered newer value.
- Concurrent same-key optimism (the layer-stack model) is **deferred** until a
  real case demands it; it is a `CacheEntry` representation change and earns its
  own ADR.
- `foldEntries` is now the shared write core; `context.patch` (authoritative,
  discards the rollback) and `cache.patch` (optimistic, runs it) are the two
  policies over it. No behavior change to `context.patch`.
- Without an invalidate policy on the read, success is a hard drop-and-refetch —
  the prediction vanishes into a brief reload before truth lands. Declaring
  `{ invalidate: { throttle } }` turns that into stale-while-revalidate, the
  prediction bridging the gap. The smoothing lever is the read's policy, not a
  `patch` option.
