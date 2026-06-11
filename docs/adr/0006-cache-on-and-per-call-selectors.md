# ADR-0006: cache.on owns event-driven invalidation; selectors gain per-call precision

**Status:** accepted (2026-06-11)

## Context

Apps kept hand-rolling "this socket event stales that cached data" as an
`$effect` reading `tail()` with manual edge detection (an `appliedFrame`
guard) and `cache.invalidate` — the pattern that produced a microtask-bound
infinite loop in a consuming app (see the ADR-0003 amendment). The wiring is
framework-shaped: frame consumption semantics, ordering, and transport-gap
recovery should not be re-derived per app.

Shapes considered and rejected:

- **Per-wrap option** `cache(fn, { invalidate: { on, when } })` — a `when`
  closure can't see component state (options attach at wrap time, entries key
  per args), one wrap can't express one socket fanning out to many functions,
  and the subscription lifetime question (which entries hold the socket open?)
  has no good per-wrap answer.
- **Mapper returning selectors** (`(frame) => [fn, args]`) — the tuple is
  ambiguous with an array of two selectors; any return-value grammar is a
  second vocabulary beside the existing imperative API.
- **Overloading `cache.invalidate(source, handler)`** — one callable with two
  temporalities (command vs installed subscription, void vs dispose), and the
  shared selector grammar treats a Subscribable argument as the *subject*
  everywhere else (`pending(socket)` reports about that stream); invalidate
  would flip it to *trigger*.
- **A generic `on(source, handler)`** — auto-reconnect is only safe when the
  consumer's semantics define gap reconciliation (ADR-0003: tail converges
  latest-wins; raw `for await` keeps the manual contract). A generic handler
  has no defined gap story, so belte couldn't own the hard part — apps would
  be back to hand-rolling recovery.
- **Middleware `next` in the handler** — there is no inner continuation to
  call; the handler is terminal.

## Decision

Two pieces, independently useful:

**Per-call selectors.** The selector grammar gains an optional `args` second
parameter on `cache.invalidate`, `pending`, and `refreshing`: `fn + args`
targets exactly that call's entry. The key derives through the same encoders
the read path uses (`keyForRemoteCall` / `producerKey` format, via
`selectorPrefix`), so selector and entry cannot disagree — unlike scope
tags, whose frame↔tag correspondence is an app-owned string convention.
Producers never cached still resolve no key (nothing matches; no identity is
minted for probe-only reads). The probes' scoped lifecycle channels handle
the exact key as a one-entry prefix (the `===` branch of `keyMatchesPrefix`).

**`cache.on(source, handler): dispose`** — event-driven cache maintenance:

- `source` is any `Subscribable` (socket, rpc stream). Bare iteration: live
  frames only (ADR-0004); a frame is an event, nothing is retained, no replay
  seed — edge-triggered by construction, no app-side edge detection.
- Delivery is sequential: frame N+1 is not pulled until N's handler settles.
  Ordering holds; a slow handler queues frames rather than racing itself.
- The handler receives `(frame, context)`. `context.invalidate` is the
  binding-scoped `cache.invalidate` (same grammar); calls through it are
  recorded in the binding's coverage set by function identity, so attribution
  survives awaits. The global `cache.invalidate` works inside a handler but
  is not covered. `context.signal` aborts on dispose (dispose-only — frames
  already received remain valid events; an in-flight handler may finish
  through a reconnect).
- On `SocketDisconnectedError`, frames may have been missed and a missed
  frame is a missed invalidation: the binding re-invalidates its whole
  coverage set, then reopens the source (the channel's backoff owns retry
  timing). Over-invalidating costs a refetch, never correctness.
- A handler throw is logged and the binding lives on; a server error frame or
  clean end is terminal, mirroring tail. No-op on the server (inert dispose):
  bindings attach client-side, where the SSR snapshot seeded the cache.
- Named `cache.on` (not `cache.invalidate.on`) for the frames-carry-data
  future: a prime/set verb would join `context` and the gap recovery already
  generalizes — invalidation is the universal conservative fallback for any
  missed cache write.

## Consequences

- The MediaDetail-class effect (tail + edge guard + invalidate) is deleted
  app code; with the ADR-0003 amendment's scoped probe channels, the loop it
  hosted is structurally impossible.
- Scope-tag invalidation from frames remains convention-tier: prefer
  `invalidate(fn, args)` when the frame identifies a call; reach for static
  scope tags only for genuinely coarse events. Interpolating entity ids into
  tags on both sides is the signal to switch.
- No awaitable "invalidation settled": invalidation is pull-based, so such a
  promise can hang on an unread entry. If sequencing-after-refetch becomes a
  real need, it gets its own design (probe-drain with the unread case
  defined), not a quiet return value.
- `holdWhile` (defer refetch while mutations are in flight) was deliberately
  deferred: it is invalidation policy, not binding machinery, and is equally
  wanted for manual invalidates. The scoped prefix channels provide its drain
  signal when it lands.
- A binding that consumes frames but never invalidates is using the wrong
  tool (`for await` or `tail()`); a dev-mode hint at N frames with zero
  coverage is cheap if this shows up.
