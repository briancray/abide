# ADR-0003: Registries act, probes report

**Status:** accepted (2026-06-09)

## Context

Using `cache(createPost, { ttl: 0 })` as the mutation idiom (in-flight
coalescing + loading state, nothing retained) surfaced a conflation:
`cache.pending` claimed mutations were "cached", while the probes' machinery
(lifecycle channel + selector scan) wasn't cache-specific at all — the
tail registry has the same shape (entries, coalescing by name, lifecycle).
Alternatives considered and rejected:

- `fn.pending` on the verb-helper callable — can't cover producers (no
  belte-owned object) and fragments the one selector grammar.
- A `dedupe`/`track` rename or split — three names for one registry; the SSR
  snapshot story ("the cache hydrates") is the load-bearing feature and reads
  only as a cache.
- `throttle(fn)` / `debounce(fn)` call wrappers — `throttle` of an async fn
  re-derives `cache` with `ttl` as the window; wrapper composition either
  breaks reactivity (suppressed calls skip `store.subscribe`) or silently
  downgrades a remote to a producer (`'url' in fn` discriminator).
- `observe(fn)` as probe container — platform prior art (MutationObserver et
  al.) primes a callback API, and two booleans don't need a container.

The blessed `ttl: 0` contract also exposed real gaps: the snapshot shipped
DELETE entries (a write re-firing from hydration); invalidate policies could
replay writes via the refetch thunk; policies never attached to hydrated
entries (the first post-hydration invalidate hard-dropped to a pending flash
instead of revalidating stale-in-place); armed policy timers survived
eviction.

## Decision

One invariant: **registries act, probes report, neither does the other's job.**

- `pending()` / `refreshing()` are standalone shared modules spanning both
  registries (cache selectors + Subscribables, via `tailProbeSlot` so
  shared/ never imports browser/). `cache.invalidate` stays attached — its
  sentence is about the cache. `tail.status`/`.error` remain the stream's
  rich view.
- Coalescing is `cache()`'s always-on base; `ttl` is purely retention, and a
  `ttl: 0` entry retains nothing beyond its store's atomic unit: the whole
  request on the server (identical calls during one render coalesce
  deterministically, any method — one render, one effect) and the in-flight
  window on the tab-scoped client store (a kept write there would block every
  future re-submit). Only replayable methods ship in the SSR snapshot
  (`REPLAYABLE_METHODS`, GET-only — DELETE is idempotent but still a write).
- Wrap-time guards: invalidate policy + non-replayable method throws (a policy
  declares "safe to re-run unprompted"); policy + `ttl: 0` throws; throttle +
  debounce throws. Anonymous producers warn once per source (fresh identity
  per call never coalesces; Bun quirk: const-arrow names aren't inferred
  inside `try` blocks, so the heuristic can rarely false-positive there).
- Policies attach on read to entries lacking one (mirroring `tagScope`), so
  hydrated entries revalidate stale-in-place from the first invalidate.
  Eviction clears armed policy timers.
- Hydrated entries adopt the first reading call site's `ttl` (the snapshot
  ships no wrap options): omitted = forever as shipped, ttl > 0 = expiry
  clock starts at that read, ttl: 0 = the warm value completes the hydration
  render and is evicted a macrotask later (same-pass readers all warm-hit, no
  invalidate event, painted DOM stays) so the next read fetches live. First
  reader wins, like policies.
- Tail reconnects with retained value on the typed
  `SocketDisconnectedError` (transport loss only — server `err` frames stay
  terminal): keep the value, flag `refreshing`, re-invoke the iterator; the
  channel's backoff owns the retry (its `connect()` defers to the armed
  backoff timer so consumer re-subscribes can't hammer a down server), and
  retained-tail replay converges `latest` (and replaces a window) — correct
  reconciliation for a latest-wins/window consumer, which is why tail may
  auto-reconnect while raw `for await` keeps the manual contract.
  `refreshing(subscribable)` means reconnect-with-retained-value, never
  merely `open`.

## Consequences

- Breaking: `cache.pending`/`cache.refreshing` are gone — import `pending` /
  `refreshing` from their own paths. DELETE entries no longer snapshot.
  Previously-silent invalid option combinations now throw at wrap time.
- A future probe must be a pure read of registry state; if it needs to trigger
  work, it belongs in a registry. A future registry should expose entries +
  a lifecycle channel and register a prober slot rather than growing a
  parallel probe surface.
- *Amended 2026-06-11:* the cache store's lifecycle channel is scoped by
  selector prefix — `pending(fn)` taps only fn's channel (selectorPrefix /
  keyMatchesPrefix), so an effect probing one fn can't be re-woken by another
  fn's events (the microtask-deferred mark made such cross-wakes loop outside
  Svelte's depth detection). Bare and scope selectors scan many entries and
  stay on the store-wide channel; a producer never cached has no prefix and
  sits store-wide until its first cache resolves one. cache.invalidate also
  carries an always-on tripwire: many same-selector invalidations within one
  macrotask (the loop signature — a spinning loop starves macrotasks) warns
  once with the selector instead of silently pinning the CPU.
- `refreshing` ends on the first post-reconnect event rather than on
  sub-frame flush; for retaining sockets these coincide, and a
  no-retention socket behaves like its own initial load. Revisit only if a
  no-replay subscription needs a bounded gap signal.
