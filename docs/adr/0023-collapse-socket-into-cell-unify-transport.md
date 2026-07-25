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

**REJECTED — a channel buffer as an immutable `signal<ring>`.** Explored, then refuted by a stress-test that
built the prototype and measured it against the real substrate. Rejected on **soundness, not perf** — do not
resurrect:
- **`tail` defaults to 0, and every cache-broadcast channel is `tail: 0`** (`cacheChannels.ts:45` — "cache
  frames are ephemeral"). A ring-sized buffer holds nothing between publishes: measured `[]` vs today's `[42]`
  (`socket.test.ts:21-30`). Breaks the default socket *and* the whole cache-sync substrate.
- **It fuses two deliberately-independent buffers.** `Subscriber`'s capacity is 1024, *independent of `tail`*
  (`subscriber.ts:9,17`). Making delivery capacity *be* `tail` silently drops messages for an **on-time**
  consumer on any synchronous burst — measured `tail:4`/burst 10 → `[7,8,9,10]` vs `1..10`. The `reactive.ts:96`
  dedup that prevents a notification storm is the *same* mechanism that causes this loss.
- **It does not retire `Subscriber`.** A cursor still needs a monotonic seq, a parking slot, and a bounded
  queue. Proof: `socketProxy.ts` *already* keeps an immutable `signal<unknown[]>` for `chunks` **and**
  `localSubs: Set<Subscriber>` — a signal cannot serve the `for await` path. The experiment was already run
  here; the answer was "both."
- Perf was never the objection: `tail ≤ ~100` is a non-issue and the proposal's fanout is *faster*
  (1.10M vs 0.72M msg/s). (Two premises were wrong: JSC's `shift` is not O(n) here; the immutable copy *is*
  O(tail), biting only at `tail ≥ 1000`.)

**Optional salvage (modest):** keep `last`, keep the per-consumer FIFO, and make *only* the late-join replay
ring a `signal<{seq, ring}>` so probes get reactivity for free — roughly what `socketProxy.ts:35-49` already
is. It does **not** retire `Subscriber`, and must never be applied to `cacheChannels.ts:45`.

## Implementation sequence

Trunk-based, small green PRs. The high-risk buffer surgery is **gone** (no `ReplayableStream` rewrite), so
the sequence is materially safer than the original.

**On "gates" — read this before trusting the word.** There is **no CI** in this repo (no `.github/`), and
`scripts/verify.ts` (biome + typecheck + abide-check + `bun test` + Playwright) **runs no benchmark at all**.
The only perf assertions that ever execute are two ratio gates inside the docs e2e suite (`bench.spec.ts`'s
O(n) SSR shape; `nav-perf.spec.ts`). And `bench:delta` — the only A/B harness — covers `run.ts` (frontend
render/mount/update) *exclusively* and **always exits 0**. So every "gate" below means **local discipline**,
not enforcement. Step 0 exists partly to change that.

**Build before the truth surfaces** — `CLAUDE.md`/`docs/spec/*` describe what *is*; this ADR is the home for
what's *decided but unbuilt*. Updating them ahead of the code would just trade false-about-the-past for
false-about-the-future. **But each PR carries its own truth-surface delta**: a step that changes public API
(every rename below) updates the `CLAUDE.md` tables it invalidates *in the same commit*, or the reference doc
is wrong the moment it merges. Deferring all doc work to a final sweep is exactly how drift accumulated
before (it's why `/audit` exists). Step 7 is therefore only the *conceptual* rewrite, not a doc backlog.

0. **Establish the perf baseline — ✅ DONE.** Six of the eight hot paths this ADR touches had *zero*
   measurement (probe reads, stream chunk-push, `watch`, channel fanout, the frame codec, the signal
   substrate — only SSR render was gated), so steps 1/3/4/5/6 could each have landed an unbounded per-probe
   or per-message regression with `verify` green. Now in place:
   - `packages/bench/src/reactiveBenches.ts` — microbenches for all six, wired into `bench:server`.
   - `packages/bench/gate.ts` (`bench:gate`) — a **hardware-neutral ratio gate** now run by `verify`.
     Absolute ns can't gate (machine-specific); ratios between neighbouring benches in one process can —
     the same trick `bench.spec.ts` uses for SSR's O(n) shape. Bounds sit ≈2–2.5× above observed.
   - `bench:delta` extended beyond `run.ts` to the server/primitive corpus and now **exits non-zero** on a
     regression. (It was also *broken*: workspace-local installs aren't hoisted, so the worktree couldn't
     resolve `@happy-dom/global-registrator` — fixed by linking the per-package `node_modules`.)

   Baselines worth knowing: `probe/peek-scalar` **227 ns**; `stream/push-raw` **51 ns/chunk** vs
   `stream/memo-drain` **257 ns/chunk** (the memo's per-chunk hooks cost ~5× the raw push — steps 1 and 3
   **compound** here, so this is the most likely casualty); `codec/jsonl-decode` **306 ns/frame** vs
   **79 ns/frame** to encode (step 3 replaces the expensive side); `watch/stream-baseline` ≈ `memo-drain`,
   empirically confirming `watch` fires **0×** on streams today.
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
5. **Author the gate tests the current gate lacks** — a `?__abide_from` resume e2e, a **burst test** (N
   synchronous publishes with N > `tail` against a *parked* consumer), and an SSR-painted-socket hydration
   (`replay:false` join) test. *Before* touching sockets. (A `tail:0` socket is **already covered** —
   `socket.test.ts:21-30`, `:55-60`; an earlier draft wrongly listed it as missing.)
6. **Socket implements `ReactiveReadSurface`** — incremental behind the stable `Socket<T>` surface:
   (6a) server `socket.ts` exposes the surface over the hub (move all read paths — `subscribe`/
   `tailSnapshot`/`peekLatest`/`snapshotIterator` — in one commit); (6b) client `socketProxy` implements
   the surface over the hub, retiring its private probes/status. Hub + `Subscriber` stay. Mux frame
   contract is unchanged across 6a↔6b (proven interoperable by review).
7. **Thesis rewrite** — the *conceptual* reframe in `CLAUDE.md` + the four specs (`rpc = memo + transport`,
   `socket = channel + transport`, the node/edge model, the composition law). Small by construction, because
   every prior PR already shipped its own doc delta.

**`Subscriber` is not deleted** — it remains the socket/cacheChannel/approval buffer. The original 6c is
removed.

## Exploration — `pipe` as the edge operator (2026-07-24)

**Status: DESIGN ONLY, nothing built.** This refines "Nodes, edges (`pipe`), and the source/sink grid".
An initial pass over-reached (one `pipe` inferring effect-vs-derive from the return type; "functions are
edges, not data"; drop read-only `computed`; always-writable derives; drive/sample via `peek`). A **4-lens
adversarial review** (thesis-drift / ergonomics / soundness / codebase-reality, all grounded in
`reactive.ts`) refuted those, and a follow-up walk-through resolved the rest. What is recorded below is the
**post-review landing**, not the first pass. Nothing here is on the critical path — socket rooms, the
`clientPublish` collapse, and `cache→memo` shipped independently; this feeds step 7's node/edge docs only.

### The model that survives

Three node **identities** — `signal` (owned scalar) / `memo` (keyed cache) / `channel` (retained stream) —
plus **`pipe`, the one edge concept**. `computed`, `linked`, `watch`, `map`, `fold`, and cache-sync all
*are* pipe shapes; documenting them as one edge is a true and useful thesis. But `pipe` is the **engine +
opt-in composition operator**, NOT the mandatory spelling (see "primary vs opt-in").

### Named arms, not return-type inference (the key correction)

The first pass discriminated effect-vs-derive by the transform's **return** (value → lazy node, void →
eager effect). This is **unsound both ways** and the review's central kill:
- **Runtime:** lazy-vs-eager is a construction-time `isEffect` flag (`reactive.ts:39,274,282`), fixed
  *before* the fn runs — you cannot read a return without running, so you can't classify a lazy derive
  without defeating its laziness or firing an effect's side effect.
- **Type:** TS void-assignability means `(v) => number` is assignable to `(v) => void`, so a value-fn
  silently matches the effect overload.

**Resolution — name the arm** (still one operator): `pipe(a, fn)` **derives**; `pipe.effect(a, fn)` (or the
retained `watch`) **runs an effect**; `pipe(a, node)` **forwards** into a sink. The engine is *told* which,
exactly as it is today. This single move dissolves a cluster of findings at once:
- **"functions are edges, not data" is DROPPED — not needed.** A returned function is a *value* in `pipe`
  (function-valued derives work) and a *teardown* in `pipe.effect` — disambiguated by the arm, not a global
  invariant. Keep function-as-node-value (a **tested** capability, `reactive.ts:38` + `reactive.test.ts`);
  no `.of()` escape hatch; the `pipe(mode, m => handlers[m])` footgun (value invoked as teardown,
  `reactive.ts:161`) cannot occur.
- **Read-only `computed` is KEPT.** `computed` = read-only lazy derive; `linked` = writable derive; both are
  named arms. No contradiction with the writable-column table above; write-ownership stays an honest fact.
  (`publish`/`invalidate` semantics on a derive only need defining *if* you opt into the writable arm:
  override-until-next-dep-change; `invalidate` = drop-override + recompute.)
- **The `undefined`/void collision and the `.push`-returns-a-length trap dissolve** — no return is being
  inspected. (Edge-3 "meant an effect, wrote an expression" degrades to a lint, not a language rule.)

### Eagerness = cardinality × arm (fixes the message-loss hole)

The flat "value → lazy" law let a channel-driven derive be classified lazy, where reference-dedup
(`reactive.ts:84`) drops all-but-the-last of a synchronous burst — re-deriving the exact loss the
`signal<ring>` rejection already found. Correct rule, two axes:
- scalar source + derive → **lazy memo**
- stream source + derive → **eager channel** (map/filter — lossless, publishes per message)
- effect arm → **eager**
- returns a branded node → **eager switch** (`switchMap`: forward the inner, tear down the old on change)

Only the scalar-derive corner is lazy; everything with a stream or a side effect is eager.

### The body runs **untracked** (fixes drive/sample)

`peek()` *subscribes* on abide's surface (`memo.ts:515`), so "sample = peek in the body" was a no-op. Fix:
because the deps in `pipe([a,b], fn)` are **explicit**, run the transform inside an implicit `untrack` — the
deps list is then the *complete* driver set, and every read inside the body (bare or `peek`) is a **sample**
(the subscription is suppressed; a memo read still kicks its load and hands back the current value). So
**deps drive, body samples**, uniformly, with no per-read ambiguity and no separate `sample()` primitive.
(Verify: surface `peek` subscribes via the observer stack `untrack` clears, not a side subscriber set —
almost certainly true, `{fn.peek()}` re-render wiring.)

### Async correctness = keyed slots, `pending` vs `refreshing` = args-identity

The "async diamond" glitch (a combiner reading a new id directly + an async arm still holding the old id's
value → a `#2 — Alice` frame) is an artifact of modeling the async arm as a **single reseeded value**. In
the keyed model it doesn't arise:
- **`pending`** = *these args have no fetched value yet* (new/invalidated key); `peek(args)` is `undefined`.
- **`refreshing`** = *these args already have a value, being re-validated* (same key, `refresh()`/ttl);
  `peek(args)` is the retained value — keep-stale is correct here *because it's the value for these args*.

`memo(1)` and `memo(2)` are different slots. When the arg changes 1→2 the combiner reads `memo(2)` — an
empty (pending) slot → the **lift** (output as weak as its weakest input: any pending input ⇒ pending
output) makes the combiner pending; `memo(1)`'s stale value sits unread. No glitch, structurally.
Sync-topological batching (which the core already does, `reactive.ts:1-5`) orders the *marking* so the
combiner reliably sees pending, not the old value. The keyed async read participates via the
**promise-read model** (`{await fn()}`: suspend on pending, resume on settle) — separate from the standing
dep on the arg source and from the untracked body. The flicker-free-*and*-consistent variant (hold the
whole previous frame across a multi-input settle) needs **epoch/generation** tags and is a per-screen
premium, not core.

### Explicit-sink push is sugar for a write-effect

`pipe(a, node)` ≡ `pipe.effect(a, v => { node.receive(v) })`, `receive` = `set` (signal) / `publish`
(channel, append) / `publish` (memo, override). So `pipe(channel, memo)` *is* the existing cache-broadcast
pattern (`cacheChannelHub` → `applyCacheFrame` → memo verbs) — a real, code-grounded observation, kept as
description. Multi-source into a scalar sink needs a transform (`pipe([a,b], sig, (a,b)=>a+b)`); single
source is identity.

### Primary vs opt-in (the one open judgment call)

Auto-tracked named front-ends (`computed(() => a()+b())`, `watch(thunk)`) are **less ceremony** than
explicit-deps `pipe([a,b], …)` for the common path, and they don't reintroduce a React-style dependency
array. Recommendation (3 of 4 reviewers concur): **keep `computed`/`linked`/`watch` as the named,
auto-tracked front and let `pipe` be the explicit-deps composition operator + shared engine** — same
unification (everything's-a-pipe as the *model*), without the dep-array tax on everyday code. `pipe`'s
value shows in multi-input combine, stream map/fold, cache-sync, and switch.

### Open items

- Whether `pipe` is primary or opt-in-over-named-front-ends (recommended: opt-in).
- Edge-3 lint ("derive/effect result discarded"); the `switch`/passthrough (returns-a-node) semantics.
- Confirm surface `peek` subscribes via the observer stack `untrack` clears.
- Epoch tier for flicker-free-and-consistent async combines (premium, not core).
- How `pipe`'s `from`/combine composes with roomed channels (`channel<T, Args>`).

## Landing — the reactive model (consolidated 2026-07-24, after 3 adversarial rounds)

**Status: DESIGN. This section supersedes the whole `pipe` exploration above AND the earlier
"Landing / Corrections / Alignment / Performance" appends, which had accreted into a stratigraphy of
reversals** (a 3rd review found live contradictions: `.peek()` public-then-not, `.signal()` cached-vs-
per-use, the slot-handle built-then-killed). It is written as ONE statement so a top-to-bottom reader
implements the right thing. It is split into **Shipped** (true in code today — the durable core),
**Design** (not built; opt-in; honest status), and **Refuted** (ambitions the reviews killed — do NOT
build these). The recurring lesson across all three rounds: *the code-grounded model is solid; every
ambition layered on top of it broke.*

### Shipped — the durable core (verified in code)

- **Three node identities + one effect verb.** `signal` (owned scalar), `memo` (lazy, keyed, cached
  derive — subsumes `computed`), `channel` (retained stream), and `watch` (the effect). `rpc = memo +
  transport`, `socket = channel + transport`.
- **`memo` is lazy/passive** (`reactive.ts` recompute only in `get()`; `memo.ts` runs `fn` only on read):
  no reader → no work; an `invalidate` with no subscriber is a no-op (dirty until next read).
- **Rendering IS `watch` specialized to DOM.** The emitter makes ONE fine-grained `effect` per binding
  (`emitClient.ts:377-392` → `runtime.ts` `hydratableEffect`) — no VDOM diff. `{expr}` and `watch(fn)`
  are the same primitive with a different sink. Corollary: **a read is reactive iff it is inside a watch**
  (a render-watch or an explicit `watch`); a bare `<script>` read is a one-shot snapshot.
- **Args-on-methods.** The read/probe/verb surface takes args per method: `fn.peek(args)`,
  `fn.pending(args)`, `fn.refresh(args)`, … (`memo.ts`, `makeRpc.ts`; CLAUDE.md). `fn(args)` is the
  awaitable read. **Partial/superset match applies to the VERBS only** (`refresh`/`invalidate`/tags →
  `selectSlots`/`matchesSelector`); the **read probes are exact-slot** (`ensureSlot`) — a partial arg to a
  read would mint a bogus slot, so partial reads are not a thing.
- **`.peek(args)`** is the reactive, non-blocking, tracked read (subscribes inside a watch; `T |
  undefined`; `memo.ts:608`) — the cheap display read. It stays.
- **`rpc = transport-wrapped memo`; in-proc bypasses transport.** Same-process (`SSR`, one handler
  calling another, a test app), `rpc(args)` *is* the memo — direct, cached/coalesced, no fetch/serialize;
  the wire only fires across a process boundary. The awaitable is uniformly `Promise` (isomorphism +
  async fill), resolved immediately in-proc for a sync handler.

### Design — not built; opt-in; honest status

- **`computed`/`linked` are not primitives — just `memo` forms.** `computed` = `memo(() => …)` (0-arg,
  auto-tracks its body); the writable-derived (`linked`) is a *projection* of a memo (below). The tracking
  split is the one real semantic distinction: **`memo(() => …)` auto-tracks** (re-runs on any read's
  change, incl. a keyed-async `refresh()` — the sound form); an explicit-source `memo([a], fn)` samples
  its body reads (re-runs on the listed sources only). *Ship the auto-track form for anything that must
  react to an async read.*
- **`.signal()` — the writable projection (KEPT; earlier "refuted" was an over-retraction, 2026-07-24).**
  `.signal()` produces a **per-use copy-on-write writable cell** over a slot (read passes through to the
  slot; a local write forks an override held until the source reseeds). This is the writability layer, and
  it **stays** — the design we had before the reviews. Two clarifications the reviews *did* pin (neither
  kills it):
  1. It must be **per-use / component-scoped** (its own COW cell, disposed on unmount) — a *shared-per-slot*
     cell aliases (one component's write corrupts another) and leaks. Cold, bind-site cost, not hot-path.
  2. It is **not compiler-lowered by context** — the emitter is a syntactic, bare-identifier-only rewriter
     (`cellKind`/`rewriteCellRefs` never touch `.member` chains, no type info), so "auto-emit a cheap read
     vs a writable cell per site" is not buildable. `.signal()` is therefore an **explicit method** the
     author writes; losing the lowering only means a `.signal()` display read costs ~1 edge + branch more
     than a raw read (cheap, not free). Reading `{node.signal()}` in a template needs the interpolation leaf
     to auto-read an expression-produced signal (small runtime add), not just bare identifiers.
- **`.peek()` stays for now; removing it is the LAST step, bench-gated (decided 2026-07-24).** `.peek()`
  (cheap tracked display read) and `.signal()` (COW writable) coexist through all the other changes.
  Whether to collapse to a **single `.signal()` accessor** (accept the small COW read cost, drop `.peek()`)
  is deferred to a **side-by-side benchmark run after everything else lands** — not decided on paper. The
  perf delta is small enough that it's an empirical call, sequenced last so nothing else waits on it.
- **The `switchMap` / async-source node — mostly already exists; not the "one real capability" (revised
  2026-07-24).** Earlier framed as the deepest new build. But its common case — *follow a changing
  selection to a stream, tearing down the old one* — is **already handled by reactive `{#for await}`**:
  `{#for await m of socket(sel())}` tears the block down (closing the old iterator/subscription) and
  re-streams when `sel()` changes. So `switchMap`-as-a-primitive is redundant for the common path. What a
  named async-source/refcounted node adds over that is narrow: the same switching as a **shared, probeable
  node consumed outside a `{#for await}`** (e.g. fold "latest message of the selected room" to a scalar) —
  real but rare, and hand-rollable (`watch(sel, …)` → a signal). Downgraded from "must build" to "niche,
  defer." If built: a node subscribing to an async source, **refcounted** (open on first observer, close on
  last), lazy/passive-consistent. `channel` is `{tail, maxAge}`-only today.
- **The keyed-async re-fire gap (unresolved).** An explicit-source body untracks its reads, which severs
  the async re-await subscription (`memo.ts:592` `slot.signal()` is the subscription; single-channel
  `untrack` nulls it). So `memo([id], id => rpcUser(id))` won't re-fire on `rpcUser(id).refresh()` at a
  stable `id`. Fix = a **two-channel observer** (a promise-read register `untrack` leaves alone) — but
  that adds an observer check to *every* tracked `get()`, so it is NOT free and NOT shipped. The sound
  workaround needs no new machinery: **use the auto-track form** (`memo(() => rpcUser(id())…)`), which
  tracks both.

### Refuted — do NOT build these (the reviews killed them)

- **`.signal()` as a *shared-per-slot* cell** — aliasing (one component's write corrupts another) +
  per-args leak. (The *per-use* COW `.signal()` is KEPT — see Design. Only the shared variant is dead.
  Whether `.signal()` becomes the *sole* accessor is a deferred bench decision, not a refutation.)
- **Compiler-lowering `.signal()` by context** — not buildable on the current syntactic emitter; needs
  type-directed rewriting it deliberately avoids; `{node.signal}` (no call) wouldn't even render. (`.signal()`
  as an *explicit* method is fine — only the auto-lowering is dead.)
- **The slot-handle `node(args).x()`** (args-named-once, a thenable-with-methods) — per-render allocation,
  the `.then`-strips-the-method-bag hazard, and it contradicts the shipped args-on-methods surface. Keep
  args-on-methods.
- **Partial-match on the read probes** — verbs-only; a partial arg to `pending`/`peek` mints a bogus slot.
- **"functions are edges, not data"**, **dropping read-only `computed`**, and the whole return-type-
  inference `pipe` (killed in rounds 1–2).

### Signals-proposal alignment (forward-compat)

`signal` ↔ `Signal.State` (clean 1:1). `memo` is a **superset** of `Signal.Computed` (adds async + keyed) —
build it *on* sync signals (a slot is a `Signal.State<SlotState>`), and never expose it *as* a
`Signal.Computed` interface. `channel` has no proposal equivalent (additive). `watch` ↔ `Signal.subtle.
Watcher` + an effect layer. Reads map to `.get()`; any untracked sampling maps to `Signal.subtle.untrack`
(internal, not a public method today). Keep the *core* (tracking, glitch-freedom, lazy, untrack) matching
the proposal so a future native-signals swap is a substitution, not a rewrite; keep async/keyed in the
`memo`/`channel` layers. The one divergence to hold deliberately: **async** — layer it, never claim
interface-identity.

### Performance

**Net-zero on the shipped hot path, pay-for-use on the new opt-in builds.** The core is the existing
engine (lazy memo, one effect per binding, glitch-free batching, in-proc bypass) — literally unchanged, so
the template display read (`.peek`) costs exactly what it costs today. The *opt-in* additions each cost
only when used: a writable projection is a cold per-bind `linked` cell (~1 extra edge + branch on its
reads); the async-source/refcounted-channel node costs only when instantiated. The **one** build that
would touch the hot read path is the two-channel observer (an extra register consulted in `get()`) — which
is why it stays unresolved/opt-in and must not be sold under a "runtime unchanged" headline. **There is no
speed *win* here; the payoff is coherence / DX / ecosystem-alignment + the one real capability (async-
source/switch).** Do not sell any of this as a performance change.

### Open items

- **Sequenced LAST + bench-gated:** whether to collapse to a single `.signal()` accessor and drop
  `.peek()`. Land every other change first, then bench `.peek()` vs `.signal()`-COW side by side; the small
  read delta makes this an empirical call, not a paper one.
- `.signal()`'s template read path — the interpolation leaf must auto-read an expression-produced signal
  (`{node.signal()}`), not just bare identifiers. Small runtime/compiler add.
- Whether to build the **two-channel observer** (enables keyed-async in an explicit-source body) or accept
  "use the auto-track form" as the answer.
- The **async-source refcounted node** — DOWNGRADED to niche/defer (its common case is covered by reactive
  `{#for await}`). If ever built: teardown contract, out-of-order-settle race, retention on scalar→stream.
- `.peek()` naming vs the Solid/Preact/proposal convention where `peek` = *untracked* (abide's is
  *tracked*): rename, or document the difference, in step 7.
- Roomed-channel (`channel<T, Args>`) composition with the async-source node.
