# ADR 0023 — Unify `socket` and `cell` at the *surface*; unify transport as `{fill, egress}`

- **Status:** Accepted (design) — 2026-07-23. **Revised 2026-07-23** after a 4-lens adversarial review
  (thesis / verb-isomorphism / over-unification / sequencing) downgraded the original "socket *is* a
  cell slot" plan to **surface unification** (see "Revision" below).
- **Updates:** `docs/spec/{rpc-core,replayable-streams,client-sockets,sockets}.md`, root `CLAUDE.md` thesis.
- **Deciders:** Brian Cray

## Context

Thesis: "`cell` is the primitive; RPC/socket = cell + transport; `state`/`watch` = the sync face of the
same signal." Half is true in code — `signal` is shared, RPC *is* `cell` + transport, and cache-broadcast
literally *is* a socket (`cacheChannelHub = new SocketHub<CacheFrame>`). But **sockets bypass `cell`**:
`socketHub`/`socketProxy` reimplement the probe vocabulary (3 copies), the fanout buffer (2 — `Subscriber`
vs `ReplayableStream`), the status enum (2), and the RPC surface delegation is hand-copied.

## Concept tree (root → leaf)

**One atom: `signal`** — a source node in the reactive graph (`reactive.ts`). *Every* reactive value in
abide is a `signal`; the three **primitives** differ only in **who owns the write** — nothing deeper.

| primitive | write owner | write verb | fill machinery |
|---|---|---|---|
| `state` — own | the owner (you) | `set` | none — the public face of `signal` |
| `memo` — load | a pulled async fn | `publish` | cache/coalesce + scope |
| `channel` — subscribe | a pushed external stream | `publish` | buffer + fan-out |

- `signal` = internal engine; `state` = its **public "own" face** (adds the `.abide` compiler brand so
  `count = x` rewrites, + `.computed`/`.linked`/`.shared`). `state`'s read/write/peek *are* `signal`'s
  call/`set`/`peek` (`state.ts:53-55`).
- `memo` (**renamed from `cell`**) and `channel` **store their value in a `signal` too** (a `memo` slot IS
  `signal<SlotState>`) — mechanically `state` + a fill machine. Separate primitives because the **fill
  machinery** differs, not the storage (same principle as the surface/storage split below).
- **Two write verbs:** `set` (owner writes — sync, local, can't fail) · `publish` (fill *mediates* —
  append|replace + egress + broadcast). `state.write` retires into `set` (it *is* `signal.set`).

**Two layers.** `state`/`memo`/`channel` are *local* primitives you create anywhere (`state(v)`,
`memo(fn)`, `channel()`). Two of them gain a **server-exposed form** — a named endpoint + transport + auth:

| primitive (local, use anywhere) | server-exposed form |
|---|---|
| `state` | — (owned state is local; `.shared` = cross-tab; server-shared ≈ a shared `memo`) |
| `memo` | **`rpc`** (`GET`/`POST`/…) = memo + HTTP transport + schema · `src/server/rpc/<name>.ts` |
| `channel` | **`socket`** = channel + WS transport + per-subscribe auth · `src/server/sockets/<name>.ts` |

So **`socket` : `channel` :: `rpc` : `memo`.** `socket()` and `src/server/sockets` stay — you *define a
socket* (a named, transported, authorized channel) exactly as `GET` *defines an rpc*. A `socket` **is** a
`channel`; an `rpc` **is** a `memo`. A `channel` is a stateful reactive pub/sub topic (≈ a `ReplaySubject`
/ a `BroadcastChannel` with memory), consumable standalone with no server/WS.

**Refined thesis** (replaces the CLAUDE.md line): *one atom `signal`; three primitives `state`/`memo`/
`channel` (own/load/subscribe); `rpc = memo + transport`, `socket = channel + transport`.* The old "both
are cell + transport" erased the pull/push difference.

**Progressive disclosure (firm requirement).** Each higher-level construct **auto-creates** the lower one, so
no one is forced down a level they didn't ask for. `socket({…})` auto-creates its `channel` (you never touch
`channel()` unless you want custom backing/composition); a `channel()` auto-creates its buffer (you never
touch `signal`/`pipe`); `rpc` auto-creates its `memo`. The low-level primitives (`channel`, `pipe`, `signal`)
are **opt-in for power users**, never a prerequisite. This is the "small API surface, no ceremony" goal — the
common path (`socket`, `GET`/`POST`, `state`) never mentions the substrate.

**Naming alignment (`cache` → `memo`).** "cache" is generic; the primitive is `memo` (memoization = cache
+ coalesce). Rename the memo *config/behavior*: the RPC **`cache:` option → `memo:`** (`memo: false` opts
out; `memo: { ttl, shared, tags }`); the invalidation-broadcast plumbing (`CacheFrame`/`cacheChannel*`/
`CacheNotify`) leans `memo`-named. **Keep `cache`** only for the genuinely-distinct **LRU bounded-eviction
store** (`sharedCache`, `ABIDE_MAX_SHARED_CACHE_SIZE`) — a memo's *storage backend*. The verbs
`invalidate`/`refresh`/`amend`/`peek`/… are **surface** verbs (shared by `memo` *and* `channel`) — neither
"cache" nor "memo"-prefixed (CLAUDE.md's "cache verbs" label → "surface verbs").

> Rename summary at implementation: `cell` → `memo` (`cell.ts` → `memo.ts`); RPC `cache:` opt → `memo:`;
> the pub/sub *primitive* is `channel` (`socket` = its server-exposed form; the WS mux stays "socket").

## `channel` / `socket` signatures & composition

`channel` is a real, standalone primitive; `socket` is a thin authorization+transport shell over one.
Everything is opt-in backing — bare `channel()` is a pure in-memory ring of `tail` length.

```ts
channel<T>(source?: Source<T>, opts?: {   // source = a node | AsyncIterable | ((emit) => teardown). OPTIONAL — see below.
  onPublish?: (msg: T) => void | typeof DROP | Promise<void | typeof DROP>, // egress: OBSERVE (persist/forward); DROP suppresses local broadcast. Does NOT transform.
  replay?:    () => T[] | Promise<T[]>,                             // late-join history from a store (else in-memory tail)
  tail?: number, maxAge?: number,   // maxAge = per-MESSAGE age window. Deliberately NOT `ttl` — that is
                                    // memo's SLOT-staleness knob; different axis, so different name.
}): Channel<T>
// Overload discriminates by shape, no magic: a SOURCE is callable or has Symbol.asyncIterator; OPTS is a
// plain object with neither. So `channel({ tail: 50 })` reads as opts, `channel(otherChannel)` as a source.

socket<T>(channel?: Channel<T>, opts?: {   // channel omitted → socket auto-creates channel({ tail, ttl })
  clientPublish?: false | true | ((msg: T) => T | typeof DROP | Promise<T | typeof DROP>),
    // omitted/false = clients may not publish · true = unmediated · fn = mediated (transform or DROP).
    // Collapses the old `handler`: the mediator IS the permission, so "mediator on a closed path" is
    // unrepresentable. Matches the house `false | true | config` idiom (`memo`, `crossOrigin`, `clients`).
  middleware?,                             // runs at the SUBSCRIBE boundary (see mediation table below)
  clients?, schema?, tail?, maxAge?,       // tail/maxAge are sugar for the auto-created channel; N/A when a channel is passed
}): Socket<T>
```

**Two message paths, kept distinct (this is what makes composition + Redis not loop):**
- `publish(msg)` = *outbound* write → runs `onPublish` (persist/forward), then broadcasts the frame **unless
  `onPublish` returned `DROP`**. `onPublish` is OBSERVE-or-DROP, never transform; `await` gates broadcast on
  the side effect (write-through). The frame broadcast always equals the frame published.
- a `source`'s `emit(msg)` = *inbound* feed → broadcasts **directly**, skipping `onPublish`.

**Transform has two homes, neither is `onPublish`:** server publishes transform at the call site
(`publish(normalize(x))`); client publishes transform in **`socket.clientPublish` (fn form)** — the trust
boundary that sanitizes untrusted input. So `clientPublish(fn)` = **transform + DROP** (untrusted, *ingress*),
`channel.onPublish` = **observe + DROP** (trusted, *egress*) — asymmetric on purpose, and named apart so one
word never means two things. Flow: client publish → `clientPublish(fn)` → `channel.publish` → `onPublish`.

**Mediation boundaries.** An rpc has one boundary; a socket has three. Which mediator runs where:

| boundary | mediator | why |
|---|---|---|
| request (rpc) · **subscribe** (socket) | `middleware` | Response-shaped onion, once per access grant. Sockets already do this for cache channels (`channelAuth` per-subscribe re-auth + args-spoof check); exposing `middleware` lets **user** sockets opt in too — closing a real security asymmetry |
| **publish** (either transport) | `clientPublish` (fn) | fire-and-forget, per message, transform/DROP |
| connection (WS upgrade) | framework-level (CSWSH gate + identity) | not per-socket config |

**No middleware on the publish path** — middleware's contract is `(next) => Response`, and a WS publish has
**no response**; forcing it would mean faking one. Per-message onion is also a perf hazard on a busy channel,
and `clientPublish(fn)` already mediates publishes uniformly across *both* the WS and HTTP faces (both reach
`ingressPublish`). The HTTP publish face additionally traverses global middleware merely *because it is an
HTTP request* — incidental to the transport, not the design.

**Naming:** the primitive stays `channel` (a multicast, retained, subscribable topic — `pipe` would lose
multicast/retention and break `socket:channel :: rpc:memo`). `pipe` is reserved for the composition
*operator* (`pipe(a, b)` / `a.pipe(b)`) — piping is what channels do, not what they are.

**Composition is the default.** `source` accepts any `AsyncIterable`, and `channel`/`memo`/their transported
forms all share the `AsyncIterable` + `publish`/subscribe surface, so they pipe into each other:
`channel({ source: otherChannel })` mirrors/derives; a persisted socket = `socket(channel({ onPublish: persist,
replay }))`; a Redis-fanned socket = `socket(channel({ source: redisSub, onPublish: redisPub-then-drop }))`.

**In-process = transport stripped.** Server-side, a `socket` IS its `channel` (publish/subscribe hit the hub
directly, no WS) exactly as an `rpc` IS its `memo` under SSR (runs in-proc, no HTTP). Transport is only a
boundary-crosser; same-side calls are primitive calls — "isomorphic by default."

## Nodes, edges (`pipe`), and the source/sink grid

**Nodes vs edges.** `signal`/`state`/`memo`/`channel` are **nodes** — each a distinct identity (owned scalar
/ pull-cache / multicast stream), *not* a containment tower. (A `channel` is **not** `pipe(pipe, pipe,
transform)` — that shape always yields a pipe, never a channel's multicast+retention identity.) **`pipe`** is
the one **recursive edge**: `pipe(from, to, transform)` connects any node to any node — the recursion lives in
the *edge*, not the nodes. A `channel` *uses* pipes (as `source`/egress); it is not built *from* them.

**The `state` family = a node + an *optional feeding pipe*** — two independent axes; the transform lives in
the feeding edge, so these are nodes, not pipes:

| | fed by a pipe? | writable? |
|---|---|---|
| `state` | no (owned) | yes |
| `state.linked` | yes (reseeds) | yes (holds until reseed) |
| `state.computed` | yes | no |

**Pipe grid — cardinality picks the flavor** (four, not one):

| | → scalar | → stream |
|---|---|---|
| **scalar →** | **derive** (recompute on change; = `computed`/`linked`) | **emit-on-change** (each change = one message) |
| **stream →** | **fold** (reduce to latest / scan) | **map/filter** (= `channel({ source })`) |

**Sources, sinks, and write semantics.** Every *node* is both a source and a sink; only a bare
`(Async)Iterable` is source-only (no `emit`). What differs is what **writing** means:

| node | write | what writing means |
|---|---|---|
| `signal`/`state` | `set` | **replace** the owned value (permanent until the next write) |
| `memo` | `publish` | **override** the cached value — *provisional*; the `fn` re-fills and wins on `refresh`/`invalidate` |
| `channel` | `publish` | **append** a message (into the tail/history) |
| `(Async)Iterable` | — | source-only |

`pipe(channel → memo)` is **already how abide works**: a cache channel (`cacheChannelHub` =
`SocketHub<CacheFrame>`) carries frames and `applyCacheFrame` writes them into the memo's verbs
(`invalidate`/`refresh`/`amend`→`publish`). **Live cache sync *is* a channel piped into a memo**, with the
memo's `fn` as the reconciling authority — the composition law describes the existing architecture.

**Node-in-constructor = an implicit pipe.** `X(node)` means "`X` fed by `pipe(node → X)`" — flavor from the
cardinality table, write semantics from the sink table:

| you write | means | flavor |
|---|---|---|
| `signal(5)` | owned seed (a *value*, not a pipe) | — |
| `signal(memo)` | signal tracking the memo's value (`undefined` while pending) | **derive** |
| `signal(channel)` | signal holding the channel's latest message | **fold** |
| `channel(memo)` | re-broadcast a memo's value/stream as a topic | **emit-on-change** / fan-out |
| `channel(channel)` | mirror / map / filter | **map** |
| `pipe(channel, memo)` | live cache sync (the cache-broadcast pattern) | **fold** → override |
| `GET(memo)` · `socket(channel)` | the natural server forms | — |
| `socket(signal)` | broadcast a signal's changes over the mux | **emit-on-change** |

Degenerate-but-legal: `memo(signal)` (memoizing an already-sync value) and `memo(memo)` (a redundant second
cache — same desync risk as `memo(myRpc)`). Both type-check *for free* because signals and memos **are**
callable producers. ⚠️ `GET(channel)` works (a channel is an `AsyncIterable`) but re-derives `socket` and, if
memo-wrapped, hits the unbounded-lossless-replay-over-an-eternal-topic footgun — prefer `socket`.

## Option layering & the natural-input ladder

**Which layer owns an option? Ask: does it exist in-process, or only at the wire?**

| layer | options | why |
|---|---|---|
| **node** (in-process behavior) | `ttl` *(memo)*, `maxAge` + `tail` *(channel)*, `shared`, `tags`, `source`, `onPublish`, `replay` | a local `memo` still caches; a local `channel` still keeps a tail |
| **server form** (wire / trust boundary) | `schema`, `clients`, `middleware`, `handler`, `clientPublish`, `crossOrigin`, `timeout`, `maxBodySize` | runtime validation matters only for untrusted wire input; TS covers in-process. Machine surfaces (OpenAPI/MCP) describe the *endpoint* |

So **schema belongs to the server form, retention belongs to the node.** Server forms **flat-merge** their
node's options when auto-creating: `GET(fn, { ttl, shared, timeout, clients, schema })`,
`socket({ tail, clientPublish })` — the caller never needs to know `tail` "belongs to" the channel
(progressive disclosure). No name collisions exist across the two sets today. (`memo: false` remains the
opt-out toggle for skipping memoization entirely.)

**Natural-input ladder** — every primitive's first positional is *its source*; only the push-side ones may
omit it:

| primitive | natural input | required? |
|---|---|---|
| `signal` | any raw value (the seed) | **required** — the owner's first write |
| `memo` | an async **fn** (the producer) | **required** — no memo without a producer |
| `channel` | a **source** (node / iterable / emit-fn) | **optional** — fed at runtime by `publish` |
| `rpc` (`GET`) | an async **fn** (or a memo) | **required** |
| `socket` | a **channel** | **optional** — auto-creates |
| `pipe` | none of its own — its inputs *are* other nodes | `from`/`to` required |

**The rule behind the optionality:** *pull-filled and owned nodes must be given their producer at
construction; push-filled nodes are fed at runtime, so theirs is optional.* That's why `channel` and
`socket` are exactly the two with optional inputs — one axis, not a special case. And the positional slot
**always means source, never buffer** (a channel's buffer is internal; if ever injectable it's a named opt).

**`AsyncIterable` is the streaming currency; the wire format is the transport's `Frame` codec, not a source
property.** An `AsyncIterable` returned as an HTTP stream → **jsonl** (default) / **sse** (opt-in); over the WS
mux → **mux frames**; in-process → stays an `AsyncIterable`. So `GET(() => jsonl(chan))` and `socket(chan)`
both work — the transport puts any iterable on the wire; the *node* decides **retention** (memo replays
losslessly, channel keeps a tail).

## Revision (what the adversarial review changed)

The original decision was **substrate** unification: make a socket *literally* a `cell` slot backed by one
policy-parameterized buffer. Four independent code-grounded reviews refuted that:

Two barriers survived a second (balanced) adversarial round — a substrate advocate, a surface advocate,
and an independent judge who verified each claim against code. These two are **durable**:

- **Fan-out topology is irreducible.** `ReplayableStream` is one shared append-only array walked by
  per-consumer cursors — lossless (`replayableStream.ts:7-8,122-140`); `SocketHub` is a **`Set` of
  per-subscriber bounded FIFOs** that drop-oldest *per consumer* (`socketHub.ts:27,46`, `subscriber.ts:30`).
  Shared-cursor-array vs per-consumer-queue-set is a **data-structure** fork, not a `cap` scalar — no policy
  field merges them, so a "parameterized substrate" god-slot cannot exist.
- **The scope firewall.** A socket needs process-global + scope-free storage — exactly the read `context.ts:6`
  calls "forbidden" (cross-user leak) and `guardSharedRead` (`cell.ts:281`, 6 read sites) fail-closes. A
  `scope:'global'` slot tier is ~2 lines but *inverts that guard's default inside the security-critical read
  path*. `SocketHub` lives outside `slotCache` precisely to keep the firewall un-perforated.

Secondary (real but not load-bearing): eternal-vs-LRU (pinned starves the byte ceiling / evictable kills a
live topic); the `ttl` pun (slot-staleness vs per-message freshness); `watch` "fire on tick" regressing
scalar dedup (a per-cardinality fix both designs need).

**Two round-1 refutations did NOT survive verification and are struck:** "one buffer breaks RPC resume" (the
`{fresh:true}` replace path — `cell.ts:683`→`router.ts:734`→`bootstrap.ts:108`, tested `streamHttp.test.ts:105`
— means a `baseOffset` *could* preserve finite-stream resume; resume is not the barrier) and "delete
`Subscriber` impossible, 3 owners" (`Subscriber` has **2** importers, `socketHub.ts:10` + `socketProxy.ts:13`;
the 3 "owners" own `SocketHub`, not `Subscriber`). The decision stands on the two barriers above, which are
stronger than the claims it originally cited.

## Decision — surface unification

Socket and cell-slot are **two storage strategies implementing one reactive-read surface**, not one thing.
What unifies is the *concept surface*; the storage stays two honest implementations.

### 1. The shared surface (unifies)

A single `ReactiveReadSurface` interface — `peek` · `pending` · `refreshing` · `error` · `chunks` · `done`
· `refresh` · `invalidate` · `publish` · `watch` — implemented by **both**:
- **cell-slot** — scoped (`slotCache`), LRU-bounded, lossless (`ReplayableStream`), pull-filled.
- **socket-hub** — module-global, scope-free, lossy per-consumer (`Subscriber`), push-filled, per-subscribe
  auth. Backed by the hub, **never a `slotCache` entry.**

`socketProxy`/`server/socket.ts` stop hand-rolling probes and *implement this surface* over the hub. The
shared thing is the **signal + vocabulary**, not the buffer. `Subscriber` and `ReplayableStream` both stay.

### 2. One write-verb name: `publish` (subsumes `amend`)

`publish(args, next)` — cardinality-polymorphic: **replace** on a scalar surface, **append** on a stream/
socket surface. `amend` retired as a name (incl. the `CacheFrame.verb` wire value). Updater-form
(`publish(args, cur => next)`) is a scalar-only overload; the server-per-request fail-closed guard
(`cell.ts:728`) is preserved.

### 3. Egress keys on whether the surface has a transport

- **Server-backed surface** (RPC/socket proxy — has an egress transport): client `publish` **must egress**
  (`clientPublish` on, mediated) — without it, **error**.
- **Client-only surface** (bare `cell(fn)`, no transport): `publish` stays **local** — there is no server
  to reach, so it is a local optimistic write, not an error.
- Mediation is a **mutation handler that can transform** the payload before publishing (not middleware —
  middleware can't rewrite-and-continue). Server `publish` is authoritative + broadcasts.

### 4. Verbs isomorphic across the surface — with the axes kept distinct

| verb | scalar (value) | stream (pull) | socket (stream·push) |
|---|---|---|---|
| `peek` | last value (sticky) | last chunk | last msg, **age-windowed** (`maxAge`) |
| `refresh` | re-run `fn`, keep stale | re-run source | re-subscribe **keeping the tail visible until the new sub acks** (never drop-first) |
| `invalidate` | drop→reload on next read | abort source + drop | clear tail + mark re-subscribe (**no source-abort path**; the topic keeps producing) |
| `publish` | replace | — | append |
| `watch` | on value change (**keep dedup**) | on chunk-append (payload = latest chunk) | on message-append |
| `done` | n/a | true on close | **true-when-idle, then false** once live |

**Two distinct knobs, never merged — and now named apart:** `memo.ttl` = **slot** staleness
(`Date.now() - loadedAt >= ttl` → reload/dispose; the standard cache-TTL meaning); `channel.maxAge` =
**per-message** age window (`peek`/tail-replay exclude older messages; never triggers a re-acquire).
Orthogonal axes, so they no longer share a word. **Status** likewise distinguishes *data-lifecycle*
(pending/refreshing-as-revalidating) from *transport-health* (reconnecting) — not collapsed into one enum.

### 5. Transport = `{fill, egress}`; `Frame` is a **discriminated union**

Two capabilities mirroring the surface's read/write. `Frame` is honestly a union — HTTP-stream frames carry
an **encoding tag** (jsonl/sse round-trip on resume); WS frames carry **channel-name + args + control**.
One `Frame → surface` **dispatcher** over that union (not one flat shape — dropping either side's metadata
is the failure mode). **Both auth models preserved:** connect-auth for user sockets; per-subscribe
middleware + args-spoof check (`channelAuth.ts`, security-critical) for cache channels.

### 6. Hydration polymorphic — routed to the right storage

One `snapshot()`/`seed()` over the surface; a socket's SSR handoff seeds through the **hub** (tail-snapshot
→ re-subscribe), a cell-stream through `slotCache`. `seedStream` folds into `seed`.

## Consequences

**Unifies:** the signal (already) · the probe/verb **vocabulary** (retires the 3 probe copies + 2 status
enums *as surface duplication*) · the `publish` name · the `Frame` concept + one dispatcher · `watch` fixed.

**Explicitly NOT unified (kept as two honest strategies) — for the two verified-durable reasons, not
conservatism:** (a) **fan-out topology** — shared-cursor append-only array (`ReplayableStream`) vs a `Set` of
per-consumer bounded FIFOs (`SocketHub` + `Subscriber`), which no policy scalar can merge; (b) the
**`guardSharedRead` cross-user firewall** (`cell.ts:281`) that a scope-free socket slot would perforate. So
`ReplayableStream` (lossless/scoped/LRU) and `Subscriber`+`SocketHub` (lossy/global/scope-free/per-subscribe-
auth) stay separate, as do cell `ttl` vs socket `ttl` and the slot-home. **`Subscriber` is NOT retired.** No
eternal-slot-in-cell. No `ReplayableStream` generalization.

**Follow-on truth-surface edits:** the four specs + the CLAUDE.md thesis (make it true: "cell and socket
share a reactive-read *surface*; storage differs").

**Deferred (out of scope):** echo/reconciliation for an egressing `publish` needs message identity — the
optimism-with-reconcile *feature* is unbuildable until that lands (nothing regresses; today has no optimism).

## Implementation sequence

Trunk-based, small green PRs. The high-risk buffer surgery is **gone** (no `ReplayableStream` rewrite), so
the sequence is materially safer than the original.

1. **`watch` tick-fix** — per-cardinality (keep scalar dedup, add stream/socket append; stream payload =
   latest chunk). Standalone bug PR.
2. **`amend`→`publish` rename** — coordinated across `cell.ts`, `router.ts`, `CacheFrame.verb`,
   `applyCacheFrame`, tests. Green in one monorepo commit; independent.
3. **`Transport` contract naming + `Frame` as a discriminated union** with one `Frame → surface`
   dispatcher. Refactor; no buffer change.
4. **Extract `ReactiveReadSurface`** — the shared probe/verb interface, implemented by the cell slot
   (backed by `slotCache`) as-is. No behavior change; pins the vocabulary. **Encode the per-cardinality
   semantics in the *typed* contract** (not just the §4 prose) — especially socket `invalidate` = no
   source-abort — so the shared interface can't silently drift into a "uniform-but-lying" type over time.
5. **Author the gate tests the current gate lacks** — a `?__abide_from` resume e2e, a `tail:0` socket, and
   an SSR-painted-socket hydration (`replay:false` join) test. *Before* touching sockets.
6. **Socket implements `ReactiveReadSurface`** — incremental behind the stable `Socket<T>` surface:
   (6a) server `socket.ts` exposes the surface over the hub (move all read paths — `subscribe`/
   `tailSnapshot`/`peekLatest`/`snapshotIterator` — in one commit); (6b) client `socketProxy` implements
   the surface over the hub, retiring its private probes/status. Hub + `Subscriber` stay. Mux frame
   contract is unchanged across 6a↔6b (proven interoperable by review).
7. **Fix the four specs + CLAUDE.md thesis** to describe surface-unification.

**`Subscriber` is not deleted** — it remains the socket/cacheChannel/approval buffer. The original 6c is
removed.
