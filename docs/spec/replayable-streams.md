# Replayable shared streams + unified verb caching

**Status:** design of record. The SSR streaming substrate (per-request `{#await}` / `{#for await}`
streaming) is shipped (`streaming-ssr-plan.md` PR1–6). The `ReplayableStream` primitive, unified verb
routing, and client-attach handoff described here are **built through step 5** (the SSR→client handoff,
§5, landed as the client half of 4b — see *Build order* step 4; the source-derived SSR budget, §6, is
step 5); **only step 6 (optional socket-core convergence) remains**. Every decision
below is grounded against the code it was designed against (anchors are `file:line` as of writing). This spec supersedes two earlier `rpc-core.md` decisions — §14.1 (mutations
not-coalesced/cached "today") and §12.2–3 (a stream bypasses the value cache; no replay buffer by
default) — both recorded under *Superseded prior decisions* with the exact prior wording.

This revision closes the gaps a first implementer hits: the cell slot is monomorphic and has nowhere to
put a stream; streaming handlers hand the cell **encoded bytes**, not decoded `T`; there is no
ref-count, no close hook, and no source-abort plumbing; the cache mux frame carries **verbs, not
chunks**; and "mutations coalesce by default at `ttl: 0`" needs its scope stated precisely (per-request
coalescing is inert; only opt-in `shared` mutations dedupe across callers) so it never reads as silently
collapsing unrelated POSTs. Each is resolved below.

## Why

Three concerns converge on one missing primitive:
1. **Client re-run of a model stream.** A `{#for await tok of complete(prompt)}` runs the model on SSR,
   and today the client hydrate **re-runs the source** — `forBlock`'s await path calls `clearBetween`
   to discard the entire streamed `<abide-list>` region, then `for await`s a *fresh* iterator from the
   start (`runtime.ts:1159,1168-1185`; the in-code comment states it explicitly). For an RPC/model
   stream that is a second model call (double-billed, re-generated). The client should **reuse** the
   streamed tokens, not re-run the source.
2. **Refresh / concurrent viewers.** Two people loading the same generation should share **one** run; a
   late joiner should **replay** the tokens so far, then continue live.
3. **Cost control generally.** An expensive stream must be de-duplicated by `(fn, args)` and, optionally,
   retained for a window so refreshes within it don't re-run.

A raw stream can't do any of this — it is single-consumption. `Response.clone()` tees but buffers
unboundedly and can't be cloned after the body is disturbed. The sound primitive is an explicit
**replay buffer that fans out replay-then-live**. Its *shape* already exists and is proven server-side
(`SocketHub.subscribe` replays the tail then goes live, `socketHub.ts:120-137`), but that core is
server-only, name-keyed, and **drop-oldest** — the opposite of what a finite replay needs. This spec
defines the replay-safe primitive and unifies it with the cell.

## Reality grounding (what exists today — the substrate this builds on)

An implementer must know the starting point; the spec is honest about the gap.

- **The cell slot is monomorphic.** `SlotState<T> = { status: "idle"|"pending"|"value"|"error", value:
  T|undefined, error, refreshing }` (`cell.ts:36-45`) inside a `Slot` with a single `inflight:
  Promise<T>|null` coalescing point and a `loadedAt` stamp (`cell.ts:47-58`). There is **no** open/
  streaming status, **no** per-slot subscriber set, and **no** ref-count. A ReplayableStream needs a new
  slot status — net-new machinery, not a config flip.
- **`loadedAt` is stamped at fn RESOLVE**, not stream close (`cell.ts:255,262`). For a streaming handler
  that is when the `AsyncIterable`/`Response` is *produced* — before the first chunk. "Settled = closed"
  has no hook today.
- **Reads wrap the handler in a cell; mutations bypass it entirely.** `makeRead` builds `cell(fn,
  cellOptions)` (`makeRpc.ts:131-174`); `makeMutation` is literally `(args) =>
  Promise.resolve(fn(args))` with no cell, no key, no coalescing (`makeRpc.ts:176-181`). So today
  identical *concurrent* mutations **each execute** — coalescing them is new behavior, not the status
  quo.
- **`RpcOptions.cache` is `{ ttl?, shared?, tags? }`** (`makeRpc.ts:53`) — there is no `cache: false`.
- **Streaming handlers return encoded bytes.** `jsonl(iterable)` / `sse(iterable)` return a `Response`
  wrapping a `ReadableStream<Uint8Array>`; the `T` values are JSON-encoded to bytes *before* the cell
  sees the return value, and the router passes the Response through untouched (`if (result instanceof
  Response) return result`, `router.ts:442`). At the point the cell would build `chunks: T[]`, the
  decoded `T` is gone.
- **`sharedStore()` is real** — a process-global `Map<string,unknown>` (`sharedCache.ts:21`), backing
  shared cells (`cell.ts:174`), LRU-bounded by `ABIDE_MAX_SHARED_CACHE_SIZE` via `measureBytes =
  JSON.stringify(value).length` recorded **once at settle** (`cell.ts:126-133,283-288`). That measure
  yields ≈0 for a stream/Response object, so a buffered transcript is invisible to the LRU.
- **The cache mux carries verbs, not chunks.** A shared cell broadcasts through an injectable `CacheNotify
  = (verb: "invalidate"|"refresh"|"amend", args, value?) => void` (`cell.ts:64`); the wire frame is
  `CacheFrame = { verb, value? }` (`cacheChannels.ts:23`) over an ephemeral `SocketHub` with **no tail
  replay** (`cacheChannels.ts:53`). Channels are keyed by **route name**, not cell identity:
  `cacheChannelName(rpc,args) = "@rpc:"+rpc+":"+canonicalKey(args)` (`cacheChannelName.ts:16`). Join is
  gated by `authorizeChannelJoin(channelName, presentedArgs, connData, config)` (**4 params**;
  `channelAuth.ts:61`), which re-runs the RPC's middleware chain and passes only if it reaches the
  terminal sentinel.
- **PR6 SSR streaming** consumes a *raw* iterator (`forAwaitStream` → `toIterator`,
  `streamScope.ts:134-149,162-236`), renders each item as an **HTML string**. It once applied one flat
  global budget `ABIDE_SSR_STREAM_BUDGET` to every source regardless of type; **step 5 made this
  source-derived** (§6) — an abide RPC source gets no cap, only a non-abide source is bounded by the
  now-last-resort default (300 000 ms, `streamScope.ts:50-53`). It emits `<abide-list id="ab-l:N">` and sets `data-ab-done` on close — but
  `data-ab-done` is **dead output**: no client file reads it, and the client always re-iterates.
- **The `{#await}` claim path works** and is the precedent to mirror: `unwrapStreamSlot` + `claimAwait`
  adopt the server-resolved branch in place because the tail seed primed the read (`runtime.ts:857-903`).
  `{#for await}` has no equivalent and actively destroys its server region first.
- **The hydration seed is value-only.** `SeedRead = { name, args, value }` (`pages.ts:170-174`);
  `collectSeed` walks resolved read-RPC slots via `rpc.snapshot()` (`pages.ts:203-220`). A `{#for await}`
  produces **no seed entry** — no slot handle, no chunk transcript.

## Decisions

### 1. All verbs route through one cell mechanism; the only default that differs is the cache policy
Every verb routes through the same cell (coalesce + cache + reactive slot). The read/mutation
distinction narrows to (a) the **wire** (method, args-in-URL vs args-in-body, CSRF) — unchanged — and
(b) the **default cache policy**:

- **Reads (`GET`/`HEAD`)** default `cache: { ttl: ∞ }` — coalesce concurrent identical calls within a
  scope, and cache the settled value (cross-request only under `shared: true`; a non-shared read's slot
  lives in the per-request `getContext().cache` and dies with the request — `cell.ts:174`). Current
  behavior.
- **Mutations (`POST`/`PUT`/`PATCH`/`DELETE`)** default **`cache: { ttl: 0 }`** — coalesce identical
  concurrent in-flight calls, retain nothing after settle (dispose once the live ref-count drains, §2).

**What `ttl: 0` coalescing actually dedupes — scope matters, and it makes `ttl: 0` a safe default.** A
non-shared mutation's slot lives in the **per-request** `getContext().cache` (`cell.ts:174`), so `ttl:
0` coalesces only identical concurrent calls **within one request scope** — which for a normal handler
that calls its mutation once is inert, matching today's observable behavior. Two *separate* requests
(two users, or one user's double-click — each is its own HTTP request and its own scope) do **not** share
a slot and each execute; today's `makeMutation` (`makeRpc.ts:178`) runs every call, and the non-shared
default keeps that for cross-request traffic. **Cross-request / cross-user dedup requires `shared:
true`**, which runs the handler **scope-exited** (§3, pure over args), so collapsing two callers' side
effects into one run is always an explicit author choice — never a silent default. This is precisely why
`ttl: 0` is safe as the default: the "two POSTs → one execution" case only arises under an opt-in
`shared` mutation, where the pure-over-args contract already applies.

`cache: false` is the escape hatch: opt OUT of the cell entirely so **even intra-scope concurrent
identical calls each execute** — for a genuinely non-idempotent handler (mint an idempotency key, append
a log line twice) where every call must run. `cache: { … }` overrides the per-verb default.

| Option | Enters cell? | Concurrent-identical (same scope) | After settle | Cache verbs | Default for |
| --- | --- | --- | --- | --- | --- |
| `cache: { ttl: ∞ }` | yes | coalesce | retain until LRU | full | reads |
| `cache: { ttl: 0 }` | yes | **coalesce** to one run | dispose on drain | none (Mutation is call-only) | **mutations** |
| `cache: { ttl: n }` | yes | coalesce | retain n ms after settle | full | opt-in: cacheable POST; late-join replay window |
| `cache: false` | no | each executes | nothing | none | opt-out: non-idempotent handlers; file-bearing FormData; hand-built `Response` |

Type change: `cache?: false | { ttl?: number; shared?: boolean; tags?: string[] }` (`makeRpc.ts:53`).

**Keying is over the coerced typed args, not the wire encoding — and that resolves FormData.** A slot is
keyed by `canonicalKey(args)` (`cell.ts:170,205`), which normalizes a plain object (keys sorted). The
key must be computed over the **coerced, schema-typed** args, not the raw request body — this is the
general principle, and it keeps the encoding isomorphic: a form-encoded POST and a JSON POST carrying the
same logical args produce the **same** key and coalesce. Concretely, the router coerces an incoming
`FormData` through the RPC's input schema (`"3"` → `3`, repeated keys → an array) into a typed plain
object *before* keying; `canonicalKey` of that matches the equivalent JSON args. (This coercion is
required regardless: a raw `FormData` is a class instance, so `canonicalKey` **throws** on it today at
the non-`Object.prototype` guard — `codec.ts:90-92` — it does not silently collide.) The one part with
**no** cheap canonical value is a **`File`/`Blob`** field: hashing metadata (name/size) can conflate two
different files, and hashing bytes is expensive and defeats streaming uploads. So a `FormData` **carrying
file parts** is `cache: false` (or the author supplies an explicit `key`); a **file-free** `FormData` of
scalar/array fields coalesces normally via its coerced args — a distinct concurrent upload of *different*
files (user A `cat.jpg`, user B `dog.jpg`) is `cache: false` and each executes, never conflated. A
hand-built `Response` returned by a handler is likewise `cache: false` (opaque, single-consumption, not
replayable — see §4).

**Mutation public surface is unchanged.** A cell-backed mutation exposes only `(args)` + `__rpc` +
`raw` (`makeRpc.ts:110-116`); `peek`/`pending`/`refresh`/`amend`/`snapshot`/`seed` are **not** added
(they are incoherent for a non-retained slot). Cross-callable invalidation stays as today — a mutation
handler invalidates *other* reads by calling their verbs (`todos.invalidate()`), which needs no change.

### 2. TTL semantics: the clock starts at "settled" — resolve for a value, CLOSE for a stream; slots are ref-counted while open
`ttl` = how long a **settled** slot is retained. For a value, settled = resolved (`loadedAt` at fn
resolve, unchanged, `cell.ts:255`). For a stream, settled = **closed** (last chunk buffered +
done/errored) — the ReplayableStream's `close()`/`fail()` stamps `slot.loadedAt`, **not** fn-resolve.
While a slot is **in-flight** (pending value, or an open stream) it is retained **regardless of `ttl`**,
ref-counted by attached consumers, and **not** LRU-evictable (§4).

- **`ttl: 0`** → dispose on settle **once the live ref-count reaches 0** (§4 lifecycle). Value:
  coalesce-only, no result cache. Stream: dedupe the in-flight generation, no post-close replay. A
  consumer arriving after disposal re-runs.
- **`ttl: n`** → retain `n` ms after settle. Value: cache hit for `n` ms. Stream: a **late joiner within
  `n` ms of close replays the full transcript with no re-run**; after `n`, re-run.
- **`ttl: ∞`** (reads default) → retain until LRU eviction (of *closed* transcripts only).

`isExpired` gains a stream branch: **while `status === "stream"` and not `done`, never expired** (open
streams outlive any ttl). Disposal must **remove the slot from the backing map**, not merely reset it to
idle — today `dropSlot` only resets state (`cell.ts:362-367`), which for `ttl:0` leaks an idle slot and
leaves the "coalesce vs re-execute" boundary undefined. The observable guarantee: *a call whose
inflight-start is after the previous identical call's ref-count hit 0 re-executes; otherwise it
coalesces.*

**Empty-refcount policy (keyed on ttl).** When the live ref-count drops to 0 *before* the source closes:
- `cache: false` / `cache: { ttl: 0 }` / non-shared → **abort the source** (`slot.abort()`) and dispose
  the slot. No retention to protect, so stop paying (satisfies Why #3).
- `shared` with `ttl > 0` (incl. `∞`) → **run the source to completion** decoupled from consumers
  (populate the buffer for late joiners within the window); abort only on `invalidate`/`refresh`.

### 3. Coalescing is keyed by `(fn, args)`, identity-safe by scope; the source is owned by the SLOT
Two identical in-flight `(fn, args)` calls share **one** execution and fan out. Scope decides
cross-user safety, unchanged from the shared-cache contract:
- **Per-request (non-shared)** coalescing is within one request scope → one identity → identity-safe by
  construction. (Rarely fires for streaming reads unless the same read is issued twice in a render.)
- **Cross-request (`shared: true`)** coalescing spans requests/users → the handler runs **scope-exited**
  (`runOutsideScope`, `cell.ts:275`; `identity()`/`cookies()` throw, fail-closed via `guardSharedRead`,
  `cell.ts:189-193`) so it is pure over its args. This is what makes "two users, same prompt → one run"
  safe — the run cannot depend on who triggered it.

**Source ownership.** The running source is owned by the **slot**, never by the first consumer. The slot
holds one long-lived `AbortController`; the source is invoked with its signal (`fn(args, { signal })`)
and launched detached from any rendering request scope (via `runOutsideScope`, even for a coalesced
non-shared run). A consumer aborting or detaching only decrements the ref-count; it **never** aborts the
source. The source is aborted only by (a) the empty-refcount policy (§2) or (b) `invalidate`/`refresh`
teardown (§4). This makes the "two viewers, one run" guarantee survive the initiating viewer leaving.

The **pure-over-args** contract is the author's responsibility for any cached/coalesced call, exactly as
for `shared` today; `cache: false` (§1) is the opt-out when it can't hold.

### 4. `ReplayableStream`: consume once, buffer decoded chunks, fan out replay-then-live by cursor
A streaming read whose slot is **actually shared or cached** (`shared: true`, or `ttl > 0`, or a second
concurrent consumer of the same `(fn, args)`) stores a **`ReplayableStream<T>`** in the slot. A plain
non-shared single-consumer streaming read keeps today's pass-through `Response` behavior (no
decode/buffer; the `router.ts:442` short-circuit is unchanged) — wrapping is engaged **only** when the
slot fans out.

**Decoded chunks, produced by the handler, encoded by the router.** A replayable streaming handler
yields a raw `AsyncIterable<T>` (or returns one) — *not* a pre-encoded `Response`. The ReplayableStream
taps that iterable to fill `chunks: T[]`; the **router** applies `jsonl`/`sse` transport encoding
downstream, once per HTTP consumer, over a fresh `consume()`. A handler that returns a hand-built
`Response` opts out of replay (`cache: false`, §1). This is the only way the cell can obtain decoded `T`
without re-parsing wire bytes, and decoded values are what make the transcript replayable, seedable, and
reactively re-mountable (§5).

**Transport helpers see through (built).** A transport helper is a serialization convenience and must NOT
change the cache/stream semantics: `json(x)` caches/seeds exactly like returning `x`, and `jsonl(gen())`
is replayable exactly like returning `gen()`. So each helper **tags** its `Response` with the
pre-encoding payload (`responseSource.ts`) and carries the payload TYPE in its return
(`json(): TypedResponse<T>`, `jsonl()`/`sse(): StreamResponse<C>`); the cell reads the tag and taps the
source, and `ReadSurface`/`Payload` unwrap the brand so `GET(() => json(x))` infers `Rpc<Args, typeof x>`
and `GET(() => jsonl(gen()))` / `GET(() => sse(gen()))` infer `StreamRead<Args, C>` — identical to the raw
forms, at author time and at runtime (verified by type-probe + HTTP tests). Two requirements this exposed:
(a) `jsonl` **and `sse`** are now **lazy** (pull-based, `highWaterMark: 0`) so a Response the cell sees
through and discards unread never drains its source (eager consumption would double-consume the one
generator); (b) `fn.raw` still returns the real encoded `Response` (tag/init intact). **`sse` is now
see-through too (built).** The lazy `sse` tags its source like `jsonl` and **defers its `:ok` prelude +
idle heartbeat to the FIRST real read**, so a discarded see-through body never opens (no timer leak) while
the long-lived socket HTTP faces — `router.ts` `sse(sock)`, consumed WS-less by CLI/MCP — keep their
live-tail behaviour (onopen on connect, idle keep-alive). This makes `sse` fully isomorphic
(SSR-block/seed/`?from=` resume), on par with `jsonl`.

**Data structure** (lives in the slot; one instance per `(fn, args)`):

```
interface ReplayableStream<T> {
  chunks: T[]            // append-only shared buffer (the full transcript, up to the per-stream cap)
  waiters: Array<() => void>  // pending wake callbacks; a single shared wake list, not per-subscriber queues
  done: boolean         // terminal: source ended normally
  errored: boolean      // terminal discriminant (so fail(undefined) is still a well-defined terminal)
  error: unknown        // the failure value when errored (mutually exclusive with done)
  aborted: boolean      // terminal: torn down by policy/invalidate (a distinct terminal from error)
  bytes: number         // running Σ measureBytes(chunk), for LRU/cap accounting
  refCount: number      // live attachments (consumers currently iterating)
  generation: number    // bumped by amend/refresh; cursors re-replay from 0 on change
  abort: () => void      // aborts the owning source's AbortController (§3)
  consume(): AsyncIterable<T>  // a FRESH cursor view — one per consumer
}
```

**Read-return type (Promise-vs-AsyncIterable, resolved).** The cell stores the `ReplayableStream` on the
slot but the bare read stays `Promise<T>`: for a stream slot it resolves to a fresh `stream.consume()`
cursor (`T` = the `AsyncIterable<chunk>` the handler yields). So `{await fn()}` yields an iterable and
`{#for await x of fn()}` consumes it, with no change to the cell's `Promise<T>` read signature —
concurrent/late callers each `.then` into their own cursor over the one shared buffer. A streaming
handler is detected by its result being an `AsyncIterable` that is **not** a `Response`/`ReadableStream`
(those stay opaque byte bodies / `cache: false`), so existing value and `jsonl`/`sse` reads are
untouched.

**Client-side consumption (built).** In the browser the RPC proxy (`clientProxy.ts`) reaches the handler
over HTTP; a streaming read's response (`application/jsonl` / `text/event-stream`) is decoded by
content-type (`shared/internal/decodeStreamResponse.ts` — the inverse of the `jsonl`/`sse` encoders, an
async generator that cancels its reader on early exit) into an `AsyncIterable` of chunks, which the SAME
`cell` routes to a `ReplayableStream` slot. So a browser `{#for await x of rpc()}` — including a client
re-run of a known-RPC source with no SSR seed (the `{#if}`-gated / interaction-triggered case) — consumes
a stream identically to SSR, with `peek`/`chunks`/`done`/`resumeStream` all live client-side, and
`.refresh()` restarts it. The client `{#for await}` **awaits the read first** (a streaming read is
`Promise<AsyncIterable>`; a plain async-generator source is unaffected — awaiting a non-thenable is
identity). `sse` is additionally consumable via the native **`EventSource`** DOM API, same frames on the
wire.

**Streaming read surface + reactive peek (typed, built).** `GET`/`HEAD` return a **conditional** type:
a handler yielding `AsyncIterable<C>` produces a `StreamRead<Args, C>`, a value handler the usual
`Rpc<Args, T>`. `StreamRead` keeps `peek` as the canonical "current value" read (so it means the same
thing on both surfaces) and drops the meaningless value verbs (`amend`/`snapshot`):
- `fn.peek(args): C | undefined` — the non-blocking **most-recent chunk** (a stream's "current value"),
  reactive (re-renders as chunks arrive; reading it also kicks the source). This is the "just the latest
  value" read — `peek()` *is* the latest, no `.at(-1)`.
- `fn.chunks(args): C[] | undefined` — a reactive snapshot (copy) of the **whole transcript** so far, for
  rendering history or joining deltas — the genuinely different need a scalar `peek` can't serve.
- `fn.done(args): boolean` / `fn.error(args)` — reactive closed/failed probes.

Reactivity rides a **separate per-slot `streamTick` signal** bumped on each chunk push and on the
terminal — kept distinct from the state-machine `signal` the bare read subscribes to, so per-chunk
`peek()` updates never restart a `{#for await}`. The editor distinguishes the two surfaces at author
time (stream reads reject `.amend`/`.snapshot`; value reads reject `.chunks`/`.done`), closing the
auxiliary-surface typing gap the earlier resolution left open.

**Byte accounting & the buffer bound (built).** A stream's transcript is measured **incrementally** — the
`ReplayableStream.bytes` counter grows per chunk and is recorded into the LRU sidecar as it fills, so an
OPEN transcript pressures `ABIDE_MAX_SHARED_CACHE_SIZE` live (not a JSON-of-the-whole-object read at
settle). An open stream is **pinned** (`sharedCachePin`) so `sharedCacheEvictIfNeeded` skips it — only
CLOSED transcripts are evictable; an open stream may push the store over the ceiling (accepted; memory
safety for it is the per-stream cap). Exceeding `ABIDE_MAX_STREAM_BUFFER_SIZE` (default **unbounded** —
set by the operator, like `ABIDE_MAX_SHARED_CACHE_SIZE`) marks the
stream **overflowed**: it aborts its source (bounded memory), stops being a replay target (a new read
re-runs), and disposes on drain. Stale-callback safety: every stream-lifecycle callback (`onRefCountZero`,
per-chunk accounting, the settle finally) is guarded by stream identity, so a slot that has re-run into a
new stream under the same key is never corrupted by the old stream's callbacks.

**Build status.** Steps 1a (standalone `ReplayableStream`), 1b (cell integration: `"stream"` slot
status, ttl-from-close, per-`consume()` ref-count → dispose-on-drain / empty-refcount abort, `invalidate`
teardown), 2 (mutations route through a cell at `cache: { ttl: 0 }`; `cache: false` opt-out; FormData
bypass), the **typed streaming read surface** (`StreamRead<Args, C>` via a conditional `GET`/`HEAD`
return, with reactive `peek`/`chunks`/`done`), and 3 (shared streaming + incremental byte accounting +
open-stream pinning + per-stream cap/overflow) are **built and tested** (`replayableStream.ts`,
`cell.ts`, `makeRpc.ts`, `GET.ts`/`HEAD.ts`, `sharedCache.ts` + their `*.test.ts`; verified against the
docs app). The transport half of step **4** is built — the router transport-encodes streaming reads
(jsonl/sse) with HTTP-level fan-out AND serves the resumable `?from=<count>` replay endpoint (`router.ts`,
`cell.resumeStream`, `ReplayableStream.consume(from)`, `responseSource.ts` see-through helpers +
`streamHttp.test.ts`). The **client half of 4b is now built** — the `StreamHandle` seed section
(`pages.ts`, inline `values` + `data-ab-count`), the value capture + handoff records (`streamScope.ts`,
`context.ts`), the emit-time source tag (`emitServer.ts`, `{ attachable, rpcName?, args }` for a
known-RPC head under `src/server/rpc/`), and the `forBlock` hydrate reorder (`runtime.ts`:
`begin/endStreamHandoff` + `attachForAwait` — adopt-from-`values` (A) / resume-`?from=<count>` (B) /
attach-miss-`fresh`-replace / offline-defer) wired through `bootstrap.ts` (`emitStreamAttach.test.ts`
proves the invariant: an RPC `{#for await}` source is never re-invoked on the client; a non-RPC source
still re-iterates; the `{#await}` claim path is unregressed). **Step 5 (source-derived SSR budget, §6) is now built** — the
streamer races the global `ABIDE_SSR_STREAM_BUDGET` (default raised to 300 000 ms, last-resort) ONLY for a
non-abide source; an abide RPC source (`attachable`) awaits its items with no global cap, bounded by its
own bilateral timeout. The budget timer is LAZILY armed (memoized `scope.budget()`), so an all-abide-source
page never schedules it (`streamScope.ts`, `context.ts`, `streamBudget.test.ts`). Only step 6 remains.

- The **first** consumer starts the source (owned by the slot, §3). Each chunk is `chunks.push(chunk)`,
  `bytes += measureBytes(chunk)`, then the `waiters` are drained (resolve-and-clear). `done`/`error`/
  `aborted` is set **last**, after the final push, so the terminal is never observed before the chunk
  that precedes it.
- A **consumer is a cursor**, not a queue. `consume()` returns a fresh `AsyncIterable<T>` with a private
  index `i`; replay and live are the *same* read (the cursor walks the one shared buffer). This
  eliminates the double-copy and the socket-style drop-oldest overflow entirely — a lagging consumer
  just reads slower from the shared array; nothing is ever dropped for a finite stream.

  ```
  consume(): on start, refCount++
    loop:
      while i < chunks.length: yield chunks[i++]
      if error: throw error
      if done or aborted: return
      await new Promise(res => waiters.push(res))   // woken by the next push or terminal
    finally: refCount--   // on iterator completion, .return() (break/early-exit), or .throw()
  ```

- **Attach is atomic.** Registering a waiter and snapshotting `chunks.length` happen in one synchronous
  step with no `await` between (single-threaded microtask ordering guarantees it), so a chunk or
  terminal arriving in the join window is never missed and a joiner never blocks awaiting a terminal
  that already fired. A late joiner arriving in the same tick as close replays the full transcript then
  ends deterministically.
- **Errored replay.** A consumer attaching after an error replays all buffered chunks in order, **then
  throws** `error` (partial progress preserved before the failure surfaces). An errored/aborted stream
  is retained per `ttl` with the clock starting at error/abort time (like a cell error slot,
  `cell.ts:226-231`); a joiner within `ttl` replays-then-throws, after `ttl` re-runs.
- **`amend` is not overloaded onto streams.** `amend(args, T | updater)` (`cell.ts:375-395`) replaces
  the whole slot value and broadcasts a JSON `CacheFrame`; for a stream slot `T` is the whole transcript,
  not a chunk, and the ReplayableStream (with its live `waiters`) is not JSON-serializable. First build:
  **`amend`/`refresh` on an open stream throw** a clear error ("amend is not supported on a streaming
  cache slot; invalidate to re-run"). `invalidate` on an open stream is defined: **abort the source**
  (`slot.abort()`), terminate live consumers gracefully at chunks-so-far (set `aborted`), bump
  `generation`, and remove the slot. A future `fn.append(args, chunk: T)` verb with its own JSON frame
  `{ verb: "append", chunk }` is **deferred** (§Deferred).
- **Slot polymorphism, contained.** Add `status: "stream"` and a typed `stream?: ReplayableStream<T>`
  field to `SlotState` — keep `value` for scalar slots so both stay monomorphic in *their own* field
  (honoring the CLAUDE.md monomorphic-slot guidance). Every value-slot reader gains an explicit stream
  branch: `peek` → snapshot of `chunks` (or `undefined` while empty); the bare read →
  `stream.consume()`; the sync cache hit returns `stream.consume()` (a fresh cursor), **never** the
  shared object; `snapshot`/`seed` → the handle form (§5), not the value form; `measureBytes` →
  `stream.bytes`; `pending` = source started, 0 chunks; `error` = `stream.error`.

**Byte accounting & buffer bound.** `bytes` accrues **incrementally per chunk** and is recorded via
`sharedCacheRecordSize` while the stream is open (not once at settle), so an open transcript pressures
the LRU as it grows. Streams split into two disjoint classes at buffer-bound time:
- **BOUNDED (opt-in).** When `ABIDE_MAX_STREAM_BUFFER_SIZE` is set (measured bytes; **unbounded by
  default**; operator sets it ≤ the global `ABIDE_MAX_SHARED_CACHE_SIZE`), buffer the whole transcript up
  to that cap. Under the cap — and always, when unset — the full-replay contract holds: every consumer
  (first, concurrent, late-within-ttl) gets the entire transcript.
- **OVERFLOWED.** On exceeding the cap the stream is marked `overflowed`: it drops post-close cache
  eligibility (behaves as `ttl: 0`), is **ineligible for the §5 client-attach handoff** (the client
  falls back to re-iterate — it cannot reconstruct item bodies it never received), and refuses new
  replay joiners (a late joiner re-runs). "Retain last N" is **not** a ReplayableStream mode —
  partial-prefix replay is incoherent for text; an author wanting unbounded full-history retention uses
  a **socket** (tail policy), per *Relationship*.

**LRU interaction.** `sharedCacheEvictIfNeeded` (`sharedCache.ts:63-76`) must **skip open streams**
(`done === false`) — open streams are pinned, never LRU candidates; only closed transcripts are
evictable, and memory safety while open is the per-stream cap, not the LRU. When a closed transcript is
evicted, `refCount === 0` is an invariant (all readers finished replay); eviction drops the chunk refs.

### 5. The client attaches to the ReplayableStream instead of re-running (SSR handoff)
On SSR the `{#for await}` consumes the ReplayableStream, streaming its chunks into HTML
(`streaming-ssr-plan.md` PR6). **The SSR-painted HTML is a paint-only placeholder that is always
discarded and re-mounted from decoded *values* on hydrate** — this is what reconciles "no re-run" with
"reactive item bodies" (`onclick`/state inside an item work). The client **never calls the source**.

Two handoff modes, keyed on stream state at flush:

- **(A) Completed-before-flush** (the primary finite case, e.g. a completion that finished within the
  SSR window): the seed carries the decoded transcript **inline** (`values: T[]`, same JSON path as a
  value seed). On hydrate the client discards the server-painted region (`forBlock` already clears it,
  `runtime.ts:1159`) and re-mounts each item reactively from `values` — **zero network**, no
  cross-request slot needed, unaffected by eviction or offline. This is the common path.
- **(B) Open-at-flush** (SSR flushed a partial or was cut off by the budget): the seed carries a **slot
  handle** `(name, args, count, done: false)`. The client adopts the flushed values as a frozen prefix,
  then **resumes over a resumable HTTP replay** — `GET /rpc/<name>?args=<json>&from=<count>` returns a
  stream **re-encoded in the handler's original encoding** (`jsonl` resumes as `jsonl`, `sse` as `sse` —
  the retained cursor carries its `tagStreamEncoding`, and the router mirrors the fresh-run encode) that
  synchronously replays `chunks[count..]` then continues live until close (one deterministic stream, no
  lost window; reuses the initial streaming HTTP transport of rpc-core §5.5).
  **The `@rpc:` cache mux is never the chunk path** — it carries only verb frames.

Mode (B) requires the slot (and its still-running source) to **outlive the SSR request**, which only the
process-global `sharedStore()` does. Therefore: a `{#for await}` over an RPC stream that is **open at
flush** auto-promotes its slot to a **handoff-retention** slot in `sharedStore()`, pinned by the pending
handoff and retained regardless of `ttl` until either the client's replay request connects (transferring
the ref) or an `ABIDE_ATTACH_GRACE` window (default **10 s**) elapses with no attach — then it disposes
per `ttl`. A per-user streaming read that depends on identity **cannot** use mode (B) (shared slots run
scope-exited, §3) and falls back to re-run with a dev warning.

**Seed schema.** Add a section to the hydration seed:

```
streams?: StreamHandle[]
StreamHandle = { listId: string; name: string; args: unknown; done: boolean; count: number; values?: T[] }
```

The streamer registration (`streamScope`) records `listId`, the flushed item `count`, `done`, and the
source's `(name, args)` at drain time, and emits `data-ab-count="<count>"` on `<abide-list>` alongside
`data-ab-done`. On hydrate the client iterates `streams`, finds `document.getElementById(listId)`, and
chooses adopt-from-`values` (mode A) vs resume-replay-`from=count` (mode B). The client keys the replay
request off the recorded `(name, args)` — **never** by re-evaluating the source expression (which may
reference server-only bindings).

**Attach applies only to a known RPC source.** A `{#for await x of EXPR}` whose head is a bare async
generator / `fetch().body` / any non-RPC `AsyncIterable` has no route name and no shared slot; it keeps
today's behavior (client re-iterates from a fresh iterator) and is documented as re-running. The
**emitter** tags each for-await source at compile time with `{ attachable: boolean; rpcName?: string;
timeout?: number }` (it already knows whether the head resolves to an RPC import), threaded through
`emitServer` into `forAwaitStream` and the `StreamHandle`. This one tag serves both the handoff and the
§6 budget.

**Edge paths, defined:**
- **Attach-miss** (slot LRU-evicted / ttl-expired / server restarted between flush and attach): for a
  **completed** transcript the client adopts from seeded `values` and never contacts the server, so
  eviction is irrelevant to the happy path. For an **incomplete** transcript whose slot is gone, the
  replay endpoint returns a distinguishable **fresh-from-0** response (vs `200` resuming from `from`),
  and the client drops the painted items and re-renders from the fresh values — the defined degraded
  path (double-bill only on this edge).
- **Offline at hydrate** (`online() === false`): a completed transcript adopts from `values` with no
  network. An open stream adopts the flushed prefix and **defers** the replay+subscribe, retrying
  automatically when `online()` flips true, resuming with `from=count` so no chunk duplicates or skips.
- **Hydrate reorder.** `{#for await}` hydrate must intercept the streamed `<abide-list>` **before**
  `clearBetween` (analogous to `unwrapStreamSlot` for `{#await}`, `runtime.ts:857`) when a
  `StreamHandle` is present; only with no handle does it fall back to the current clear-and-re-run.

### 6. The SSR stream budget is source-derived, not a global constant — ✅ BUILT (step 5)
The bound past which SSR stops waiting on a stream is the **source's own deadline**. Using the emit-time
source tag (§5), `forAwaitStream` keys the budget on whether the source is an abide RPC (the `attachable`
tag — the same tag that gates the §5 handoff, so one tag serves both):
- **abide RPC source** → **no SSR cap**; the streamer awaits each item directly. The RPC's bilateral
  `timeout` (`ABIDE_RPC_TIMEOUT` / per-RPC `timeout`), which already self-terminates the stream, is the
  budget — so no numeric timeout needs plumbing into `forAwaitStream`; it simply skips the budget race.
- **non-abide source** (raw `fetch`, unbounded local generator) → races the global `ABIDE_SSR_STREAM_BUDGET`
  cap (default raised from the PR6 30 s placeholder to a **last-resort 300 000 ms**, `streamScope.ts:50-53`)
  — the only thing abide can't otherwise bound. The timer is **lazily armed** (memoized `scope.budget()`),
  so a page whose streaming sources are all abide RPCs never schedules it.

For today's single-source `{#for await}` the budget is simply that source's timeout; the earlier
"`max(timeout)` across the block's abide sources" wording is reserved for a future multi-source block
and dropped until then.

## Cache-verb & wire summary

| Frame kind | Shape | Channel / transport | Carries |
| --- | --- | --- | --- |
| Cache verb | `CacheFrame { verb, value? }` (`cacheChannels.ts:23`) | `@rpc:<name>:<key>` mux | invalidate/refresh/amend — **verbs only, never chunks** |
| Stream replay | `jsonl`/`sse` body | `GET /rpc/<name>?args=…&from=<count>` | replay `chunks[from..]` then live |
| Seed (value) | `SeedRead { name, args, value }` (`pages.ts:170`) | hydration payload | a resolved value |
| Seed (stream) | `StreamHandle { listId, name, args, done, count, values? }` | hydration payload | inline transcript (A) or slot handle (B) |

## Limits (inherited / documented)
- **Single-process.** The `ReplayableStream` lives in the process-global `sharedStore()`. Multi-instance
  replay (a late joiner on a *different* server instance) needs the **horizontal backplane** (parked,
  `sockets.md` S3.3) — the same limit as the shared value cache and sockets today.
- **No client-side cross-tab buffer.** Cross-consumer reuse (multi-tab, multi-user) is **server-mediated
  only**: one `shared` slot, one source run, but each consumer connection gets its own replay-then-live
  `consume()` subscription. There is no `BroadcastChannel` chunk relay across tabs (the `@rpc:` channel
  carries verbs, not chunks). Every late joiner costs one full-transcript replay egress from the server
  buffer — factored into the per-stream cap rationale (replay egress is `O(joiners × transcript)`, but
  the buffer itself is `O(transcript)` once, because replay is pull-by-cursor over one shared array).
- **Buffer bound for truly-infinite streams.** Enforced by the `ABIDE_MAX_STREAM_BUFFER_SIZE` per-stream
  cap and the BOUNDED/OVERFLOWED split (§4). A full-history infinite feed is a **socket** (tail policy),
  which this converges with. Finite completions (the primary case) buffer wholly and cheaply.
- **`invalidate` mid-stream** aborts the source and terminates live consumers at chunks-so-far
  (`aborted` terminal); `amend`/`refresh` on an open stream throw (§4). Whole-callable / partial-args
  `invalidate()` still only broadcasts on its own `(name, args)` channel — remote fan-out for non-exact
  args is the pre-existing shared-cache limit, not changed here.

## Relationship to sockets
A ReplayableStream and a socket share a **data structure** — an append-only buffer + a subscriber set —
but **not a delivery discipline**. Replay/finite delivery is **pull-by-cursor, never-drop** (every
consumer gets the full transcript); a socket's live tail is **push, drop-oldest** at-most-once
(`socketHub.ts:45-47`, cap 1024) — correct for an unbounded topic, fatal for a replay. So the
convergence is: *share the ring-buffer data structure with two read disciplines*, where the socket tail
is the **infinite/ring specialization** (drop-oldest, no terminal) and the ReplayableStream is the
**finite/full specialization** (never-drop, done/error terminal). They cannot share one `Subscriber`
implementation unmodified. A socket remains the right tool for an **unbounded, author-published** feed
(chat, presence); a ReplayableStream is the right tool for a **request-triggered, finite** generation
(an LLM completion) that should be deduped, retained, and handed off to the client without re-running.

## Superseded prior decisions
- **`rpc-core.md` §14.1** (verbatim: "Mutations … **not read-cached, not coalesced (today)**"; it
  already carries an inline SUPERSEDED back-reference here) → mutations route through the same cell and
  default **`cache: { ttl: 0 }`** — coalesce identical concurrent in-flight calls (per-request scope, so
  inert for the normal one-call-per-request case; cross-caller dedup only under opt-in `shared`), retain
  nothing after settle; `cache: false` opts out entirely; keying is over coerced typed args (file-free
  FormData coalesces and matches JSON; file-bearing FormData is `cache: false`) (§1).
- **`rpc-core.md` §12.2** (verbatim: "A stream is a subscription, not a scalar value slot — no `.peek`
  scalar, not in the hydration payload as a value") → a stream whose slot is shared/cached stores a
  `ReplayableStream` of decoded chunks and **is** seedable (as a handle or inline transcript, §5).
- **`rpc-core.md` §12.3** (subscription-level coalescing: "identical-arg consumers share one upstream
  connection, fan out to N; ref-counted; torn down when the last leaves") → realized concretely as the
  slot-owned source + cursor fan-out (§3–4); **replay becomes available** for an HTTP stream, opt-in via
  `cache` (`ttl: 0` = coalesce-only, no post-close replay; `ttl: n` = an `n`-ms late-join window).
- *Note:* the "replay/tail is a socket feature, not an HTTP-stream feature" wording lives in
  `sockets.md` (S1.1/S2.1), not rpc-core §12; this spec supersedes that stance too.

## Environment variables (new / affected)
| Var | Effect |
| --- | --- |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | per-stream transcript cap in bytes (default **unbounded**, operator-set); ≤ `ABIDE_MAX_SHARED_CACHE_SIZE`; exceed → OVERFLOWED (§4) |
| `ABIDE_ATTACH_GRACE` | retention window (ms, default 10 000) an open attachable stream is pinned awaiting the client's replay request (§5) |
| `ABIDE_SSR_STREAM_BUDGET` | last-resort global SSR wait cap for **non-abide** sources only (default **300 000 ms**; §6); abide sources use their own `timeout` and get no cap |
| `ABIDE_MAX_SHARED_CACHE_SIZE` | unchanged; now fed incrementally-measured stream bytes (§4) |

## Build order (independently shippable, each with its test matrix)

**1a. Standalone `ReplayableStream<T>` primitive** ✅ **built** — cell-independent: `push`/`close`/`fail`/`abort`,
`consume(): AsyncIterable<T>`, `chunks`/`done`/`error`/`aborted`/`bytes`/`refCount`/`generation`. Its own
unit tests, no cell:
- 100 concurrent `consume()` → one buffer, all receive the identical full transcript.
- late joiner after chunk k, source at k+1 → sees k+1..end, no gap/dup.
- chunk emitted during a joiner's replay loop → delivered exactly once after the replayed prefix.
- source errors after chunk 3 → every consumer (concurrent + late) sees 1-3 then the same error.
- consumer `break`s mid-replay → `refCount` decrements, others unaffected.
- `abort()` → live consumers terminate at chunks-so-far; a racing late joiner replays-then-ends.

**1b. Cell integration** ✅ **built** — `SlotState` gains `status:"stream"` + `stream` field; `close()`/`fail()`
stamp `slot.loadedAt`; per-`consume()` ref-count; `isExpired`/`measureBytes`/`snapshot`/`seed`/the sync
cache-hit gain stream branches; disposal removes the slot from the map. Tests:
- two concurrent reads through the cell = one source run + full replay for a late joiner.
- value slot's clock still starts at resolve (regression guard).
- open stream is never LRU-evicted or ttl-expired mid-flight.
- ttl-from-close boundary (fake clock): joiner at close+1 ms replays; at close+(n+1) ms re-runs.
- ttl:0: joiner before close coalesces; strictly after close re-runs; slot removed from map on drain.
- empty-refcount: ttl:0 non-shared aborts source on last-leave; shared ttl>0 runs to completion.

**2. Mutation routing** ✅ **built** — `cache?: false | {…}`; mutations default `cache: { ttl: 0 }`;
FormData/hand-built-Response always `cache: false`. Tests:
- default (`ttl: 0`), same request scope: two identical concurrent calls → handler runs **once**, both
  get the same result; two **sequential** identical calls → runs twice (disposed on drain between them).
- default (`ttl: 0`), the same two calls issued as **separate requests** → each executes (per-request
  scopes don't share) — cross-request backcompat preserved.
- `cache: false`: even intra-scope concurrent identical calls each execute (opt-out proven).
- `shared` mutation `ttl: 0`: two concurrent identical cross-request calls coalesce to one scope-exited
  run; the coalesced handler's `other.invalidate()` fires exactly once (not per-joiner).
- a file-free FormData POST and a JSON POST with the same logical args → identical key after schema
  coercion (`count="3"` matches `count: 3`), so they coalesce / cache-hit.
- two distinct concurrent **file** uploads → never collide, both execute (file-bearing FormData is
  `cache: false`).
- Mutation public surface stays call-only (`peek`/`amend` not present).

**3. Shared streaming reads + byte accounting** ✅ **built** — `cache: { shared }`/`ttl` on a streaming
read wired to the ReplayableStream; **incremental** per-chunk byte accounting; open streams PINNED
against LRU eviction; per-stream cap `ABIDE_MAX_STREAM_BUFFER_SIZE` (default unbounded) → OVERFLOW. Tests
(`streamShared.test.ts`):
- a shared streamed transcript's buffered bytes count toward `ABIDE_MAX_SHARED_CACHE_SIZE` and can evict
  an older closed slot.
- a stream exceeding `ABIDE_MAX_STREAM_BUFFER_SIZE` → OVERFLOWED (drops replay eligibility, late joiner
  re-runs); does not grow unbounded.
- an evicted (closed) stream slot re-runs on next read; an open stream is pinned.

**4. Client attach.** ✅ **built** (4a transport + resume + 4b client half). **Transport** (4a + resume):
the ROUTER transport-encodes a streaming read whose slot resolves to an AsyncIterable as
`application/jsonl` (or SSE on `Accept: text/event-stream`), once per HTTP consumer, so a
bare-async-generator read is HTTP-serviceable and concurrent HTTP consumers fan out over ONE
ReplayableStream run; and **`?from=<count>` resumes a RETAINED transcript** (replay `chunks[from..]` then
live via `ReplayableStream.consume(from)` + `cell.resumeStream`), or, when the transcript is gone, runs
fresh from 0 and sets `x-abide-stream-resume: fresh` so the client REPLACES its painted prefix
(`streamHttp.test.ts`). **Client half (4b)**: the SSR→client handoff — an attachable `{#for await}`
captures its decoded values + registers a `StreamHandle` (`streamScope.ts`/`context.ts`), `collectSeed`
emits the `streams` seed section (+ inline `values` / `data-ab-count`; `pages.ts`), the emitter tags a
known-RPC head `{ attachable, rpcName?, args }` (`emitServer.ts`), and `forBlock`'s hydrate reorder
intercepts the `<abide-list>` before `clearBetween` and adopts-from-`values` (A) / resumes-`?from` (B) /
`fresh`-replaces (attach-miss) / defers-on-`online()` (offline) via `attachForAwait` (`runtime.ts`),
wired through `bootstrap.ts`. Tests (`emitStreamAttach.test.ts`):
- completed SSR stream → client renders identical items, **RPC source spy shows zero client-side
  calls**, an `onclick` inside an item fires (reactive mount proven). ✅
- cut-off SSR stream → client adopts partial + receives remaining chunks live via `?from=count`, source
  spy shows zero client calls. ✅
- non-RPC source → client re-runs (current behavior preserved). ✅
- attach-miss (slot evicted) on an incomplete stream → endpoint signals fresh-from-0, client replaces.
- offline at hydrate → open stream defers, resumes on `online()`; completed adopts with no network.
- regression: `{#await}` claim path (`unwrapStreamSlot`/`claimAwait`) still works. ✅

**5. Source-derived SSR budget** (§6) ✅ **built** — the streamer keys the budget on the `attachable`
source tag: an abide RPC source awaits its items with no global cap (bounded by its own bilateral
`timeout`); only a non-abide source races the last-resort global `ABIDE_SSR_STREAM_BUDGET` (default raised
to 300 000 ms). The budget timer is lazily armed (memoized `scope.budget()`) → an all-abide page schedules
none. Tests (`streamBudget.test.ts`, deterministic — manual source + budget, no wall-clock racing):
- an abide source with the budget fired immediately still streams every item to `complete` (not cut off),
  and finalizes a mode-A handoff record (`done`, full `values`).
- a non-abide source is cut off the moment the budget fires (generator returns, no `complete` frame).
Refs: `ui/internal/streamScope.ts` (`forAwaitStream` race + lazy `budget()`), `shared/internal/context.ts`
(`StreamScope.budget`).

**6. (Optional) Socket-core convergence** — extract the shared append-only buffer + subscriber set with
two read disciplines. **Gated behind a socket-parity regression suite** (tail:N replay, drop-oldest
shedding, idle timeout unchanged before/after). Does **not** block correct client attach — step 4 ships
its own replay transport, which step 6 may later fold in. Do not place a destabilizing cross-layer
refactor on the critical path.

## Deferred (explicitly out of scope for the first build)
- **`fn.append(args, chunk: T)`** stream-delta verb + its `{ verb: "append", chunk }` frame and
  remote-apply (§4). First build forbids `amend`/`refresh` on an open stream.
- **Cross-instance replay** (horizontal backplane, `sockets.md` S3.3).
- **Multi-source `{#for await}`** blocks and their `max(timeout)` budget (§6).
- **Client-side cross-tab chunk relay** (a `BroadcastChannel` transcript) — server-mediated only for now.
- **Lazy `sse` + see-through** so `GET(() => sse(gen()))` is replayable like `jsonl(gen())` / an async
  generator (needs pull-based sse with a heartbeat that survives `highWaterMark: 0`; `json`/`jsonl` done).
