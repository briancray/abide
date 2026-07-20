# abide — RPC / Isomorphic Read Core (Spec, Slice 1)

Status: draft, derived from design interview 2026-07-17.
Scope: the isomorphic RPC + reactive-read core. The `.abide` template compiler is
the second essential slice and is **out of scope here** except where its reactivity
substrate is shared (Q9).

The organizing thesis: **the core primitive is not "RPC" — it is a generic isomorphic
memoizer for async functions** (caching + coalescing + a reactive read surface). RPC is
that primitive composed with a transport. Everything below is a property of the primitive
unless it explicitly says "transport" or "HTTP."

---

## 1. The primitive

- The primitive is **`cell`**: `cell(asyncFn)` wraps *any* async function to give it the
  smart-read surface: caching, in-flight coalescing, and reactive reads (`.pending`,
  `.error`, `.refreshing`, `.peek`, `.watch`, `.refresh`, `.invalidate`, `.amend`). Its type
  is **`Cell`** (the `AsyncCell` referenced by selector signatures elsewhere = `Cell`).
- abide's own `GET`/`POST`/`socket` **bake the behavior in** — users never call `cell` to
  get RPC behavior. Users reach for `cell()` only to wrap **their own third-party async
  functions** (a Stripe SDK call, a DB driver, a pure computation) and get identical
  ergonomics.
- Design `cell` as genuinely standalone/public with a clean seam; RPC = `cell` +
  (serialization, network fetch, SSR in-proc dispatch, schema validation).

## 2. Cache scope (the security-critical decision)

Same code, ambient scope differs by side:

| Side | Scope | Lifetime |
| --- | --- | --- |
| Client | one cache per tab/session (global) | tab lifetime |
| Server (default) | **per-request**, isolated | dies with the request |
| Server (opt-in) | **shared**, crosses requests | until evicted/invalidated |

- Server per-request cache rides the ambient request context (AsyncLocalStorage-style,
  same context behind `request()`/`cookies()`/`server()`). Coalesces identical reads
  *within one SSR pass*; never leaks across requests.
- **No default cross-request server read cache.** A process-global read cache would render
  one user's data for another — forbidden.
- Calling a wrapped fn with **no ambient context** (bare script, cron, background task)
  lazily uses a default ambient context — it still works, just without per-request
  isolation. Does not throw.
- Server-side `invalidate`/`refresh`/`amend` with a per-request (non-shared) slot has no
  durable local target → **broadcast-only** (see §10). With a **shared** slot it has a
  durable target → mutates the shared entry **and** broadcasts.

### Shared server cache contract

Opt-in deliberately crosses requests, so the auth-free property is made *structural*:

1. **Opt-in per-call-site** via the `cache` opt (`{ shared: true, ttl }`). Not a global
   mode; the default stays per-request-throwaway.
2. **Key = `(callSiteId, serialize(args))` and nothing ambient** — no cookies/auth/request
   in the key. This is exactly why shared is only safe for functions pure over their args.
3. **Hard enforcement — fail CLOSED in dev AND prod:** a `shared` function that reads
   ambient request scope (`cookies()`, `identity()`, `request()`, per-request cache)
   **throws in dev and refuses to cache in prod** (throws or bypasses the cache — never
   caches the value). The "shared functions physically cannot see the request" guarantee
   holds in prod, not just dev, which is what prevents cross-user cache poisoning.
4. **Bounding:** optional global byte ceiling `ABIDE_MAX_SHARED_CACHE_SIZE` with LRU
   eviction, **default = NO LIMIT (unbounded)**, opt-in bound. Unbounded-by-default over
   attacker-influenced args is a **consciously accepted** memory-exhaustion tradeoff for a
   tool-shaped framework; the env var is the operator mitigation. Byte-measure = serialized
   form (trivial for RPC; **PARKED**: rule for measuring wrapped third-party values). The
   same ceiling also bounds the **default ambient context** (the `abide run`/cron/worker
   path) when set, so long-running scripts are bounded; scripts may also `invalidate`
   manually.

## 3. Cache key & TTL

- **Cache key** = `(callSiteId, canonicalKey(args))`. `callSiteId` is the route name for
  RPC (`/rpc/<name>`); for wrapped third-party `cell`s it is auto-generated (stable enough
  for per-request use) or an explicit `key` opt (§6).
- **TTL** = `ttl: <ms>` option **everywhere**, default **∞** (entries are retained until
  explicitly `invalidate`/`refresh`; SWR-style retained-value store, not time-expiry).
- **Eviction bounds:**
  - Client per-session cache: ∞, no eviction. Self-limited (dies on tab close). Accepted.
  - Server per-request cache: ∞ is moot (dies with request).
  - Server shared cache: ∞ default, optional `ttl`/global byte ceiling (§2.4). Unbounded
    shared cache over attacker-influenced args is a known memory-exhaustion vector;
    bounding is available, not imposed. No hidden ceiling (stack-visibility value).

## 4. Codec (keyer + hydration codec)

**RPC inputs and outputs are JSON-serializable ONLY.** No `Map`/`Set`/`BigInt`/`Date`/etc.
on the RPC wire. This is deliberate: schema validation (server always, client opt-in
§10/§12) then always applies cleanly because everything crossing the RPC boundary is plain
JSON. The **rich value codec below is NOT used on the RPC wire.**

Two distinct jobs:

1. **Canonical keyer** (`args → cache-key string`): deterministic/canonical (sorted keys),
   may be lossy/opaque, never decodes back. `f({a,b})` and `f({b,a})` → same key. Args are
   JSON, so keying is over JSON.
2. **Rich value codec** — used **ONLY for non-RPC hydrated values**: the wrapped-`cell`
   `key`-hydration path (§5.2), where a server-computed value travels in the hydration
   `<script>` and never goes through JSON-Schema validation. Round-trip fidelity,
   encode-on-server / decode-to-equal-value-on-client. "Codec" = hydration-of-server-values
   only.

Rich codec support (hydration path only):

- **In:** JSON primitives + `undefined`, `BigInt`, `Date`, `Map`, `Set`, `RegExp`, `URL`,
  `TypedArray`/`ArrayBuffer`, and **circular/shared references** (ref table).
- **`Error`:** a structured error shape (needed for §11 typed errors — which, being RPC I/O,
  ride the JSON wire as a JSON-shaped structured error, not the rich codec).
- **Out:** class instances (no registry/revival), functions, symbols.
- **Build vs vendor:** **hand-rolled.** No native JS "JSON-superset → string" codec exists
  (`structuredClone` emits no bytes; `v8.serialize` is Node-only). Must be byte-identical
  and debuggable on both sides.

## 5. Hydration (SSR value → client cache)

Makes the *value* travel with zero SSR/client coordination:

1. **Key identity across sides** is guaranteed by §3 (`callSiteId` + canonical args). RPC
   route ids are trivially isomorphic. **Record-and-replay of SSR-computed inputs:** the
   server serializes the **actual args it used** next to each hydrated value; the client
   seeds/reads under the *recorded* args rather than recomputing them (fixes
   non-deterministic key desync). **This extends to `state()` initializers** —
   `state(Date.now())` records the SSR value and replays it on hydration, so the client
   never diverges from the server.
2. **Third-party `cell`s are server-only** and don't hydrate as themselves (a Stripe call
   can't run in the browser). A server-computed value opts into hydration via an explicit
   `key`; the client can then **read** it (`.peek`) but **never recompute/refresh** it (no
   client transport for it). Keys auto-set otherwise. **Output-shaping:** before any value
   goes on the wire OR into the hydration `<script>`, it is **shaped to the
   declared/derived output-schema fields** (key-pick allowlist) — undeclared fields
   (e.g. `passwordHash`) are dropped, **in prod too**. The output schema is the allowlist
   for what may leave the server.
3. **Payload = `<script type="application/json">`** — off the JS parse hot path, decoded
   lazily on demand.
4. **Incremental / streamed, not one bottom-of-page blob.** As each read resolves during
   SSR, its HTML patch + cache entry flush together. A pending stream point blocks **only
   its direct dependents**, never siblings (out-of-order streaming). **A read whose SSR
   payload has not yet streamed when its component runs enters an explicit "pending,
   server-owns-this, do-not-refetch" slot state** (see §7.2); the streamed payload later
   fills it. The client never refetches a slot the server is still streaming.
5. On boot the client seeds its cache from the payload *before* any component runs → first
   render is a synchronous cache hit, no refetch, no flash. **Continuous stream handoff:**
   for an SSR'd stream, the **initial streaming HTTP response stays the live transport** —
   the client attaches to the still-open body rather than closing and re-subscribing. One
   continuous stream ⇒ no dropped items across the SSR→client boundary.

## 6. Dispatch & the server→client boundary

One imported callable means two things:

1. **Module-swap via bundler resolution, not a runtime branch.** Server build resolves
   `../server/rpc/user` → the real handler. Client build resolves the *same specifier* →
   a generated thin proxy that `fetch`es the route and threads the result through the
   shared primitive. No `if (isServer)` in user code.
2. **Hard security boundary:** the client bundle never contains the handler body or its
   transitive imports (DB driver, secrets, SDKs, `process.env`). `src/server/**` → client
   gets **types + generated proxy, never runtime**. Types erase, so I/O types flow to the
   proxy for free.
3. **Build-time dispatch:** SSR-vs-fetch is decided by *which bundle you're in*.
4. **Only the transport thunk is swapped:** cache/coalesce/reactive layer is identical in
   both bundles; the innermost "produce the value" step is `await handler(args)` (server)
   vs `await fetch(...)` (client).
5. **Proxy generation = synthesized in-memory at build (option i)**, drift-free (generation
   *is* a build step, so no codegen-staleness class of bug). Optional `--dump` materializes
   proxies to `src/.abide/` for stepping through. Types come from the type-only import, not
   the runtime proxy, so on-disk buys nothing for types.
6. **No HTTP self-call during SSR, even in `abide dev`** — SSR runs in-proc inside request
   scope; the only HTTP RPC traffic is genuine browser→server.

## 7. Reactivity (shared substrate)

1. **One shared reactivity substrate** in `shared/`; `state`/`computed`/`linked`/`watch`
   are its public face (`.abide`), the RPC read surface consumes the same graph. Fine-
   grained **signals** (Solid/Vue/Preact-signals family), not VDOM diff.
2. **Each cache slot `(callSiteId, args)` *is* a signal.** Reading it in a tracking context
   subscribes; changes (resolve, `invalidate`, `amend`, socket broadcast) re-run
   subscribers. The slot is a state machine: `idle → pending → value | error`, with a
   `refreshing` flag when revalidating over a retained value. `.pending`/`.error`/
   `.refreshing`/`.peek` are **derived views of the one slot**, not separate channels.
3. **Update semantics: push-notify + pull-recompute, microtask-batched, glitch-free
   (topological).** A burst of writes (5 socket amends) → one recompute; no intermediate
   inconsistent state observed.
4. **Server renders once, but flush effects are re-runnable.** SSR renders once, and ongoing
   `watch`/effects remain a client-only concept. The one server use of the graph is "flush
   this subtree's HTML patch + cache entries once its pending reads resolve." That flush
   effect is **re-runnable, not one-shot**: a subtree depending on multiple pending reads
   **re-checks on each dependency's arrival and flushes only when all are ready** (a
   fire-once-and-detach model would hang multi-dependency subtrees).

## 8. Mutation → read consistency

1. **Manual, not automatic.** No automatic read/write dependency graph. Handlers/callers
   explicitly call `invalidate`/`refresh`/`amend`. (Explicit = debuggable, stack-visible.)
2. **Selector granularity — the method form is canonical:**
   - **Whole callable:** `user.invalidate()` (no args) drops every slot for the callable.
   - **Specific slot:** `user.invalidate(args)` (method form, args in — **never**
     `invalidate(user(42))`, which would *execute* the read as a side effect).
   - **Partial-object match:** `user.invalidate({ id })` matches **every slot whose args
     include `{ id }`**; `undefined`/no-arg recedes to the whole callable. Same shape for
     `refresh`/`amend`.
   - **Tags:** a read declares `cache: { tags: [...] }`; the tag selector is the **only**
     form kept on the `abide/shared` globals — `invalidate({ tags })` / `refresh({ tags })` /
     `pending({ tags })` / `refreshing({ tags })`. Every per-callable op uses the method form.
   - **Rule:** neither form ever executes the read — args are passed, never `fn(args)`.
     `invalidate(user(42))` is a **type error**, not a silent footgun.
3. **Side-swap (Q3 asymmetry, concrete):**
   - `user.invalidate(args)`: client → drop local slot (lazy reload); server → broadcast
     (+ drop shared entry if the slot is shared). **A server-only `key`-hydrated value the
     client can't refetch is never dropped** — invalidating it **pushes the recomputed
     value** (or forces a nav refresh), so the slot is never stranded on a refetch the client
     cannot perform (§5.2).
   - `user.refresh(args)`: like invalidate but eager reload; server-broadcast eager.
   - `user.amend(...)` — one name, two signatures; a slot is *shared* iff its RPC/`cell` sets
     `cache: { shared: true }`:
     | Caller | value-form `amend(args, v)` | updater-form `amend(args, cur => next)` |
     | --- | --- | --- |
     | Client (any slot) | local swap | local swap |
     | Server, shared slot | durable write + broadcast | updater on the durable value + broadcast |
     | Server, per-request slot | broadcasts the value to the `(fn, args)` channel | **error** (nothing durable to mutate; a closure can't broadcast) |
4. **Broadcast rides the socket multiplexer** (`/__abide/sockets`, one websocket). Cache-
   coherence broadcasts go to a channel **keyed by `(rpc, args)`** (e.g. `profile:A`), *not*
   to all mux clients; the dev-reload and invalidation channels are the only reserved
   *internal* channels. A client receives a channel only if it has **joined** it, and
   **joining requires authorization to read that slot** (you cannot join `profile:B`'s
   channel unless allowed to read `profile(B)`). This is precisely why value-form `amend` may
   broadcast the value safely — the joins are authorized. **Best-effort real-time**, no
   guaranteed delivery queue in this slice; offline/socketless clients revalidate on next
   natural read or reconnect. Socket connects lazily on first broadcasting verb / socket use.

## 9. Error model

1. **Structured round-trip** (via §4 `Error` shape): a thrown handler error carries
   `status`, `statusText`, optional typed `name`, optional `data`. The client proxy
   reconstructs a real thrown `HttpError` (or typed subclass) — `try/catch` on the client
   sees the same shape the server threw.
2. **Errors are first-class slot states**, not exceptions escaping the reactive system. A
   failed read → `error` state; `.error()` reads it reactively; on `refresh` the slot is
   `refreshing` while holding prior value/error.
3. **Typed errors declared per-RPC** via `error.typed(name, status, schema?)`; `name`
   travels on the wire, `schema` validates `data`; `fn.isError(e, 'name')` narrows. The
   proxy's throwable-typed-error union is part of the RPC's type surface.
4. **Redact undeclared errors in prod.** Declared typed errors serialize fully.
   *Undeclared* throws (null-deref) → generic 500, **no message/stack to the client in
   prod** (dev only). No internals exfiltration.

## 10. Schemas & validation

1. **Format:** any **Standard Schema**-compliant validator (Zod/Valibot/ArkType/… via
   standardschema.dev), **and** raw JSON Schema accepted directly. `toJSONSchema()` feeds
   OpenAPI + MCP tool schemas.
2. **Input:** server **always** validates (trust boundary). Client **never** by default
   (types guard at compile time; avoids bundling the validator). Client validation is
   opt-in (§12).
3. **Output:** validate in **dev** (catch contract drift); **prod off** unless explicitly
   enabled (validating your own output every request is self-distrust + overhead).
4. **Files:** server-only. `maxBodySize` is the hard outer bound checked **pre-parse**
   (413 before buffering); then the `files` schema validates count/mime/size. Large files
   spooled/streamed, not fully buffered.
5. **Validation failure = built-in typed error** `ValidationErrorData { issues, fields }`
   (422/400), narrowed like any §9 typed error — a well-known member of every RPC's error
   union.

### Client-side validation opt-in

- **Binary flag on the client surface: `clients: { browser: { validate: false | true } }`.**
  Default `false` → nothing shipped. No structural middle tier.
- When `true`, the bundler ships the user's **actual validator** (+ schema) to the client and
  validates before `fetch`, so client and server reach the **same verdict** — full refinement
  parity including `.refine`/cross-field checks. The validator runtime is **shared across all
  opted-in RPCs** (amortized), independent of the server's validator choice.
- **Caveat:** the schema definition must be **client-bundleable** (pure, no server-only
  imports); if it isn't, abide falls back to structural JSON Schema (or warns).
- On failure the proxy throws the **same `ValidationErrorData`** locally (no round-trip).
  Server still re-validates unconditionally.
- **Files ride the same flag:** pre-flight count/mime/per-file-size checks **before
  uploading a byte** (reject a 2GB/wrong-type file instantly).

## 11. Type-derived schemas (TypeScript 7)

When no schema is given, synthesize input/output JSON Schema from the handler's TS types.

1. **Precedence:** explicit schema wins; absent → derive from types automatically. Derived
   JSON Schema is first-class: feeds server validation, client opt-in, OpenAPI, MCP.
2. **Runtime-enforced:** a handler `fn({ id: number })` with no schema still rejects
   `id: "foo"` server-side. Types become runtime guards.
3. **Loud on unrepresentable types** (not silent-permissive): types that don't map to JSON
   Schema (unbounded unions, branded/opaque, `Function`, uninstantiated generics,
   mapped/conditional) → `abide check`/build **warns loudly** (or errors, configurable),
   naming type + field. Codec-native types get known mappings (`Date` →
   `{ type: 'string', format: 'date-time' }`, etc.) so they're representable.
4. **Output derivation unwraps the response wrapper:** `TypedResponse<T>`/`json(T)` → `T`;
   `jsonl`/`sse` → element type; `redirect`/`error` union members excluded from success
   schema.
5. **Build-time extraction**, emitted to `src/.abide/` as inspectable JSON Schema. Not
   computed at request time.

## 12. Streaming reads/writes

1. **Return type named `AsyncIterable<T>`** (true async iterable) or **`Stream<T>`** (when
   not quite). `Subscribable` is retired (ambiguous).
2. **A stream is a subscription, not a scalar value slot** — no `.peek` scalar, not in the
   hydration payload as a value. **SUPERSEDED (designed, not yet built —
   `replayable-streams.md`):** a stream whose slot is cached stores a **`ReplayableStream`**
   (buffered decoded chunks) rather than bypassing the cache.
3. **Coalescing at the subscription level:** identical-arg consumers **share one upstream
   connection, fan out to N** (ref-counted; torn down when the last leaves). **SUPERSEDED
   (designed, not yet built — `replayable-streams.md`): replay becomes available for an HTTP
   stream** — a cached streaming read/mutation would buffer decoded chunks and fan out
   **replay-then-live**, so a late joiner replays the transcript then continues. "No replay
   *by default*" still holds: replay is opt-in via `cache` (`ttl: 0` = coalesce-only;
   `ttl: n` = an `n`-ms late-join window). A *socket* remains the tool for an unbounded feed.
4. **SSR drains only to a flush boundary / deadline**, never blocking on an unbounded
   stream. Finite streams stream into HTML incrementally; infinite streams render the
   pending/initial frame and the live tail is established client-side post-hydration.
5. **Auto-teardown with the reactive scope:** unmount/`watch`-dispose fires the
   subscription's `AbortSignal`, closing the HTTP stream (decrements the shared-connection
   refcount).
6. **Anything can stream** — streaming is orthogonal to method. A `POST` can return
   `jsonl`/`sse` (progress, LLM tokens). A streaming mutation still runs its
   `invalidate`/`amend` broadcasts; stream-end = completion.

## 13. Multi-client exposure (humans **and** machines)

1. **One handler, three thin entry adapters.** Browser → fetch + cache + reactive proxy.
   **MCP** → an MCP **tool** (name = RPC name, doc-comment = description, input schema =
   tool input, output schema = result; streaming handler → streaming tool result). **CLI**
   → a subcommand (input schema → arg/flag parser, output → stdout json/formatted). Cache
   & reactivity are **browser-adapter only**; MCP/CLI are one-shot request/response.
2. **One positional argument, always a single object `{ ... }`** (or absent = zero-arg).
   Its properties *are* the MCP tool properties / CLI flags / JSON body; input schema
   describes that one object; cache key = `serialize(argsObject)`; type-derivation reads
   that one param's type. (Descriptive property names are load-bearing.)
3. **Default-on all three surfaces (A).** `clients.<surface>`: `true` = expose (no client
   validation), `false` = **not reachable from that surface at all**, `{ … }` = expose +
   configure. Exposure toggles are **curation/noise control, not access control.**
4. **Auth is surface-independent.** Whatever authorization a handler enforces (`cookies()`,
   bearer `ABIDE_APP_TOKEN` for CLI/MCP) runs identically for every adapter. If a tool
   shouldn't be called, it fails **auth**, not by being hidden.

## 14. HTTP semantics

1. **Reads (`GET`/`HEAD`): args object in the URL** (canonical-keyer → compact query
   param; GET has no body). Safe/idempotent, cacheable, coalesced. **Mutations
   (`POST`/`PUT`/`PATCH`/`DELETE`): args in the body** (value codec), may
   `invalidate`/`amend`/`refresh`; **not read-cached, not coalesced (today).** **SUPERSEDED
   (designed, not yet built — `replayable-streams.md`):** mutations would route through the
   cell too and **coalesce by default** (`cache: { ttl: 0 }` — dedupe identical *concurrent*
   calls, retain nothing after settle, so sequential mutations each execute); opt in to
   caching/replay with `cache: { ttl, shared }`, opt OUT with `cache: false`. The read/mutation
   split would narrow to the wire (method, URL vs body, CSRF) + the default TTL (`∞`/`0`).
2. **No request batching.** Coalescing (dedup identical in-flight) yes; batching (combine
   distinct calls in one tick into one round-trip) **no** — it couples requests (HOL),
   defeats per-URL HTTP/CDN caching, hurts visibility; HTTP/2 multiplexing makes N small
   requests cheap.
3. **`crossOrigin` defaults closed** — RPC endpoints are same-origin only (no CORS);
   `crossOrigin` opts a specific RPC into CORS with an allowed-origin list.
4. **`timeout` is bilateral** — both a client-side abort (`AbortSignal`) **and** a
   server-side deadline (handler execution + SSR scalar-read render), default
   `ABIDE_RPC_TIMEOUT`, per-RPC overridable. The server deadline gives SSR peek reads their
   own bound (closing the slowloris hole where only streams had a deadline). **`maxBodySize`**
   = per-RPC override of `ABIDE_MAX_REQUEST_BODY_SIZE`, enforced pre-parse.
5. **`cache` opt = the value-cache config for that RPC** (`{ ttl, shared, tags, … }`) —
   the in-memory reactive/coalescing cache (§2–§3, §8 tags), **not** HTTP `Cache-Control`.
   HTTP response caching, if wanted, rides response-init headers separately.
6. **`.raw(args, init?)` → raw `Response`**, full bypass of codec-decode, cache,
   coalescing, and reactivity — escape hatch for custom headers, binary/file downloads,
   hand-driven streams.

---

## Call surface (consolidated)

| Form | Meaning |
| --- | --- |
| `fn(args)` | smart read — cached, coalesced, reactive, SSR in-proc → browser fetch |
| `fn.raw(args, init?)` | raw `Response`, full bypass |
| `fn.refresh()` / `fn.refresh(args)` | eager refetch, keep stale visible (partial-args match) |
| `fn.invalidate()` / `fn.invalidate(args)` | drop cached slot(s), lazy reload (partial-args match; no arg = whole callable) |
| `fn.amend(args, value \| updater)` | swap retained value — value-form broadcasts server-side; server per-request updater-form errors |
| `fn.peek` | synchronous retained value |
| `fn.pending` / `fn.refreshing` / `fn.error` | reactive slot-state probes |
| `fn.watch` | trigger on change |
| `fn.isError(e, name)` | narrow a typed error |
| bare call on a streaming handler | returns `AsyncIterable<T>` / `Stream<T>` |

## RPC options (consolidated)

`{ schemas: { input?, output?, files? }, clients: { browser?, mcp?, cli? },
crossOrigin?, maxBodySize?, timeout?, cache: { ttl?, shared?, tags?, … } }`
(+ `stream` is not a flag — any handler may return a stream by returning `jsonl`/`sse`.)

---

## Deferred / parked (rule before implementation)

- **Byte-measuring wrapped third-party values** for the shared-cache ceiling (§2.4).
- **`.abide` template compiler** — second essential slice; only its reactivity substrate
  (§7) is shared and specced here.
- **Full socket API** (`tail`, `ttl`, `clientPublish`, `schema`, `clients`) — the socket
  multiplexer is used as the broadcast channel (§8) but its full surface is a later slice.
- **`src/app.ts` AppModule hooks**, `env(schema)` boot config, observability
  (`health`/`online`/`reachable`/`log`/`trace`), desktop `bundle`, `abide compile/cli`
  binaries, OpenAPI/MCP endpoint generation details — adjacent, not core-slice-1.
- **Auth mechanism itself** (how `cookies()`/bearer resolve to identity) — assumed present;
  §13.4 only fixes that it's uniform across surfaces.
