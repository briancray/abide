# abide — Client Sockets (Spec, Slice 3b)

Status: IMPLEMENTED (initial slice, 2026-07-20), derived from the same-day design interview. Two
knobs are deferred from v1 — see Deferred/parked (client-side `validate`, refcounted unsub).
Scope: the **browser half** of `socket(...)` — the client `Socket<T>` proxy, its module-swap,
the reactive probe surface, and the SSR→hydrate handoff. Builds on `docs/spec/sockets.md`
(S-refs: the server hub, transport, auth), `docs/spec/rpc-core.md` (the RPC module-swap this
mirrors), `docs/spec/promise-read-model.md` (the cell-probe vocabulary), and
`docs/spec/abide-compiler.md` (C-refs: emit/bundle). `docs/spec/sockets.md` §S4.1 promised the
browser an "isomorphic `Socket<T>` over the WS mux"; this slice defines it.

Through-line: **the same import, the same name, the same surface — `for await` + `publish` +
the cell-probe vocabulary — on both sides.** A `.abide` reads `server/sockets/<name>.ts`; the
server render gets the real hub, the browser gets a swapped proxy that is byte-for-byte the same
`Socket<T>` TypeScript type. Sockets stay best-effort, at-most-once, no-cursor (S2) — the client
adds no durability the server never had.

---

## CS1. Surface & isomorphism

1. **Identical type both sides — one `.d.ts`.** `Socket<T>` gains a reactive surface that the
   server implements trivially and the browser proxy implements over the mux:

   ```ts
   interface Socket<T> extends AsyncIterable<T> {
     publish(message: T): void          // fire-and-forget, void, both sides (S1.3, CS3)
     peek(): T | undefined              // ACTIVE · reactive latest, ttl-windowed (CS4.2)
     chunks(): T[] | undefined          // ACTIVE · messages seen this session, capped (CS4.3)
     pending(): boolean                 // STATUS · connecting, never yet subscribed (CS4.1)
     refreshing(): boolean              // STATUS · dropped, reconnecting (CS4.1, CS2.4)
     done(): boolean                    // STATUS · not subscribed / torn down (CS4.1)
     error(): unknown | undefined       // STATUS · terminal, non-retryable refusal (CS4.1)
     readonly __socket: SocketInternals<T>
   }
   ```

   Probes are **zero-arg** (a socket is one topic, not an args-keyed cell — contrast the RPC
   read's `fn.peek(args)`).
2. **Module-swap, parallel to the RPC proxy (rpc-core §6).** On the server a `.abide` imports the
   real `Socket` (in-proc hub). At build the bundler swaps a `server/sockets/*` import for a
   synthesized **client proxy** speaking the same surface over the WS mux. Keyed on **import
   provenance** (the specifier resolves into `src/server/sockets/`), not runtime value shape — the
   client bundle can't execute the server module to see it's a `Socket`. Matched against the known
   socket registry exactly as RPC locals are matched against the rpc registry (C-ref
   `clientBundle`).
3. **`socketSpecs` (CS7)** ships one entry per browser-reachable socket; `makeClientSocketImports`
   builds one proxy per name, read off `$scope` by the emitted mount — same instance the seed and
   the template share, so a reference never re-creates a subscription.

## CS2. Transport & framing (extends S3)

1. **The WS mux, reused (S3.1).** One lazily-opened WebSocket per tab (`/__abide/sockets`),
   shared with cache-invalidation channels and other user sockets. No per-socket connection.
2. **Frames (upstream):**
   - `{t:"sub", name, replay}` — subscribe. `replay` (default `true`) requests the server tail
     replay; `replay:false` is the hydration join (CS5.2).
   - `{t:"unsub", name}` — last active reader left (CS3.1).
   - `{t:"pub", name, msg}` — client publish (CS3.4), fire-and-forget.
3. **Frames (downstream) — user sockets leave silent-deny (contrast S4/cache channels):**
   - `{name, msg}` — a data message (fanned to every local subscriber, CS3.2).
   - `{name, ok:true}` — **sub-ack** (or the first data frame / a tail-replay-complete marker);
     clears `pending()`.
   - `{name, error}` — **sub-error**: a non-retryable subscribe refusal; sets terminal `error()`.

   Cache channels keep silent-deny (their TTL self-heals, shared-cache-plan §2.5); user sockets
   have **no TTL backstop**, so a silently-failed subscribe must be observable — hence acks/errs.
4. **Reconnect (upgrades S2.4 for the client).** On WS `close`/`error` with an **abnormal** code
   (e.g. 1006): reconnect with backoff and **re-send `{t:"sub"}` for every socket with ≥1 live
   active reader** (CS3). A **policy** close (e.g. 1008 / 4401) or a `{name,error}` is terminal →
   stop reconnecting that socket → `error()`. Reconnect gets whatever the server tail replays
   (S2.1); messages that aged out of the window during the gap are lost — best-effort, at-most-once,
   **no gap-free cursor** (S2.5). Reconnect logic is **shared** with the cache mux, so cache
   channels are resubscribed too (strictly fewer missed invalidations).

## CS3. Fan-out, subscriber model, publish

1. **Refcounted single WS-sub per name.** The proxy keeps a `Set` of local subscribers. The
   **first** active reader (CS4) sends `{t:"sub"}`; each `[Symbol.asyncIterator]()` mints a new
   local subscriber (its own bounded FIFO + waiter); the **last** to leave sends `{t:"unsub"}` and
   drops the subscription.
2. **Local fan-out.** An inbound `{name, msg}` is pushed to every local subscriber. The server
   replays the tail **once** on the first `{t:"sub"}`; a **late** local consumer (a second
   `{#for await}` that starts after those frames arrived) gets **live-only** — no local tail
   replay. "You subscribed late" is the honest distributed semantics (already true across tabs).
3. **Shared `Subscriber` FIFO.** The server hub's `Subscriber` class (bounded queue, single
   waiter, drop-oldest at `1024`) is lifted to `lib/shared/internal/` and reused **both sides** —
   one FIFO implementation, isomorphic overflow behavior (S2.4).
4. **`publish(message: T): void` — fire-and-forget, both sides (S1.3).**
   - Client: a bare `{t:"pub"}` frame, **no** `{t:"sub"}` required — a publish-only component
     opens no subscription (`done()===true`, CS4.1).
   - **Reconnect-buffered:** a publish issued while the WS is mid-reconnect (CS2.4) is queued in
     the same `pending[]` flush queue as subscribe frames and flushed on reopen.
   - **No client-visible ack/rejection.** Server-side `handler` reject is a silent drop (S1.3-B).
     A flow that needs "was my message accepted?" is an **RPC mutation** (typed errors, a response
     body), not a socket publish.
   - `clientPublish:false` (CS6) → the proxy **throws synchronously** (a local programmer error,
     better than the server's silent 403-drop).

## CS4. Probe state machine (extends the promise-read-model vocabulary)

Per-socket-name reactive lifecycle over the shared subscription:

```
pending ──sub-ack──▶ live ──drop(abnormal)──▶ refreshing ──reopen──▶ live
   │                  │                                                 │
   └──sub-error/policy-close──▶ error(terminal)      last-active-reader-leaves──▶ done
```

1. **Active vs status probes.**
   - **Active — drive/refcount the subscription:** `[Symbol.asyncIterator]`, `peek()`, `chunks()`.
     Reading any registers the caller as a consumer (CS3.1) and, if first, subscribes. Mirrors
     rpc-core: `fn.peek` subscribes + kicks the load.
   - **Status — observe only, never subscribe:** `pending()`, `refreshing()`, `done()`, `error()`.
     A component rendering only `{#if chat.pending()}…{/if}` (no iterate/`peek`/`chunks`) sees
     `done()===true` — correct, nobody is subscribed.
   - `error()` is **terminal-only** (CS2.4): transient drops are `refreshing()`, not `error()`.
     Clean three-way split — `refreshing` = recoverable, `error` = gave up, `done` = intentional.
2. **`peek(): T | undefined` — reactive latest, `ttl`-windowed.** Server: the hub's `last`
   `{message,time}` slot (updated on every publish, **independent of `tail`** so a `tail:0` socket
   still has a `peek`), returning `undefined` once `now - time > ttl`. Client: the last received
   message, windowed **lazily** on read against the shipped `ttl` (CS7) — no timer; a static view
   may show a stale value until the next reactive tick. `ttl:∞` (default) → sticky.
3. **`chunks(): T[] | undefined` — this session's messages, capped.** Everything received while
   subscribed, **capped at the socket's `tail` size** (or `1024` when `tail` is `0`/unset),
   drop-oldest — the same bound as the FIFO everywhere else (S2.4). A UI needing true full history
   uses an RPC, not `chunks()`.

## CS5. SSR & hydration handoff (extends streaming-ssr-plan)

1. **SSR: tail-snapshot-then-complete.** A socket never closes, so a naive SSR `{#for await m of
   chat}` would block on live messages and hang the flush. Inside an SSR render the socket's
   server-side iterator is **context-sensitive**: it yields `hub.tailSnapshot()` (the in-window
   tail, S2.2) and then **completes** instead of registering a live `Subscriber`. So under SSR
   `chunks()` = the rendered snapshot, `peek()` = its last entry, `done()===true` post-render,
   `pending()/refreshing()===false`. `tail:0` → renders nothing, goes live on the client. Outside
   an SSR render (RPC handler, background task, socket `handler`) iteration is the real live
   subscription — the same ambient-scope discrimination as the other request-scoped accessors.
2. **Hydrate: re-subscribe `replay:false`** *(design; deferred in v1 — see Deferred/parked)*. The
   intended handoff: a socket whose `{#for await}` the SERVER painted re-subscribes with
   `{t:"sub", name, replay:false}` — **SSR owns the backlog**, **the live subscription owns everything
   from its join point forward**. No count-skip, no double-render, immune to tail-window drift (a
   count-based skip would misalign when a message ages out or a new one lands in the gap — and sockets
   have no message identity to skip by, S2.5). The transport (`subscribe(replay)` + the mux `replay`
   flag) is BUILT; what's deferred is the per-consumption signal telling the proxy *this* iteration was
   SSR-painted. **v1 behavior:** every client subscribe uses `replay:true` (get the tail) — correct for
   a client-only subscription (a `bind:element` iterator, a soft-nav mount — SSR painted nothing there)
   and for reconnect; a template `{#for await}` over a socket relies on keyed reconciliation to absorb
   the replayed tail instead of `replay:false`.

## CS6. Reachability, auth, publish gating (extends S4)

1. **`clients.browser` default-on.** A bare `socket()` is browser-reachable (isomorphism by
   default). A socket set `clients.browser:false` (internal cache-broadcast channels, the
   dev-reload socket) is **absent from `socketSpecs`**; importing it into a `.abide` UI script is a
   **build error** ("socket X is not browser-reachable"), not a silent runtime failure.
2. **Connect-time auth only (S4.4).** No per-subscribe / per-publish re-authorization for user
   sockets — the WS handshake runs the global chain + origin gate once. Topic-level secrecy is a
   **non-goal**: a browser that can open the mux can subscribe to any browser-reachable socket. A
   sensitive per-identity stream belongs on an **authorized RPC stream** (per-args auth), or is
   parameterized as distinct socket *names* — not gated per-subscribe. (`canSubscribe` remains
   parked, S4 / Deferred.)
3. **`clientPublish` is the sole publish gate (S1.3).** Client-side `validate` (CS7) is the only
   optional client knob — it mirrors the RPC `clients.browser.validate` and is **default off**;
   when on, the proxy validates a publish locally and throws synchronously on a malformed message
   (a local error, distinct from a server-side handler drop). The server `schema`/`handler` stays
   the trust boundary regardless.

## CS7. `socketSpecs` & build wiring (C-ref clientBundle / bootstrap)

1. **`socketSpecs[name] = { clientPublish, validate, tail, ttl }`**, emitted alongside `rpcSpecs`
   for every browser-reachable socket (CS6.1). `bootstrapPage` receives it; `makeClientSocketImports`
   builds the proxies.
   - `clientPublish` — synchronous-throw gate for `.publish()` (CS3.4).
   - `validate` — when `true`, the bundle **also** ships the schema's validator (same plumbing as
     RPC `clients.browser.validate`); when `false`, nothing schema-related ships.
   - `tail` — sizes the `chunks()` cap (CS4.3).
   - `ttl` — the `peek()` lazy window (CS4.2).
2. **Emit swap.** `server/sockets/*` import locals are rewritten to read the proxy off `$scope`,
   parallel to the RPC local rewrite; a non-reachable socket import is the CS6.1 build error.

## Edges

- **Multi-tab: per-tab, independent.** Each tab opens its own mux WS (S3.1), its own subscription,
  its own tail replay / `peek` / `chunks`. **No** cross-tab leader election (contrast
  `state.shared`'s `BroadcastChannel`) — N tabs = N connect-authed subscriptions, the honest and
  simple model.
- **Cross-origin.** The proxy only ever dials its **own** app origin (the mount base, like the RPC
  proxy). `crossOrigin` on the socket relaxes the mux handshake `Origin` check exactly as for RPC
  (S4 / auth.md AU8-CSWSH); the client proxy needs no cross-origin logic of its own.

---

## Deferred / parked

- **`replay:false` hydration handoff (CS5/CS8)** — the transport is built (`subscribe(replay)` + the
  mux `replay` flag), but the proxy has no per-consumption "this iteration was SSR-painted" signal, so
  v1 always subscribes `replay:true`. Wire a socket `{#for await}` into the stream-handoff seed (like
  the RPC-stream mode-A/B handoff) so an SSR-painted socket region joins `replay:false`. Until then a
  template `{#for await}` over a socket leans on keyed reconciliation to avoid double-rendering the tail.
- **Client-side `validate` (CS6)** — NOT in the initial slice. `socketSpecs` ships
  `{ clientPublish, tail, ttl }`; the server `schema`/`handler` is the sole validator. Re-add the
  opt-in `clients.browser.validate` (ship the validator, synchronous throw on a locally-malformed
  publish) as a follow-up.
- **Refcounted unsub (CS3.1)** — the initial slice opens the mux subscription on the first ACTIVE read
  and keeps it for the tab lifetime (matching the RPC cache-channel precedent, which never unsubscribes);
  iterators still fan out and clean up their local `Subscriber` on `return()`. So `done()` reflects
  never-subscribed / terminal-closed, not last-reader-left. Add last-active-reader → `{t:"unsub"}` when
  the reactive-reader lifecycle is trackable.
- **Gap-free reconnect** (per-subscriber seq cursor / `from=<count>` resume) — contradicts the
  best-effort, no-cursor core (S2.5). The resumable transcript is the **RPC stream's**
  affordance (replayable-streams.md), not the socket's.
- **Local tail replay for late in-tab consumers** (CS3.2) — deliberately not done; late = live-only.
- **`canSubscribe` / topic-level subscribe authz** (CS6.2) — parked with S4.
- **Cross-tab subscription sharing** (leader tab holds one WS) — parked; per-tab is the model.
- **Reactive `ttl`-timer for `peek()`** (push `undefined` exactly at expiry) — parked in favor of
  the lazy on-read window (CS4.2); revisit only if a UI needs precise idle-expiry.

## Implementation surface (files)

- `lib/shared/internal/subscriber.ts` — new; the lifted FIFO `Subscriber`, imported both sides.
- `lib/server/socket.ts` — `Socket<T>` gains the probe members; server impls (trivial/degenerate).
- `lib/server/internal/socketHub.ts` — `last` slot for `peek`; the context-sensitive SSR iterator
  (snapshot-then-done).
- `lib/server/internal/router.ts` — sub-ack / sub-error frames; `replay` flag on `wsSubscribe`;
  close-code → transient/terminal mapping.
- `lib/ui/internal/cacheMux.ts` (or a shared mux core) — reconnect + resubscribe, publish frames,
  control-frame handling; **shared** with cache channels.
- `lib/ui/internal/socketProxy.ts` — new; `makeClientSocketImports` + the `Socket<T>` proxy
  (fan-out, probes, state machine).
- `lib/server/internal/clientBundle.ts` + `lib/ui/internal/bootstrap.ts` — `socketSpecs`
  discovery / ship / wire, parallel to `rpcSpecs`.
- `lib/ui/internal/emit*.ts` — `server/sockets/*` import → proxy swap; build-error on non-reachable.
