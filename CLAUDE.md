# abide - isomorphic type-safe framework for async interfaces for humans and machines built on bun and web standards

# project goals

* exclusively use bun apis and javascript native apis when they're available
* keep the api surface small, based on standards, and ergonomic with no ceremony
* maintain high visibility into the stack for debugging
* maintain a consistent runtime between all builds and environments
* isomorphism by default — same callable, same name, same *intent* on both sides
* uses typescript 7 for compiler
* valid typescript or javascript should always compile — in a `.abide` `<script>` that holds for every STATEMENT and EXPRESSION position; the one exception is `export`, because a `<script>` is not an ES module BOUNDARY (its body is inlined into the component setup, so the export has nowhere to go) and it is a deliberate compile error in both lanes
* small and low level client bundle built from compiled .abide
* value performance when all other conditions are met

# coding guidelines

* src is split three ways: `src/server/`, `src/ui/`, and `src/shared/` (plus `src/cli/`, `src/bundle/`, `src/test/`); import across them with the `$server` / `$ui` / `$shared` tsconfig-path aliases
* use bun apis - not node apis unless necessary
* favor imperative/procedural over heavy functional abstractions
* use simple loops (for, for of) and straightforward control flow instead of deep iterator chains or high generic combinators in tight loops
* keep objects and arrays monomorphic so the JIT can optimize them agressively
* minimize dynamic features and complex closures in performance critical sections
* never `await` a value that is usually already settled — guard it (`isThenable(v) ? await v : v`); an unconditional await costs a promise wrap and a microtask tick at every call site, and a template slot pays it per row
* detect the common shape and skip the general algorithm — the expensive general path is the fallback, not the default
* when a shared path gains a DEFAULT with exceptions, enumerate the exceptions from the call sites rather than inferring them — "every caller but one" is one grep away from being checked, and a missed exception fails silently
* use descriptive variable and function names instead of abbrevations
* write terse comments only when why is unclear. do not write comments where code is self explanatory — and when something was tried and reverted, record the MECHANISM, not just the outcome; an outcome-only note freezes the decision permanently
* use monomorphic types and narrowing/widening instead of ad-hoc or one use types
* use tailwindcss classes for styling, and prefer tailwind classes over style properties when possible.
* constants should be UPPERCASE_SNAKE_CASE always, including their files
* do not worry about backwards compatibility if there is a better way to do something at any level unless it changes a public api - then discuss
* be aggressive in refactoring when it reduces machinery or increases performance

# performance and measurement

> The method behind these rules — how to ablate, what is inherent, when a fix is NOT worth it, and the
> sweep checklist — is `docs/PERFORMANCE.md`. Its sibling `docs/SIMPLIFICATION.md` applies the same
> method to removing code without changing behaviour. Read the relevant one before starting a sweep;
> each ends with assignable territories and the evidence a finding must carry, so a session can put
> several agents on disjoint ground and get back comparable results.

* a performance claim is a RATIO against hand-written code in the same substrate — absolute ms from a DOM emulator describe the emulator, not the framework
* correctness tests cannot guard a performance contract: when the contract is "does less work", assert the work (nodes moved, allocations, calls) — the wrong implementation still produces the right output
* in a reactive system that means asserting WAKE-UPS, not values: count effect re-runs and body runs, because a reader that woke when nothing it reads changed still reads the right value
* a freshly built wrapper defeats an identity check — when a value is re-wrapped per run (a state envelope, a result record), `oldValue !== value` is always true and every propagation cutoff downstream of it silently stops working
* budget emitted code in three numbers: allocations per template node, microtask ticks per row, DOM nodes per list item
* a benchmark case earns its place by DISTINGUISHING implementations, not by being representative — a full reverse cannot tell a minimal keyed reconcile from a rebuild; a two-row swap can

> The authoritative design lives in `docs/spec/*.md`. This file is the hand-maintained public-API
> reference. Core model: three isomorphic primitives — **`state`** (own), **`memo`** (load), **`channel`**
> (subscribe) — and two transport laws over them: `rpc = memo + transport`, `socket = channel + transport`.
> `memo` is a generic memoizer (cache + coalesce + reactive read surface) whose dependencies are its
> DECLARED INPUTS: args = the cache key, no args = inferred from the body. RPC inputs/outputs are
> **JSON-serializable only**; the rich value codec applies only to hydrated non-RPC values.

# abide — Public API & Template Feature Reference

## Server — `abide/server/*`

### RPC helpers
| Import | Signature | Notes |
| --- | --- | --- |
| `abide/server/GET` | `GET(fn, opts?)` | Read-only. |
| `abide/server/POST` | `POST(fn, opts?)` | Mutating. |
| `abide/server/PUT` | `PUT(fn, opts?)` | Mutating |
| `abide/server/PATCH` | `PATCH(fn, opts?)` | Mutating |
| `abide/server/DELETE` | `DELETE(fn, opts?)` | Mutating |

Handler takes **one positional argument** — a single object `{...}` (or absent for zero-arg). Its
properties are the input schema / MCP tool props / CLI flags / cache-key args. Any handler may
return a stream (`jsonl`/`sse`). Reads put args in the URL, mutations in the body. A read's URL args
take **two forms**: the canonical `?__abide_args=<json>` blob machine callers emit (browser proxy,
test app, MCP), or **flat per-field query params** (`?key=beta&n=5`) for hand-testing/curl — each
coerced to its `input`-schema field type (no runtime schema → the raw string passes through). The
reserved transport params are namespaced (`__abide_args`, `__abide_from`) so they never collide with a
handler's own arg fields; the JSON blob wins when both are present.

**RPC `opts`**: `{ doc?, schemas?: { input?, output?, files? }, clients?: { browser?, mcp?, cli? },
middleware?, crossOrigin?, maxBodySize?, timeout?, memo?: false | { ttl?, crossRequest?, tags?,
throttle?, debounce? } }`. **`doc`** is the human description carried onto every generated surface —
the OpenAPI operation summary, the MCP tool description, and the CLI's `help`.
- **No schema** → input/output JSON Schema is **type-derived** (TS7), runtime-enforced, loud on
  unrepresentable types. The handler arg needs no annotation when a destructuring **default** types it
  (`GET(({ n = 0 }) => …)` derives `{ n?: number }`); an annotation or explicit generic still works.
  The default's VALUE is carried too, not just its optionality: `deriveSchema` reads the initializer
  off the binding pattern into the schema's `default`, which is what OpenAPI, the MCP tool schema,
  `help` (`default <value>` per flag) and the REPL prompt render. **Literals only** — a string,
  number, `true`, `false` or `null`. A call or a reference (`= Date.now()`, `= FOO`) has no value at
  derivation time, so none is recorded rather than invented, and a nested pattern (`{ a: { b } }`) has
  no single name to key one on. A
  param field left `any` (no default, no annotation) still derives permissive `{}` but is now **loud**
  (a `deriveSchema` warning) — only a zero-arg handler or bare `unknown` stays silent.
- **Schema-first input** → passing a Standard Schema as `schemas.input` makes the handler arg type
  **flow from the schema's parsed output** (`GET(({ n }) => …, { schemas: { input: z.object(…) } })`;
  `n` is typed, no annotation). `schemas.output`, when a Standard Schema, is type-checked against the
  handler's return payload (a drifted return is a compile error at the call).
- **`clients`** = *reachability only*, typed `boolean | { browser?, mcp?, cli? }` — which surfaces
  reach it. **Not authorization** — auth is `middleware`. The three flags gate surface **generation**
  (OpenAPI omission, MCP tool list, CLI registration, client-bundle inclusion) at build time;
  middleware runs per read (see below) and can short-circuit. Different mechanism, different time.
  `false` withholds all three (the raw HTTP endpoint still exists — again, not auth); `true`/absent
  leaves all three reachable. An unrecognized key or a non-boolean flag **warns** on `abide:rpc`
  rather than being dropped in silence. There is no `clients.browser.validate` — it was advertised,
  never implemented, and is retracted (ADR 0027 D9): `clients` is reachability, and shipping a
  validator is a *bundling* decision that belongs next to `schemas`.
- **`middleware`**: `Array<(next) => Response>` — run **PER READ, not per request**, and no longer only
  over HTTP. `middleware` is not just auth: it is tracing, rate limiting, request-context population and
  response post-processing too, so a read that skips it is not merely unauthorized, it is unobserved. An
  in-process read — page SSR, a handler calling a sibling rpc, a cron tick — therefore runs it, where
  previously only the router did (`makeRpc` builds handler + memo + deadline; the chain was transport's).
  The chain wraps the **CALL**, never the memo body: a memo coalesces by ARGS, so a chain inside the body
  would let the first caller's authorization stand in for the next caller's. **Two rungs, two scopes:**
  this rpc's own middleware runs per READ; the app's global `config.middleware` is per REQUEST and runs
  wherever a REQUEST exists to authorize — which is the router at mount and the WS `@rpc:` join (which
  synthesizes a request-shaped scope precisely so it can run it), and nowhere else. A page with eight reads
  therefore runs it once, not nine times, and a scope-free read (a cron tick, a migration) runs the own rung
  ALONE: the global chain is where an app reaches for `request()`, and reaching for it from a door that has
  none would fail the read closed inside the middleware meant to observe it (ADR 0030 D4). A
  short-circuit reaches an in-process caller as a thrown `HttpError` (whether the middleware threw
  `error(403)` or returned a `Response`), and inside a page render a deliberate `error()`/`redirect()` is
  rendered at its own status rather than collapsing into a 500.
  Installed by `bindRpcChains`, which **every** boot calls — `createApp`, `abide dev`'s rebuild
  (`App.rebind()`), and `abide run` — so which door built the app cannot decide whether a read is
  authorized. `fn.raw()` is the one exception, by construction: it calls the handler, not the chained
  producer, so it is the one read surface that is neither coalesced nor authorized.
  **Inside the chain, `route()` names the READ** — `{ kind: 'rpc', name, params: args }` — not the caller
  who made it, so the `route().name === '<rpc>'` guard idiom holds from every door including page SSR
  (ADR 0030 D3). `request()`/`cookies()`/`context()`/`identity()` still answer the CALLER's request,
  which is the point of them; only the subject is overridden. From a scope-free door there is no request,
  so those throw while `route()` still answers — gate on `params`/the middleware's arguments, never on
  `url`, which an in-process read cannot answer truthfully.
- **`memo`** (unified across verbs; `docs/spec/replayable-streams.md`): `ttl` (ms; **reads** default ∞,
  **mutations** default `0` = coalesce identical concurrent in-flight calls, retain nothing — a mutation
  that sets `memo: { ttl }` retains like a read on **both** the server and client memo, so its
  the read `live` and the probes `refresh`/`refreshing` come alive), `crossRequest` (opt-in cross-request server cache;
  ambient-scope reads fail-closed; pure-over-args; callable from ANY caller, request or not), `tags`.
  **`tags` are isomorphic** — they no longer
  require `crossRequest`, so a tagged read's BROWSER memo registers too and a client-side
  `refresh({ tags })` / `invalidate({ tags })` re-runs every live slot of every rpc carrying the tag
  (one registration per rpc; a client proxy is a module singleton with one slot per args-key, and slots
  live for the tab, so this reaches args-keys no longer on screen). Registration lifetime follows the
  owner: module-level (every rpc proxy) stays for the process, a tagged `memo(...)` built inside a
  component `<script>` or a request unregisters when that scope disposes. A **server-side**
  `refresh/invalidate({ tags })` reaches browsers too: a tagged proxy joins the reserved `@tag:<tag>`
  mux channel on first read. That join is gated by DECLARATION — the tag must be named by at least one
  `clients.browser` read — rather than by the per-args middleware re-run an `@rpc:` join gets, because
  a tag frame carries a verb and **no payload**; the client then re-reads over HTTP under its own
  identity. So it grants no data, but it does reveal change-TIMING for any tag on a browser-reachable
  read — don't tag a browser read with a name or a rhythm that is itself a secret.
  **`memo: false` means "retain nothing", and what that costs is VERB-DEPENDENT** (`rpcMemoPolicy`,
  the one normalizer the server memo, the wire spec and the browser proxy all read, so the two sides
  cannot disagree). On a **mutation** it is a full bypass: the bare call skips the memo, every call
  runs, at-least-once, nothing coalesced. On a **read** the memo STAYS (a read needs its reactive
  surface) at `ttl: 0` — nothing is retained, so every call still runs cold, but identical concurrent
  calls still coalesce onto one run and `live`/`pending`/`refresh`/`error` stay live. This is
  bilateral: the browser memo is built from the same `ttl: 0`. It used to ship `ttl: null` (= the
  memo's Infinity default) and so cached a `memo: false` read FOREVER in the tab while the server ran
  it cold — one field, and the only observable was the WORK, which is why a value test never saw it.
  A `FormData` mutation body always bypasses (can't be keyed). A streaming handler that yields an
  `AsyncIterable` (or `jsonl(gen())`, which sees through to it) is stored as a **ReplayableStream**
  (replay-then-live; ttl clock from stream CLOSE; open streams pinned; per-stream cap
  `ABIDE_MAX_STREAM_BUFFER_SIZE`, default unbounded) so concurrent/late viewers share one run. Resume a
  retained transcript over `GET /__abide/rpc/<name>?__abide_args=…&__abide_from=<count>` (re-encoded in the handler's ORIGINAL
  encoding — jsonl resumes as jsonl, sse as sse). **Built:** primitive + memo + verb routing + shared
  streaming + json/jsonl/**sse** see-through (all lazy) + resumable endpoint + the **SSR→client hydration
  handoff** — a `{#for await}` over a known-RPC source seeds its decoded transcript so hydrate re-reads the
  source with NO client re-invoke: on hydrate `replayStreams` warms the RPC memo via `memo.seedStream` — a
  completed (mode-A) inline transcript, or an open (mode-B) **prefix + `?__abide_from=<count>` resume source** — and
  the block drains that warm memo (a non-RPC source still re-iterates). There is no separate DOM handoff; the
  server paint is a discarded placeholder. **`{#for await}` is REACTIVE (not one-shot):** its client mount
  wraps the drain in an effect subscribed to the memo's state signal (not per-chunk), so a
  `fn.refresh()`/`.invalidate()` — or a change to any reactive dep in the source expression — tears the list
  down and re-streams it (clear-and-restream); this holds for BOTH modes, and the chunk probes
  (`live`/`chunks`/`done`/`streaming`/`settled`/`error`) read the adopted transcript. **Client-side consumption:** the browser RPC
  proxy decodes a streaming response by content-type into an `AsyncIterable` (routed through the same memo),
  so `{#for await x of rpc()}` works in the browser identically to SSR; `sse` is also consumable via the
  native `EventSource`.
- **`timeout`**: the maximum time **without PROGRESS** (ADR 0028) — for a value that is time-to-settle,
  for a stream time-to-first-chunk then the inter-chunk gap (re-armed per chunk), so a healthy stream
  runs for hours. Default `ABIDE_RPC_TIMEOUT` (**5 min**, a fallback CEILING, not a tuned bound);
  `timeout: 0`/`Infinity` opts out and **warns** (it re-opens the rpc's own SSR streaming exemption).
  **Bilateral** = two INDEPENDENT enforcements of one number, not one timer with two ends: the client
  clock includes connect/queueing/body-read and so fires first for a browser call; the server's bounds
  the work. **Run-scoped and aborts the run** — the memo owns the run, so one coalesced slot yields one
  outcome for every joined caller. A **client abort** also kills the server's run *unless*
  `memo: { crossRequest: true }` (that slot outlives the request that started it). The handler gets the
  composed signal on **`request().signal`** — no new ambient — so the abort is COOPERATIVE: ignore it and
  the run continues, only the caller is released. A trip is a typed **`TimeoutError` / 504**
  (`fn.isError(e, 'TimeoutError')` narrows both sides) and the slot is **EXPIRED, not disposed**:
  `fn.error()` still reports it while the next read runs cold. `.raw()` bypasses the memo and the
  `middleware` chain, not the deadline.
- **`crossOrigin`**: CORS opt-in, **default closed** (no `Access-Control-*`; a cross-origin mutation is
  CSRF-rejected). `true` = allow any origin; `{ origin?: string | string[] | boolean, methods?, headers?,
  credentials?, maxAge? }` = an allowlist (`origin` string/array is exact; `true`/omitted = any). When
  set, the router answers the `OPTIONS` preflight, stamps `Access-Control-*` (+ `Vary: Origin` when the
  origin is echoed) on the response, and **exempts** an admitted origin from the same-origin CSRF gate.
  `credentials: true` forces the concrete-origin echo (the `*` wildcard is illegal with credentials).
  `OPTIONS` to an RPC without `crossOrigin` is a 405.
- **`maxBodySize`**: the ceiling on a mutation's request body, defaulting to
  `ABIDE_MAX_REQUEST_BODY_SIZE` (unset = no ceiling). A declared `content-length` over it is a **413**
  before anything is buffered; a chunked body that can't declare one is re-checked after the read,
  since a header can lie. The env var was documented in two places and read NOWHERE, so an rpc that
  declared no ceiling buffered an unbounded body — the default is now stated once, here.

**The declared verb is ENFORCED, not merely advertised.** A method that isn't the rpc's own is a
**405** carrying an `Allow` derived from the declaration — `GET, HEAD` for a read, the bare method for
a mutation. `HEAD` is the one verb the router derives rather than accepts (ADR 0027 D6), so it reaches
a `GET` handler and the body is dropped. This is load-bearing for auth, not tidiness: `auth.md` §AU8
rests the whole `SameSite=Lax` argument on "mutations are never on `GET`", and the top-level
cross-site `GET` that Lax still admits carries the identity cookie and skips the CSRF gate (which
exempts reads) — so a mutation reachable over `GET` is a CSRF hole whatever it was declared as.

### Response
| Import | Signature |
| --- | --- |
| `abide/server/json` | `json(data, init?)` → `TypedResponse<T>` (sees through to `data` in a memo-backed read/mutation) |
| `abide/server/jsonl` | `jsonl(iterable, init?)` → `StreamResponse<C>`, `application/jsonl` (lazy; sees through to the iterable → ReplayableStream) |
| `abide/server/sse` | `sse(iterable, init?)` → `StreamResponse<C>`, `text/event-stream` (lazy; sees through to the iterable → ReplayableStream, on par with jsonl; also consumable via `EventSource`; adds `Cache-Control: no-cache` + `X-Accel-Buffering: no`) |
| `abide/server/error` | `error(status, message?, init?)` → **`never`** (THROWS `HttpError`); `error.typed(name, status, schema?)` → a factory that throws. `init` is **`{ headers?: HeadersInit }`**, not a `ResponseInit` — the status is the first positional and the reason phrase is derived, so `error(503, m, { status })` is a compile error. Headers are the ONLY thing carried, and nothing auto-attaches one: `errorResponse` forwards exactly the headers it is given, so a `405` must pass its own — `error(405, msg, { headers: { allow } })`. `error.typed` takes no headers at all (its factory's one argument is the typed payload), so a typed 405 cannot carry an `Allow` |
| `abide/server/redirect` | `redirect(url, status=302, init?)` → **`never`** (THROWS `Redirect`); `status` is the literal union `301 \| 302 \| 303 \| 307 \| 308` and `init` is `{ headers?: HeadersInit }` |

**Both THROW; neither returns a `Response`.** `rpc = memo + transport`, so a handler IS a memo body and
a memo's failure channel is a throw — throwing is what puts the failure in the slot's error channel
(`fn.error()`), keeps it out of the value channel, and reaches an in-process caller as a `catch`.
TRANSPORT is the other half: the router renders a thrown `HttpError` at its own status (and a `Redirect`
as a 3xx + `Location`), and the browser proxy decodes a non-2xx back into the same `abide/shared/HttpError`,
so `fn.isError(e, name)` narrows identically on both sides. A DELIBERATE outcome is answered before
`onError` and never becomes the generic 500 — a declared 404 is not a bug in the app.

Returning a `Response` was wrong in both directions at once, and each direction hid the other: a handler
that `return`ed `error(404)` reached an in-process caller as a resolved `Response` **value** — which a
read at `ttl: ∞` then retained as that slot's value forever, so a transient upstream failure poisoned the
cache permanently while `fn.error()` still reported `undefined` — and a handler that threw reached the
wire flattened to a bare **500** with its status lost. A value test could not see either: the poisoned
slot returned the "right" object, and only the WORK and the CHANNEL were wrong.

Throwing also RETIRED type machinery rather than adding it. `GET(({ fail }) => fail ? error(503) :
{ greeting })` still infers `{ greeting }`, because a `throw` is `never` and a union absorbs it — so the
`OutcomeResponse` brand and `Payload<R>`'s outcome branch are both gone. They existed only to keep a
RETURNED `Response` out of a handler's success type; making the helpers throw removed the thing they were
hiding instead of hiding it better.

Transport-layer code that needs the `Response` VALUE (the router's own 405/CSRF rejections) builds it
with the internal `errorResponse(status, message?, options?)`; `outcomeResponse(caught)` is the single
place a thrown `HttpError`/`Redirect` becomes a `Response`, shared by the router and an rpc's `.raw()`.

**Baseline response headers** — the router stamps every response at one choke point, each only when the
response didn't already set it (so a handler/helper/middleware stays in control): `X-Content-Type-Options:
nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` on all; `Strict-Transport-Security` in
production; `X-Frame-Options: SAMEORIGIN` on HTML documents. Any response without its own `Cache-Control`
defaults to `Cache-Control: private, no-cache` + `Vary: Cookie` (identity-scoped by default) — content-
addressed `/__abide/chunk/` assets opt out by declaring their own immutable long-cache. **Every** response
carries `traceparent` + `traceresponse`: the router mints a traceparent per request when none came in
(propagating a well-formed incoming one), so the trace is a property of the request rather than of whether
a handler called `trace()`. The one exemption is the `/__abide/chunk/` asset — static, identity-free,
immutable, cross-user-shared, and joined by no span. "Every" is now literally true: the stamping used to
be inlined per route class, and the four that short-circuit early — the CSWSH reject, the CORS preflight,
the CSRF rejection, the first-load document — had each acquired a different subset of it (a
`traceparent`-less 403; a CSRF rejection with no `Access-Control-Allow-Origin`, so the browser reported
an opaque CORS failure instead of the 403 it was handed). Every response now leaves through one `exit()`
whose stages are declared rather than optional, so a new exit path cannot skip one by not mentioning it.

A **first-load HTML document** also carries `Vary: Abide-Nav, Abide-Nav-Keep`. It shares a URL with the
soft-nav JSONL response, differing only by those request headers, so both representations must declare
them — only the soft-nav half used to, which left a cache free to serve a page fragment to a first load
(`Vary: Cookie`, the identity-scoped default, does not key them apart; nothing about the cookie differs).
`Abide-Nav: <from-path>` marks the request a soft nav and names the route being LEFT; the router derives
`sharedLayoutDepth(from, to)` from it for a caller that declares nothing. `Abide-Nav-Keep: <n>` is how
many outer layout levels the client is KEEPING, and where sent it **decides** the render
(`levels.slice(keep)`) — because the derivation answers what the route TABLE permits (static) while what
a LIVE page can keep depends on things the server cannot see: whether a chain is mounted, claimed,
graftable. The two used to be derived independently and reconciled at runtime, with the client
hard-loading on a mismatch; one derivation makes that unrepresentable. Clamped to the route's own depth,
malformed → fall back to the derivation. A **same-URL** nav sends `0` so the whole tree renders and the
seed carries the kept layouts' reads, which is what makes clicking the page you are on refresh all of it
(`docs/spec/abide-compiler.md` C6-nav).

### Sockets
| Import | Signature |
| --- | --- |
| `abide/server/socket` | `socket<T, Args=void>(opts?)`; opts: `{ channel?, clientPublish?, schema?, clients?, middleware? }`. A transported form **nests** its primitive's options rather than flattening them (ADR 0027 D1), so the pub/sub knobs are the channel's own — `channel: { tail?, maxAge? }` — and a socket adds only transport + authorization vocabulary. `maxAge` is the per-MESSAGE age window; it is deliberately NOT `ttl`, which everywhere else means a memo's per-SLOT retention — and it is `maxAge` the WHOLE way down now (`ChannelHub`, the registry entry, the client spec, the browser proxy), not a name that reverted to `ttl` once it left the authoring surface |

`Socket<T, Args=void>` is an isomorphic `AsyncIterable<T>` with an **identical surface on both sides**
(one `.d.ts`): `for await` + `publish(msg): void` + the reactive memo-probe vocabulary — `live()`
(latest, `maxAge`-windowed), `peek()` (the same latest, but subscribing to nothing and opening nothing),
`chunks()` (session transcript, `tail`-capped), `pending()`/`refreshing()`/`settled()`/`streaming()`/
`done()`/`error()`. On a socket `settled()` is the subscription having ENDED (client-side, that is the
error terminal; the in-proc server channel is eternal, so it rests at `false`) and `streaming()` is it
being live — including through a transient reconnect, which has not ended anything. A `.abide` that imports a socket from `server/sockets/<name>.ts` gets the real hub
on the server and a **browser proxy** (the RPC-style module-swap) on the client — same import, same name.
Subscribe by iterating; **publish via `socket.publish(msg)`** (server always; client when `clientPublish`
admits it; fire-and-forget). ACTIVE reads (`iterate`/`live`/`chunks`) open a subscription over the shared
WS mux; STATUS probes only observe it.
- **`clientPublish`** = `false | true | fn`: `false`/omitted = clients may not publish · `true` =
  unmediated · a **function** `(msg) => T | DROP` = mediated (transform the untrusted message, or `DROP`
  to suppress). The fn form REPLACES the old `handler` — the mediator *is* the permission, so a mediator
  on a closed path is unrepresentable (a server `publish` always bypasses it).
- **`Args`** names the ROOM (ADR 0023). `Args=void` = single topic (today's socket); a non-void `Args`
  gives per-room isolation — `sock({room})` iterates a room, `sock.publish({room}, msg)`/`sock.live({room})`
  address it. **`middleware`** authorizes each room subscribe+publish (the socket analog of an rpc's
  middleware; absent ⇒ connect-authed). Rooms + auth key the same way on both sides (server + client proxy). Under SSR a socket iterates as **tail-snapshot-then-complete** (never hangs
the render); the client re-subscribes live on hydrate. HTTP face `/__abide/sockets/<name>` (SSE
subscribe / POST publish). Server-side cache broadcasts ride authorized `(rpc,args)` channels on the
mux. Full design + transport protocol: `docs/spec/client-sockets.md`.

### Request scope (imported ambient accessors)
| Import | Signature |
| --- | --- |
| `abide/server/request` | `request()` → `Request` |
| `abide/server/cookies` | `cookies()` → `Bun.CookieMap` |
| `abide/server/server` | `server()` → `Bun.serve` instance |
| `abide/server/context` | `context()` → per-request mutable carrier bag |
| `abide/shared/route` | `route()` → `{ kind, name, params, url, navigating }` (isomorphic) |
| `abide/shared/identity` | `identity()` → principal, **isomorphic** (never null on either side). SERVER: what the bearer/cookie ladder resolved for this request. CLIENT: the principal the SERVER resolved for the page — seeded at hydration, re-adopted on every nav, and **reactive**, so a component reading it re-renders when it changes (an identical re-adopt wakes nobody). Outside a request on the server it THROWS, which is load-bearing: a `memo({ crossRequest: true })` body runs scope-exited so touching it fails closed rather than baking one caller's identity into a shared slot. **Writes are server-side by physics** — `.set(p)`/`.clear()` need the secret and the response, so in a browser they throw and name the fix (call a login/logout rpc). `.refresh()` is the client's half: re-ask `/__abide/identity` after a login mutation and wake every reader; a no-op on the server, where the scope cannot be stale |

### Config
| Import | Signature |
| --- | --- |
| `abide/server/env` | `env(schema)` → typed, boot-validated config; result type is **inferred from the schema** (schema-first, no `<T>` to repeat; field-spec map + Standard Schema). `env<T>()` (no schema) = best-effort pass-through — `T` is a compile-time annotation, not runtime-enforced |

### Beyond the browser
| Import | Signature |
| --- | --- |
| `abide/server/agent` | `agent(engine, messages, options?)` → `AgentFrame` stream. `options`: `{ model?, system?, tools?, approval?, … }`. **`tools` defaults to the app's own `clients.mcp` RPCs**; `[]` = none, `[...]` = a subset. `clients.mcp` IS the gate — an agent's tool set is the MCP tool set by definition — so an rpc withheld from MCP is withheld here, by the same declaration, and naming `tools` is the OVERRIDE rather than the way in. Reachability, not authorization: a tool that IS reachable still runs its middleware on every call — and the loopback's remaining reason is now narrower than it was. A tool call goes out over the app's **OWN HTTP loopback** (`callOwnRpc`) rather than invoking the callable, because the args were written by a MODEL and are therefore untrusted: `schemas.input` validation is applied by the ROUTER, so an in-process call would advertise a schema to the model and never enforce what it sent back. The rpc's `middleware` is no longer part of that argument — it runs per read from any door now (see `middleware` above) — but input validation still belongs to the doors that admit caller-supplied args, and a model is one. One loopback request applies the whole chain verbatim (CSRF, identity, middleware, validation, memo, run deadline) with no second copy of any of it. Consequences of that door: a non-2xx is a THROW (an error tool-result the model can correct from, not a "result" for a call the app refused), a streaming rpc is DRAINED into an array (a model reads a VALUE, not a cursor), and outside a request scope the call goes **anonymous** — it inherits the enclosing request's credentials when there is one, and there is no ambient elevation to a principal nobody presented. MCP dispatches through the same door. `agent()` itself imports no registry (it stays usable with no app at all, where the default is `[]`) — `createApp` provides the surface, lazily. Types: `NeutralMessage`, `AgentFrame`, `AgentSurface`, `AgentEngine`. Ships a Claude engine (Anthropic Messages API over `fetch`) + a Claude Code engine (spawns the local `claude` CLI via `Bun.spawn`; **self-contained** — runs its own loop, engine tools OFF by default). |
| `abide/server/appDataDir` | `appDataDir()` → per-user data dir |

## Isomorphic — `abide/shared/*`

### Reactive primitives
| Import | Signature |
| --- | --- |
| `abide/shared/state` | `state(initial, transform?)`; `.shared(key, initial)` (cell shared by key across instances + tabs via `BroadcastChannel`; `.shared` degrades to per-render on the server). `state` keeps only what it OWNS (ADR 0024) — derivation is `memo`'s job. A cell is CALLABLE: `x()` tracked read, `x.set(v)` write, `x.peek()` read WITHOUT subscribing. **One word, one meaning, all three primitives** — `state.peek()`, `memo.peek()`, `channel.peek()` and `socket.peek()` are the same operation (read what is there; subscribe to nothing; acquire nothing). It was spelled `state.untracked()` until the reads were split, because `peek` then meant the reactive load-kicking read on the other two (ADR 0027 D2 renamed `state`'s own member AWAY from `peek`, to protect the word for the other two, on exactly that ground); that read is now `live`, which left `untracked` as a second name for an operation that already had one. `untrack(fn)` — the REGION wrapper — is unaffected and keeps its name: it runs arbitrary work with tracking suspended, where `peek` reads one cell. In a `.abide` `<script>` the compiler writes the calls for you. Scope-free reactive atom — **isomorphic**: usable in a plain `.ts` on either side, so server modules can own a value and other modules import + derive (`memo`) + subscribe (`watch`) from it. Module-level state is **process-global** (safe for derived/immutable-source graphs; for mutable cross-request/user state use `memo({ crossRequest })`). |
| `abide/shared/memo` | `memo(asyncFn, opts?)` — the memoizer. Its DEPENDENCIES ARE ITS DECLARED INPUTS (ADR 0024): declare an arg and they are the cache key (today's memo/RPC, unchanged); declare none and they are inferred from the body. An **argless + synchronous** body is AUTO-TRACKED and its bare call returns `T`, not `Promise<T>` (a promise-returning derived read would blank the SSR text and refill a microtask later). An argless **async** body is not tracked — half-tracked is worse than untracked — and re-fills on `refresh`/`invalidate` only. A **keyed + synchronous** body returns `T` too (`memo(({a,b}) => a+b)`; `v({a:1,b:2})` is `3`, not a promise) — its args are the whole dependency set, so the body runs UNTRACKED, one slot per key. The classification is the MEMO's, not the slot's, and it is made from the first run of the body on ANY key, wherever that run happens (a bare read or the load `live` kicks) — so one settled key answers for the rest. **The one gap:** a slot settled by `publish` or a hydration `seed` **before the body has ever run** cannot be classified, because nothing has produced the evidence, and its bare read stays a `Promise` until some key runs cold. Reachable through `memo.state()` on a sync memo (whose `set` IS `publish`), so a write-before-first-read hands a template a promise. Not fixed rather than fixed wrongly: the alternatives are running the body to classify it — unacceptable when the body is an rpc handler — or picking a default the first real run may contradict. `memo(source, transform)` tracks the source ONLY, transform untracked (mirrors `watch(source, handler)`). The source is ALWAYS an argless THUNK (ADR 0025) — the tracked region is its body, so several inputs need no API of their own: they are what the thunk returns (`memo(() => ({ a, b }), ({ a, b }) => …)`), and the transform still takes ONE argument. `ttl` and `crossRequest` are available on **every** form, sync included — retention and fill path are orthogonal (a memo can be tracked *and* retained). On a tracked memo `ttl` is the escape hatch for a body reading what the graph cannot see: the derivation re-runs once the window elapses even though no dependency changed (`ttl: 0` = re-run per read), and `crossRequest` only chooses which store the slot lives in. A `crossRequest` body runs **scope-exited on every path** (fail-closed checkpoint (a)) — touching `identity()`/`cookies()`/`request()`/`context()` throws, so the first caller's request can never be baked into a value later callers are served. That isolation is the WHOLE gate: `crossRequest` means ONE SLOT FOR EVERY CALLER **wherever the call comes from** — a request handler, a cron tick, an `abide run` migration, an `onStart` warmer all address the same slot, and none of them needs an active request scope. The read used to THROW outside one (a specced caller-side "checkpoint (b)", now retracted): it tested the mere presence of a scope rather than any authorization — an unauthenticated request passed it identically, and rpc authorization is `middleware` on the HTTP path — while covering only `fn()`/`live`/`chunks`/`done`, so a background job could `refresh`/`invalidate`/`publish` a slot it was forbidden to read. Which is exactly the job the option exists for. Since whether a memo is reactive is decided by what its body RETURNS, an argless memo that returns a promise **warns on `abide:memo`** (ADR 0027 D8): adding one `await` to a working derivation silently turns it into a manually-invalidated cache, so the loss is now announced and the message names the fix. A `(...args)`/`(args = {})` param is a LOUD construction-time error (it reports `fn.length` 0 and would silently reclassify an args-keyed memo). **`throttle`/`debounce`** are the SWR REFETCH CLOCK — two edges of one clock, so setting both is a construction-time error. They rate-limit **explicit revalidation** of a slot that already holds a value (`refresh()`, tag refresh, broadcast refresh): `throttle` fires on the leading edge then coalesces the window into ONE trailing load, `debounce` fires after quiet with every trigger restarting the window. Per SLOT, not per memo. They do NOT gate a **cold** load (nothing stale to serve), **`invalidate`** (which instead CANCELS a scheduled revalidation — deferring a discard would serve known-wrong data), or the **`ttl`-expiry re-fill** (already a leading-edge limit on the same slot; `ttl` bounds how long a value is served, the clock bounds how fast triggers may fire loads). During the window the retained value keeps being served — `await fn()` does **not** block on the deferred load — and `refreshing()` is true. On an **auto-tracked** memo the same clock gates what the derivation PUBLISHES — `memo(() => q(), { debounce: 300 })` keeps serving the admitted value while `q` moves and publishes the newest once quiet — though NOT how often the body runs (a derivation's deps are only knowable by running it). **This is how a read whose ARGS keep changing is rate-limited:** the load-path clock is per SLOT, so `getQuery({ q })` with a moving `q` is a cold load every time and `throttle` does nothing — debounce the INPUT and key the read on it (`getQuery({ q: slow() })`). The first publication is never deferred and the first real change still fires on throttle's leading edge. **Bilateral, and only recently so:** both fields are projected onto the wire spec by `RPC_SPEC_KEYS`/`rpcSpecOf`, so the BROWSER memo is built with the same clock. They used to be set on the server, typed on the client, and absent in the hand-written projection between them — so an rpc's refetch clock was server-only, with no symptom a type check or a value test could show. |
| `abide/shared/channel` | `channel<T, Args = void>(opts?)` — the pub/sub primitive on a `ChannelHub`; `socket` is its authorization+transport shell. Isomorphic (`shared/`), so a browser bundle carries it. `Args` names the ROOM and is a positional that vanishes when void: `ch.publish(msg)` + iterate `ch` directly for the single topic, `ch.publish({ room }, msg)` + `ch({ room })` for a roomed one. |
| `abide/shared/watch` | `watch(source, handler)` / `watch(thunk)` — auto-tracked effect; fires server-side too. The source is ALWAYS an argless THUNK (ADR 0025): `watch(() => count, handler)`. Several inputs are what the thunk returns — `watch(() => ({ a, b }), (next, previous) => …)`, where `next`/`previous` carry it. Either form may **return a teardown**, run before every re-run and once on disposal — which for a `watch` in a component `<script>` is that component going away: UNMOUNT on the client, END OF REQUEST on the server (a render is its whole life there). That is the lifecycle hook, in place of `onMount`/`onDestroy`, and it means an isomorphic effect can hold a real resource with no is-this-the-browser branch. The return is inspected, not required: a non-function return is ignored. |

`state`/`watch` are the sync/owned face of the same atom that `memo` (async/loaded) is built on — and `channel` is its push/subscribe face. The two transport laws follow the pull/push split: `rpc = memo + transport`, `socket = channel + transport`. All three primitives are isomorphic: same import, same call, both sides.

### Surface verbs (method form canonical; globals only for tags) — shared by `memo` AND `channel`
| Method (per callable) | Global (tags only) |
| --- | --- |
| `fn.invalidate(args?)` — partial-object match; `()` = whole callable | `invalidate({ tags })` |
| `fn.refresh(args?)` | `refresh({ tags })` |
| `fn.publish(args, value \| updater)` — argless callable: `fn.publish(value)` | — |

`publish`: value-form broadcasts server→clients (via the `(fn,args)` channel); updater-form is local
(client) or runs on a durable **shared** slot (server) — server updater on a per-request slot errors.
Partial args match every superset slot. The KEY is a positional that **disappears when there is none**:
an argless `memo`/void `channel` publishes `fn.publish(value)` with no `undefined` placeholder, a keyed
one names its slot/room first (`fn.publish({ id }, value)`). **Every verb with a TRAILING payload takes the key as a `Room` positional** — that is the rule, not a
list. Today there are three: `publish`, `fn.watch` (`fn.watch(handler)` vs `fn.watch({ id }, handler)`),
and `memo.state` (`m.state(initial)` vs `m.state({ id }, initial)`, ADR 0027 D7). Every other verb takes
its key last or not at all and already collapsed free from an omittable `void` parameter (`live()` vs
`live({ id })`). This is the rule `socket.publish(msg)`
has always followed, now declared once on the shared surface. (An RPC callable is the exception: a
zero-arg RPC infers `Args = unknown`, not `void`, so `rpc.publish(args, value)` still takes the arg slot.)

### Probes
| Method | Global (tags) |
| --- | --- |
| `fn.pending` / `fn.refreshing` / `fn.settled` / `fn.error` · the reads `fn.live` / `fn.peek` | `pending({tags})` / `refreshing({tags})` |
| the transcript read `fn.chunks` · `fn.done` / `fn.streaming` — surfaced only by the STREAM rpc types, but present on every `memo`/`channel`/`socket`, where a scalar slot answers them degenerately | |
| `done(iterable)` → boolean · `online()` → reactive boolean · `reachable(host)` → `await` boolean | |

**`settled` vs `done`, and why both exist.** `done` is `close()` ALONE. A stream carries three mutually
exclusive terminals — closed, failed, aborted — so a stream killed by a `TimeoutError`, by an
`invalidate`, or by the per-stream buffer cap answers `done() === false` **forever** while its consumers
have already thrown or returned. `settled` reads the union, i.e. "ended, however it ended"; `done` still
means "ended cleanly". A spinner rendered off `!done()` is a permanent spinner on all three failure
routes, and until `settled` existed the public surface could not see the difference — though
`ReplayableStream.settled` had named it correctly all along, which is where the name comes from.

`settled` is also the only way to tell a COLD slot from a settled one: `pending()` is false for both,
and neither read separates them either (a settled `undefined` reads exactly like nothing-yet). So
`!settled() && !pending()` is "never asked", and `pending` → `streaming` → `settled` is a total,
disjoint reading of a stream's life that `done` alone could not give (its `false` covered a scalar slot,
an idle slot, an open stream and a dead one).

**A PROBE OBSERVES; IT NEVER CAUSES.** The vocabulary splits three ways and only the first group
acquires: the ACTIVE **reads** `iterate`/`live`/`chunks` (subscribe + kick a cold load — `chunks` is the
transcript, and on a socket it is what opens the subscription at all, so `{#for m of feed.chunks()}`
fills); the untracked read `peek` (neither); and the **probes** `pending`/`refreshing`/`settled`/
`error`/`done`/`streaming`, which start no load, open no subscription, and move no LRU/retention
position. No exceptions — including on an **argless** memo, where classifying the body means RUNNING it.

This is stated as a rule because it did not hold, in two ways a value test cannot see. `done` reached
`startLoad` through the same helper `chunks` uses, so asking "has this finished?" is what started it. And
on an argless memo every probe that classified (`error`/`settled`/`streaming`/`done`) ran the body to do
so — on a deferred body that fires the LOAD, so `{#if job.settled()}` was what launched the job it asked
about. The price: a probe on an argless memo whose body has never run reports the cold answer (`settled()`
false, `error()` undefined) until a READ classifies it. That is honest — nothing has produced a value, so
there is no outcome — and it is exactly what `pending()` has always done.

A probe wakes for its OWN axis. `refreshing` is its own signal, not a field of the slot state, so a
spinner flip over a retained value wakes `refreshing` readers and NOT value/`live` readers — do not
assume `fn.refresh()` re-runs your `{await fn()}`. And a write that is observably identical (same
`status`/`value`/`error`) re-writes the same state object, so it wakes nobody at all: a `refresh`
recomputing the same result, a `publish` of the value already held, a ttl re-fill of unchanged data.
`value` is compared by IDENTITY, so a body returning a fresh object each run still propagates. The
one residual over-notification is deliberate: `pending`/`error` readers share the state, so a pure
value change still wakes them (`docs/spec/rpc-core.md` §7.3–7.4).

### Schema / errors / misc
| Import | Notes |
| --- | --- |
| `abide/shared/withJsonSchema` | `withJsonSchema(schema)` → Standard Schema that also exposes `toJSONSchema()` |
| `abide/shared/done` | `done(iterable)` → reactive boolean: has a `{#for await}`-consumed stream finished? |
| `abide/shared/online` | `online()` → reactive connectivity boolean (true on server; tracks `navigator.onLine`) |
| `abide/shared/ValidationErrorData` | `{ issues, fields }` — the `data` MEMBER, not the whole 422 body. The WIRE ENVELOPE a generated client reads is the typed-error shape every failure travels as: `{ status, statusText, message, name: 'ValidationError', data: { issues, fields } }` (declared once in the OpenAPI document under `components/schemas` and referenced from every operation's 422). It was described there as `{ issues, fields }` alone, so a generated client looked for `fields` one level above where it travels |
| `abide/shared/HttpError` | `HttpError` + `HttpErrorOptions` — the failure an rpc travels as, ONE class on both sides: what a handler's `error(...)` throws, what a `catch` narrows on, and what `fn.isError(e, name)` is built over after a non-2xx is decoded back into it — by the browser proxy on the wire, and by `throughChain` on the server when a middleware short-circuits an in-process read, which is what makes the two sides narrow identically. `HttpErrorOptions` is `{ kind?, data?, headers?, statusText? }` — a typed error's name rides on **`kind`**, not `name`, because `name` is the JS `Error` discriminator and stays `'HttpError'`; the `isTypedError` predicate accepts either, so a platform `DOMException` still narrows on `name` |
| `abide/shared/Redirect` | `Redirect` — the navigation a handler leaves through, as a throw. Its own class rather than a 3xx `HttpError`: a redirect is not an error, but it leaves the value channel the same way one does |
| `abide/shared/route` | `route()` (see above) |
| `abide/shared/identity` | `identity()` (see above) |
| `abide/shared/url` | `url(path \| URL, params?, query?)` — in-app href resolver; `params` fill dynamic segments (`[name]` required, `[[name]]` optional, `[...name]` rest — a `/`-joined string; typed from the path literal), `query` appends a query string. No-dynamic-segment path (or a `URL`) collapses to `url(target, query?)` |
| `abide/shared/health` | `health()` → `Promise<HealthDocument & HealthFields>` (both exported; `HealthFields` is the projection of your `onHealth` return, or `unknown` when nothing was generated — `T & unknown` is `T`, so the document stays exactly the baseline) — isomorphic and now SYMMETRIC IN CONTENT: the server composes the whole document in-proc (baseline `{ reachable, version, startedAt, uptime }` + `onHealth` merged over it), the client `await`s a fetch of `/__abide/health`, and `/__abide/health` is a wrapper that picks the status code and nothing else. It used to answer `{ reachable, version }` on the server and the full doc on the client, which is why its return type was an index-signature bag — nothing else was true of both sides. **The type is GENERATED**: `src/.abide/health.d.ts` (written by `dev`/`check`/`lsp`/`build`) augments `HealthAugmentation` with `Awaited<ReturnType<typeof onHealth>>`, so `(await health()).db` is typed where the hook declares it and a compile error where it does not. A tsconfig `include` wildcard skips dot-directories, so the tsconfig must name `"src/.abide/*.d.ts"` — the scaffold does; without it the companion is written and never read. **It answers with NO SERVER BOUND**: `abide run` provides the health source itself (`provideHealthSource`, clocked from load rather than from a bind that will not happen), so a migration script asking whether the app is healthy gets the app's own `onHealth` — which is what it was asking about, not about an HTTP listener it deliberately does not have |
| `abide/shared/log` | `log(...)`, `.info/.warn/.error/.trace`, `.channel(name)`. Every line carries a channel label — the un-channeled `log(...)` uses the **app name** (`ABIDE_APP_NAME`/package.json/`"abide"`, always on); `.channel(name)` names a channel gated by `DEBUG` (server) / `localStorage.debug` (browser). A **bare** name is QUALIFIED with the app name — `log.channel('cards')` in an app called `docs` labels *and gates* as `docs:cards`, so an app's channels namespace under it exactly as the framework's do under `abide:` and `DEBUG=docs:*` lights all of them, with no call site spelling the prefix. A name that already carries a namespace (a `:`) is verbatim: that is what keeps `abide:*` intact inside an app called something else, and the way to name a foreign namespace. Qualification is at EMIT time (framework modules build channel loggers at module load, `ABIDE_APP_NAME` is seeded at boot); the BROWSER has no env to read, so `abide build` bakes the name into the loader entry (`globalThis.__ABIDE_APP_NAME__`) — renaming the app takes a rebuild. `error` always emits; `warn/info/trace` gated. Framework channels: `abide:{bundle,cli,health,hydrate,identity,memo,router,rpc,socket,ssr,stream}` |
| `abide/shared/trace` | `trace()` → W3C traceparent \| undefined. **Isomorphic**: on the server it is the request's (minted for every non-asset request, so it always answers inside one); in the **browser** it is the trace ADOPTED from the request that rendered the live page, re-adopted on every nav (carried by the hydration seed, or by a param-nav confirm's `traceresponse`) — and **reactive**, like the other two adopted ambients (`route`/`identity`), so `{trace()}` in a binding re-renders when a nav adopts a new id. It used to live as a plain field on the reactive scope, which meant a binding rendered the first page's id and then showed it forever, and a component that mounted its own scope lost it entirely. The client never mints one — an id generated there would name a trace no server span belongs to — so it is `undefined` only before the first page hydrates. A browser **RPC call carries it as a CHILD span** (same trace id, fresh span id — W3C's caller-names-the-span rule; reads, mutations, `.raw`, stream resume), so the handler's work joins the page's trace. A **navigation carries nothing** by design: a nav is a new operation, and propagating would grow one immortal trace per tab. Cross-origin (`ABIDE_APP_URL`) the proxy declines to volunteer one (it would preflight every read); the server still accepts one — `traceparent` is in the default CORS allowed-headers |

## UI — `abide/ui/*` (client-only)
| Import | Signature |
| --- | --- |
| `abide/ui/props` | `props<T>()` |
| `abide/ui/html` | `html(str)` / `html\`…\`` |
| `abide/ui/navigate` | `navigate(path \| URL, { replace?, keepScroll? })` — target is an already-resolved href; compose params/query with `url()` (`navigate(url('/users/[id]', { id }, { tab }))`) |
| `abide/ui/bundled` | `bundled()` → boolean |

## Desktop bundle — `abide/bundle/*`
`BundleWindow` (`title`, `width`, `height`, `menu`, `config`), `BundleMenu`, `BundleMenuItem`
(separator / `emit` / `navigate`, optional `shortcut`), `onMenu(name?, handler)`.

## MCP / testing
| Import | Signature |
| --- | --- |
| `abide/test/createTestApp` | `await createTestApp(config?)` → `Promise<TestApp>` (`origin`, `fetch`, `rpc`, `socket`, `health`, `stop`, `as(identity)`) — real in-process app, not mocks. **Async**, two modes: naming any surface (`routes`/`sockets`/`pages`/`layouts`/`middleware`) = explicit hermetic app (today's behavior); naming none (`createTestApp()`/`{}`/only `{ dir, lifecycle }`) = **discovery** — loads the whole project from `dir` (default `cwd`) and boots its `onStart`/`onStop` (`lifecycle: false` skips the hooks). The `rpc` proxy sends each call under the rpc's **DECLARED** verb, read off the same `__rpc` meta the router enforces against; it used to hardcode `POST`, so a `PUT`/`PATCH`/`DELETE` rpc was simply unreachable through it (405). Discovery mode derives its schemas from **SOURCE**, which is the mode's whole claim ("the real app") stated as an argument rather than left to a default: it used to take `loadApp`'s `'baked'` default, so a project that had ever run `abide build` had its tests validated against the previous build's types |

## isometric RPC consumption (call surface)
This surface is **identical for reads and mutations** (full symmetry). A read (`GET`/`HEAD`) is an `Rpc`/
`StreamRead`; a mutation (`POST`/`PUT`/`PATCH`/`DELETE`) is a `MutationSurface` = `Mutation extends Rpc`
(value) or `StreamMutation extends StreamRead` (streaming) — every probe/verb below is present on both.
Mutations differ only in transport (args in body + CSRF gate) and the default TTL (`0` vs a read's ∞), so
`live`/`refresh`/`refreshing` reflect a retained value only when a mutation opts into `memo: { ttl }`.

| Form | Meaning |
| --- | --- |
| `fn(args)` | **the read** — awaitable `Promise<T>` (coalesced + cached; SSR in-proc → browser fetch). Also subscribes the caller, so `{await fn()}` re-awaits on invalidate. A mutation call is the same, but posts args in the body (default `ttl:0` retains nothing) |
| `fn(args, { signal })` | the same read with a caller-owned abort. It detaches **THIS waiter only** — the author's `timeout` owns the work, a caller's signal owns their wait — so it never strands the other callers coalesced onto the slot (a call that BYPASSES the memo — a `memo: false` mutation, or a `FormData` body — has no slot and one consumer, so it does cancel the request outright; a `memo: false` READ is still slot-backed at `ttl: 0` and so detaches the waiter only). This is why no per-call timeout option exists: `fn(args, { signal: AbortSignal.timeout(500) })` is one. Zero-arg: `fn(undefined, { signal })` |
| `fn.live(args)` | **the display read** — reactive `T \| undefined` snapshot; subscribes + kicks a coalesced load, so it fills in on its own. Spelled `peek` until the split |
| `fn.peek(args)` | **the untracked read** — `T \| undefined`, what the slot holds right now. No subscription, no load, and on a socket no subscription-open: asking costs nothing and changes nothing, so a lone `peek` reader never sees a value arrive. The ecosystem's meaning of the word, and identical to `state.peek()` — one operation, one name, every primitive |
| `fn.raw(args, init?)` | raw `Response`, full bypass of the memo — and, server-side, of the `middleware` chain with it: `.raw` calls the handler, so it is the one read surface that is neither coalesced nor authorized. It is the RESPONSE surface, so a deliberate `error()`/`redirect()` is **rendered as that Response** rather than rethrown — matching the browser proxy's `.raw`, which hands a non-2xx back untouched (no parse, no `!ok` throw), so the two sides answer the same shape. An unexpected error still propagates: only transport turns a genuine bug into a 500, and doing it here would disguise one as a normal response |
| `memo.state(args, initial)` | the WRITABLE PROJECTION of one slot (`memo` only): a live cell over that slot whose `set` IS `publish`, so a local write is provisional until the next re-fill. The key is a `Room` positional and the `initial` trails it (`m.state(initial)` argless, `m.state({id}, initial)` keyed) — required on an **async** memo because a cold slot has no value and `State<T>` is invariant, so widening the read would also let `set` forge the not-loaded sentinel. A **sync** memo needs none: it is never pending and rethrows, so its read is already `T`-or-throw |
| `fn.refresh(args?)` / `fn.invalidate(args?)` / `fn.publish(args, v)` | surface verbs (partial match) |
| the read `fn.live` · `fn.pending` / `fn.refreshing` / `fn.settled` / `fn.error` / `fn.watch` | reactive probes (`live` is a READ — it subscribes and kicks a load; the rest observe) |
| `fn.isError(e, name)` | narrow a typed error |
| bare call on a streaming handler | resolves to a fresh replay-then-live `AsyncIterable<C>` cursor (per caller, over one shared run) |
| **streaming read/mutation** `StreamRead<Args, C>` / `StreamMutation<Args, C>` | any handler (read OR mutation) that yields an `AsyncIterable<C>`; keeps the whole probe vocabulary, re-typed over the CHUNK: `fn.live(args): C\|undefined` (the **latest chunk** — the "current value"), `fn.chunks(args): C[]\|undefined` (transcript snapshot), `fn.done(args)`, `fn.streaming(args)`, `fn.settled(args)`, `fn.error(args)`, plus `fn.pending(args)`/`fn.refreshing(args)`. It does not *replace* the value probes, it re-types them — the nine names are ONE declaration in four interfaces: the two halves `ReactiveValueProbes` (`live`/`pending`/`refreshing`/`settled`/`error`) + `ReactiveStreamProbes` (`chunks`/`done`/`streaming`), the untracked read `UntrackedRead` (`peek`) — split out because every probe is annotated "Reactive" and that one is the negation of it — each parameterized by value type and by ARG-TUPLE, and `ReactiveProbeSurface`, the combiner at the PRIMITIVE arity (key last-or-only) that `memo`, `channel` and `socket` extend. `Rpc` and `StreamRead` skip the combiner and instantiate the two halves directly with their own tuple, because an rpc's arg is optional — a zero-arg rpc infers `Args = unknown` rather than `void`. They used to be hand-copied into five interfaces that extended nothing, and had already drifted — `StreamRead` declared no `refreshing` while `Rpc` next door did, though `makeRpc` had been assigning it all along. A streaming mutation is consumed client-side via `{#for await x of fn()}` identically; only the `?__abide_from=` HTTP RESUME endpoint stays read-only |

## `.abide` template grammar

### Reactive state (script)
| Form | Meaning |
| --- | --- |
| `let x = state(v, transform?)` | writable cell |
| `const d = memo(() => …)` | derived value — auto-tracked, lazy, never serialized. A bare `d` reads the VALUE (so does `d.length`); the memo's own surface is not reachable through the binding |
| `let x = memo(…).state(initial)` | the writable projection: `set` IS `publish`, so a local write holds until the next re-fill. `initial` is required on an async memo (cold slot), omitted on a sync one |
| `memo(() => a, (v) => …)` / `watch(() => a, h)` | declared dependencies — the source is a THUNK and its body is the tracked region (ADR 0025); a bare cell there is an ordinary read, i.e. a type error |
| `memo(() => ({a, b}), ({a, b}) => …)` | several declared inputs — just what the thunk returns |
| `state.shared(key, initial)` | writable cell shared by key across instances + browser tabs |
| `watch(source, handler)` / `watch(thunk)` | reaction / auto-tracked effect |
| `const { name = fallback, ...rest } = props()` | reactive prop reader |

### Bindings / directives
| Form | Meaning |
| --- | --- |
| `{expr}` | reactive text (escaped) · `{html(...)}` raw |
| `name={expr}` | reactive attribute (whole-value expression) · `on<event>={fn}` native listener (`oninput`/`onclick`/…) on an ELEMENT. On a **component** the same syntax is an ordinary **prop** named `onclick` — there is no element to attach a listener to, so the component places it itself. Both emitters pass it; the server used to drop it while the client passed it, which made SSR and hydrate disagree about the props a component received (`<Btn onclick={go}/>` rendered `none` server-side and `has` after hydrate) |
| `name="…{expr}…"` | quoted values interpolate too (reactive) — mixed literal + `{expr}`, also on component props; a literal brace is `{'{'}` |
| `bind:value` / `bind:checked` / `bind:selected` / `bind:group` / `bind:value={{get,set}}` | two-way binds (also on component props). The target NAME selects one of four kinds, and both lanes read the one taxonomy (`bindTarget.ts`): `element` (a node ref — client-only, nothing is rendered for it during SSR), `group` (radio/checkbox membership, compared against the input's own `value`, never emitted as a `group` attribute), **`boolean`** (`checked`, `selected` — a boolean DOM property mirrored as a boolean attribute: present iff truthy, never stringified) and `value` (everything else — read the property, write back on input/change). It is a NAMED SET rather than a `checked`-only test because that test is how `selected` came to mean two things: the server wrote a boolean attribute while the client's ladder fell through to the value bind, so `<option bind:selected={x}>` rendered `<option selected>` and then assigned `option.value = "true"` on hydrate — a correct SSR paint clobbered by the bind. The ACTION stays per-substrate (one writes an attribute string, the other attaches a listener and mirrors the property the target names); only the classification is shared |
| `class:name={cond}` / `style:prop={value}` | toggle class / set one property. **ELEMENTS ONLY** — on a component it is a compile error in both lanes, because the directive targets one element and a component renders a subtree (possibly several roots, possibly none). Pass a prop and let the component place it: `<Card class={…}/>`. It used to be typed as a component prop by `abide check` and silently DROPPED by both emitters, so the author was told it was valid and nothing rendered |
| `bind:element={cell \| fn}` | node ref (cell) or per-instance attachment+teardown (fn) |
| `{...expr}` | spread props (component) / attributes (element) |

### Control flow
| Block | Branches |
| --- | --- |
| `{#if}` | `{:else if}`, `{:else}` |
| `{#for item, i of list by key}` | keyless → positional (dev-warns if body is stateful); `{#for await}` + `{:catch}` |
| `{#await p}` | `{:then}`, `{:catch}`, `{:finally}`; inline shorthand `{#await p then v}` / `{#await p catch e}` (body = that branch, no pending — the compact blocking form) |
| `{#switch}` | `{:case}`, `{:default}` |
| `{#try}` | `{:catch}`, `{:finally}` (JS-semantics error boundary) |
| `{#component Name(props)}` | **inline component** — a reusable builder; name must be **TitleCase** (a lowercase name is a parse error — lowercase is reserved for element tags); invoked as a tag `<Name/>` **only** — the call form `{Name(…)}` is a compile error (an interpolation renders text; a component is a tag). Passable as a first-class value/prop — a component-valued prop is likewise rendered `<Render/>`, never `{Render()}`. A nested `{#component X()}` inside `<Foo>…</Foo>` becomes Foo's `X` prop. It takes **one** parameter: its children arrive through `<slot/>`, which resolves them off the scope the invocation convention already fills, so there is nothing to declare — and a second parameter named `children` is a compile error, because an inline component's params are bound onto the same scope object the outlet reads (it would collide with the children, not shadow them). |

### Async reads
| Form | Meaning |
| --- | --- |
| `{fn.live(args)}` | non-blocking `T \| undefined` snapshot; `undefined` while pending, reactive — subscribes AND kicks a coalesced load, which is what makes it fill in on its own |
| `{fn.peek(args)}` | the UNTRACKED snapshot: what the slot holds right now, `undefined` if nothing. Neither subscribes nor loads, so it never updates on its own — the escape hatch, not the display read |
| `{await fn(args)}` | the read — blocks SSR (value in initial HTML); on the client fills the text node when the read settles (nothing suspends); re-awaits on invalidate, and on a `refresh` that lands a DIFFERENT value (an identity-equal re-fill wakes nobody — see Probes) |
| `{#await fn(args)}` | reactive await block: `{:then v}` (`v: T`) / `{:catch}` / `{:finally}` |
| `{#await fn(args) then v}` | inline blocking form: `v: T` bound in the opener, body renders once settled (no pending branch) |
| `{fn(args)}` (bare) | **a `abide check` error** — "this is a Promise — write `{await expr}` so it types as T". A **concept boundary**, not a typing accident (ADR 0027 D3): the three forms above do three different things (`await` blocks · `live` doesn't · `{#await}` branches), and the bare call is the *awaitable*, not a fourth read. It is not the non-blocking form — on the server it is the BLOCKING one, since `emitServer` auto-awaits every expression slot: the await is GUARDED (`isThenable(v) ? await v : v`) but still type-blind, so a thenable suspends the slot either way and a bare read renders identically to `{await fn(args)}` while typing as `Promise<T>`, which dead-ends at the first `.field`. Making it mean "non-blocking" would also break the project's first law: a plain `.ts` has no compiler, so `fn(args)` is a `Promise<T>` there regardless, and one expression would mean two things by file extension. The auto-await stays a backstop for the untyped/passthrough path (a `T \| Promise<T>` union is deliberately still legal) |
| `fn.pending()` / `fn.refreshing()` / `fn.settled()` / `fn.error()` · stream-only `fn.streaming()` / `fn.done()` | probes — they observe, so none of them starts a load or opens a subscription |

### Components / pages
| Feature | Notes |
| --- | --- |
| Capitalised tags | component invocation (`<Name/>`) · `<slot/>` renders default children, and is the **only** spelling of the outlet — `children` is a RESERVED template name (it is what the outlet resolves off the scope), so a free `children` in any expression position is a compile error naming `<slot/>`. `{children()}` used to be a documented equivalent, carved out of the very law next door ("an interpolation renders text; a component is a tag") — an outlet renders a subtree, so it is a tag for the same reason a component is. Reserved in **two** positions: a REFERENCE (every expression position — interpolation, attribute value, block head) and a **BINDING** — the `{#for}` item and index, a `{:then}`/`{:catch}` param, and an inline component's params, all of which PUBLISH onto the same `$scope` chain the outlet reads, so inside that body `<slot/>` resolves to the binding and renders the ITEM. The binding half is the one the reservation exists for and was the last to arrive: the reference check sees expressions only, so it reached `{#for children of …}` solely when the body happened to spell the name — and a body using `<slot/>`, the spelling this row mandates, never does. Only a LEXICAL `children` (a `<script>` binding) is exempt · nested inline-component defs = named component props (render-prop) · a cell- or memo-named tag (`const C = memo(…)`; `<C/>`) is a **reactive** component (re-mounts on change) · a component-valued prop types as `Component<Props>` · a tag may be a **member path** (`<item.Icon/>`, `<Icons.Chevron/>`): the head is any binding in scope **spelled `[A-Za-z_][A-Za-z0-9_]*`** — a `$`-prefixed binding is legal JS but not a member-tag head, since the tag pattern admits no `$` — and TitleCase applies to the NAME, i.e. the LAST segment (`<item.icon/>` is a parse error). Reactive like a cell-named tag — it is an expression, not an import. A dot marks it, and a HYPHEN keeps a dotted tag an element (`<my-el.foo>` is legal HTML) |
| `<script>` per-instance · `<script module>` once-per-module · nested `<script>` branch-local (per-ITEM in a `{#for}`; must be the FIRST node of a block body, carries no `import` — it reuses the component's — and its bindings resolve off the level's `$scope`, so they shadow inside the branch and are invisible outside it). **No `<script>` takes an `export`** — none of the three is an ES module BOUNDARY: each body is inlined into the emitted component's setup (`$ensureModule`/`render`/`mount`), so an `export` there lands inside a function and is a syntax error. It is a compile error in **both** lanes now (`abide check` and `abide build` ask the one gate); it used to be skipped by the scanner, so `export const x = 1` bound exactly like `const x = 1` and the only symptom was a parse failure over GENERATED source. A top-level binding is already visible to the template and to every nested `<script>`; a prop is `const { x } = props()`; a value shared across FILES belongs in a `.ts` module you import |
| `<style>` component-scoped · nested `<style>` subtree-scoped (an element carries every scope in force, so an outer rule reaches in and an inner one cannot reach out) · tailwind optional |
| `src/ui/pages/**/page.abide` / `layout.abide` | routes; `[name]` → `route().params.name` (required); `[[name]]` optional segment (absent → param omitted); `[...name]` rest/catch-all (terminal) → `route().params.name` is the `/`-joined remaining segments. Precedence: literal > required > optional > rest |
| `route()` | `route().url`, `.params`, `.name`, `.kind`, `.navigating` |
| `navigate` / `url` | `url(path, params?, query?)` builds an href; `navigate(target, options?)` moves to one — compose as `navigate(url(...), options)`. Nav always hits the server (middleware); same-route param/query nav = a pure `route()` republish (reads re-fire reactively in place — no DOM swap, no re-hydrate; scroll/focus preserved). That nav's server round-trip is a background middleware/redirect confirm AND the fresh values: the confirm is a FULL render, so the client DRAINS its frame stream for the trailing `seed` and replays it into the live mount's rpc memos (`replaySeedIntoProxies`), re-adopting `identity()` (a fresh request's middleware may have resolved someone else) and `trace()` (off the confirm's `traceresponse`, the earliest carrier — a nav that never hydrates would otherwise keep answering with the previous page's id, which points at the wrong span). Only the `seed` frame is applied — the shell and `fill`/`append` patches address the server's freshly-painted DOM this nav deliberately did not adopt. The body used to be discarded on the premise that the kept page's reads have already re-fetched reactively, which holds only for a read the nav actually MOVED: a param-keyed read lands on a new cache key and loads cold, while a read taking no args and reading no `route()` has nothing to re-fire on — so on a nav to the URL you are already on NOTHING re-fired, and the server recomputed the whole page for an answer that was thrown away. A cross-route nav sharing a layout prefix keeps the shared outer layouts alive and grafts/claims only the diverging suffix (fully-disjoint route = whole-outlet swap) |

## App module — `src/app.ts`
`export const middleware = [(next) => Response, …]` (onion; `next()` needs no args; return a
`Response` — or call `error(403)`/`redirect(...)`, which THROW — to short-circuit; **auth is
middleware**). This is the **per-REQUEST** rung — an rpc's own `opts.middleware` is the per-READ one
(ADR 0030). It runs wherever a request exists to authorize and nowhere else: once per HTTP request however
many reads that request makes, and at the WS `@rpc:` join. It does **not** run for an in-process read, so
this is the rung that may safely read `request()`/`identity()` — a cron tick or an `abide run` migration
reaching an rpc runs that rpc's own middleware and not this. A thrown outcome is rendered by the chain
exactly as a returned `Response` is, on both surfaces it runs on: the HTTP path, and the per-subscribe
channel/room re-authorization, where it counts as a DENY and fails closed. Plus lifecycle hooks
(async-capable, awaited):
`onStart(start)` / `onStop(stop)` **wrap** the real boot/teardown — do setup, then `await start()`
(the socket binds only inside it, so nothing serves until setup finishes); returning without calling
`start()` is a breakout (app never boots). `onStop(stop)` mirrors it (drain, then `await stop()`;
teardown is backstopped). `onError(error)` — request-scoped; runs when a request
throws an **unexpected** error. A DELIBERATE outcome never reaches it: `error(...)`/`redirect(...)` throw,
and the router renders the caught `HttpError`/`Redirect` at its own status BEFORE the hook (alongside a
tripped run deadline), on the rule that a declared 404 or a login redirect is not a bug in the app. Read
`request()`/`route()`/`identity()` ambiently. The hook shapes the reply two ways — by RETURNING a
`Response`, or by calling `error(...)`/`redirect(...)` **itself**, which throw and are rendered the same
way; only an UNEXPECTED throw from the hook falls through to the generic 500, on the reasoning that a hook
which fails while reporting a failure cannot be trusted to have produced a reply. `onHealth()` — returns fields merged over the framework baseline
`{ reachable, version, startedAt, uptime }` (app fields win; `reachable: false` or a throw → 503,
carrying `Retry-After: 30`). It is what `health()` composes into its document on **every** server-side
call, not only inside the route — and inside `GET /__abide/health` that call is still in request scope,
so the hook still reads `identity()`/`context()`. From a scope-free caller (a migration, a warmer) an
`identity()` read throws, which lands on the existing throw-fails-closed rule rather than a new one. Its RETURN TYPE is what the generated
`src/.abide/health.d.ts` carries into `health()`, so declaring the hook is also how you type the probe.

## CLI

**Every command finishes with the same banner** (`docs/spec/cli-lifecycle.md` §CL2b) — aligned
`local`/`network` address ROWS, then one dim `·`-joined NOTES line:

```
   ➜  local     http://localhost:3001
   ➜  network   http://192.168.1.24:3001

   ready in 412ms · port 3000 was taken · watching src/ · ctrl-c stops
```

Rows are what you click, copy or `cd` into (so **anything a caller would grep for is a row, never a
note**); notes are read once. There is deliberately **no command header** — the terminal already printed
the line you typed — and exactly one exception: `abide scaffold` ends by booting a dev server, so that
block carries an `abide dev` heading because it is for a command the caller did not type. The `network`
row is the machine's LAN IPv4, omitted when there is no external interface. Colour follows the same
`NO_COLOR`/`FORCE_COLOR`/is-a-TTY ladder as the log lines; a pipe gets the identical text with no escapes
and no `➜`, and the layout never changes with colour, because an uncoloured banner is what a bug report
pastes.

| Command | Does |
| --- | --- |
| `abide scaffold <name>` | scaffold + install + dev (`--no-install`/`--no-dev`/`--no-git`) |
| `abide dev` | same pipeline as build + watch + full live-reload (over the socket mux); `--port` (default `3000`) hops to the next open port if taken — and a hop CARRIES `APP_URL` to the port it actually bound, because `APP_URL` is not just the mount base but the expected origin both origin gates compare against (the WS CSWSH gate and AU8's CSRF gate). Left stale, the server rejects its own browser: every WS upgrade a 403 the client mux then reconnect-loops on, and — silently, since reads are exempt from CSRF — every MUTATION a 403, so the page loads, looks healthy and is read-only. Realignment, not relaxation: a foreign origin is still rejected, and it applies ONLY when `APP_URL`'s port is the one that was asked for, which is what identifies it as naming this server rather than a tunnel or proxy in front of it. `abide start` binds directly and fails hard on `EADDRINUSE`, so it cannot drift; graceful `onStop` teardown on SIGINT/SIGTERM/crash |
| `abide build` | code-split client → content-hashed chunks + `manifest.json` into `dist/_app/<hash>/`, each asset **minified and precompressed** (`<name>.br` / `<name>.gz` sidecars, listed in the manifest's `encodings` so `abide start` loads them without probing); also bakes the type-derived schema map to `dist/schemas.json` (derived from SOURCE, so the previous build's types cannot be baked into this one — that used to be arranged by DELETING the file first, which meant a build failing after the delete left the project with no bake at all) |
| `abide start` | serve the app against the built `dist/` client assets (no bundler at boot; builds first if absent); prefers the baked `dist/schemas.json` over a live `node`/tsgo derivation pass; `--port` (default `3000`) binds directly (hard `EADDRINUSE` on clash); graceful `onStop` teardown on SIGINT/SIGTERM/crash |
| `abide run <file> [args...]` | run script under the abide runtime (no HTTP; `onStart`/`onStop` run) |
| `abide compile [--target] [--out] [--platforms]` | ONE standalone executable (`bun build --compile`; default out `dist/<app name>`). Every lookup `abide start` makes at RUNTIME becomes a BUILD-time one, because the binary has no project beside it: discovery → static imports of each rpc/socket/`app.ts`/`config.ts` in a generated entry (`dist/compile/entry.ts`), the on-demand `.abide` compile → each page/layout/component's server module AOT-emitted next to that entry, `dist/_app/<hash>/` + `src/ui/public/**` → embedded assets, `dist/schemas.json` → inlined (no tsgo in the binary). `--platforms a,b,…` cross-compiles a release set for the price of ONE client build (bare `--platforms` = the default five; with it `--out` names the output DIRECTORY). **Constraint:** an app that needs its own SOURCE at runtime cannot be compiled — a module resolving/reading paths off `import.meta.dir` finds the read-only `/$bunfs/root` (do that work lazily, so it costs one handler rather than boot) |
| ↳ what the executable DOES | Decided at RUN time, not build time (the command surface costs 16 KB in a 67 MB binary, so there is no server-only artifact to build; `abide cli` was folded into `compile` and removed). **`./app`** → interactive, schema-driven REPL (the DEFAULT; `serve [--port n]` from the prompt hosts the app and the session keeps calling it). **`./app <rpc> [flags]`** → that rpc: flags are its input schema's fields (`--field value`/`--field=value`, a boolean as a presence flag `--loud`/`--no-loud`, an array as one JSON list or a repeated flag, `--args '<json>'` for the whole object). THE SCHEMA IS THE PARSER (`--n 5` on an integer field arrives as `5`); with no baked schema flags pass through JSON-first and the server validates. **`./app serve [--port n]`** → hosts it in the foreground, exactly as `abide start` does — a deployment must SPELL this, since a bare run with no console and no stdin is a loud `exit 2` naming `serve` rather than a silent success. **`./app connect <url>`** → REMEMBER that deployment until **`./app disconnect`** (bare `connect` reports it). **`./app login --token <t>`** → remember WHO you are there, **`./app logout`** drops it, **`./app identity`** asks the server who it thinks you are. **`./app logs`** → a LIVE feed of that deployment's log records (`--tail <n>` backlog first · `--level <l>` a severity floor · `--debug <pattern>` in the same `DEBUG` grammar the server gates with · `--trace <id>` matching a trace-id PREFIX, so the 8 hex a pretty line prints is paste-able · `--no-follow` for history-then-exit). Requires `ABIDE_LOGS` on the SERVER (else 404). Records arrive structured and are rendered by the READER through the same formatter the server uses for stdout, so a remote tail at a terminal is identical to reading that console and a pipe still gets `tsv`; `warn`/`error` go to stderr. It is the one command that PREFLIGHTS `/__abide/health` — a tail is expected to sit there producing nothing, so a wrong host, a too-old deployment and a quiet app would otherwise be three states with one empty screen. At the prompt ctrl-c DETACHES the feed instead of leaving the session. WHERE and WHO are separate because a credential belongs to an ORIGIN: credentials are keyed by origin in a per-user file under `appDataDir()` (`0600`), so moving staging→prod→staging keeps both logins and `connect` never touches a credential. All of them work at the prompt too (the live session re-points/re-credentials). **`./app help [rpc]`** → generated help. **`./app completion <bash|zsh|fish>`** → the shell completion script, which delegates back to `./app completion --line <line>` on every TAB rather than baking names in — so it answers from the LIVE input schemas and cannot go stale when a handler gains a field. The same call backs TAB **inside** the REPL (commands, reserved names, a command's `--flags`, and a field's `enum` values), so both surfaces offer identical candidates. The prompt also shows dim ghost text INLINE as you type: the best candidate where one is being completed, and at a bare flag position the command's whole SIGNATURE (`--name <string> --loud`, a boolean carrying no placeholder and an enum showing its set). `→`/`ctrl-e` accepts — the flag alone, not the placeholder — anything else ignores it, and it is never part of the submitted line. `--args` is never volunteered by completion (it is on every command, so it out-sorted everything you were actually reaching for); it still works spelled out and `help` still lists it. Suppressed under `NO_COLOR`, where undimmed ghost text would be indistinguishable from what you typed. **Output** (MS3.4): JSON to stdout — pretty at a TTY, compact through a pipe (`--pretty`/`--compact`) — a streaming handler line-streamed as it arrives (jsonl verbatim, sse unwrapped to its `data:` payloads); errors are a JSON object on **stderr** (a typed error keeps its `name`/`data`) plus a failure-CLASS exit code (`0` ok · `1` unreachable · `2` usage · `3` 422 · `4` 401/403 · `5` 404 · `6` 504 · `7` 5xx · `8` other 4xx). **Where the call lands** (`resolveCliTarget`, url and token resolved independently): `--url`/`--token` (this run) → `ABIDE_APP_URL`/`ABIDE_APP_TOKEN` (this environment) → a stored `connect` (this user) → otherwise it hosts ITSELF. Flag over env over file is the conventional ladder and is what lets `ABIDE_APP_URL=… ./app` beat a connected binary without disconnecting; when a mid-session `connect` is outranked, the REPL says where calls actually go. A named deployment means nothing boots (the embedded app still supplies the command table, so flags and types are known offline); hosting itself is on an ephemeral loopback port, LAZILY — printing help, mistyping a command or `connect`ing never runs `onStart` — and calls it over HTTP, not in-process, so middleware/identity/CSRF/validation/memo/deadline all apply. `serve`, `help`, `completion`, `connect`, `disconnect`, `login`, `logout`, `identity` and `logs` are RESERVED on **both** surfaces — they WIN over an app rpc of the same name (hosting has no second door; a shadowed rpc warns on `abide:cli` and stays reachable over HTTP/MCP/browser). `exit` and `quit` are reserved at the **prompt only**: they end a SESSION, which means nothing on a command line, so an rpc named `exit` is still callable as `./app exit` and is merely unreachable from the REPL — the shadow warning says which of the two it is. One table (`RESERVED_CLI_COMMANDS`) carries the names, that `where`, and the help text, because four places have to agree: the dispatcher, the REPL, the generated help, and the shadow warning. Global options are read only BEFORE the subcommand, so an rpc may still own `--url`/`--token` |
| `abide bundle` | desktop app (host platform; embeds assets; first-run setup screen) |
| `abide check` | type-check `.abide` (generate-TS → TS7 → map back); template + cross-file component-prop type-flow |
| `abide lsp` | `.abide` language server over stdio: diagnostics · hover · go-to-definition · completion · signature-help · find-references · semantic-tokens/highlighting (markup + inline script/style; the Zed extension in `packages/zed-abide` consumes it) (runs under node; `abide lsp` forwards from Bun) |

The `abide` CLI reports the same failure-CLASS exit codes the compiled binary does (`CLI_EXIT_CODES`,
one table). **Asking for help is a success; getting the command wrong is not** — a bare `abide`, `-h`
or `--help` prints usage to stdout and exits `0`, while an unknown subcommand prints it to **stderr**
and exits `2` (usage). They used to share one branch and both exit `0`, so `abide biuld` in a CI
script printed the usage text and reported success. Also `2`: `abide scaffold` with no `<name>`, and
`abide run` with a missing or nonexistent file. A `check` that finds type errors is `1` (failed) — a
real failure, not a wrong command line. Everything after `abide run <file>` belongs to the SCRIPT,
including anything that looks like an abide flag (`abide run migrate.ts --port 5` passes `--port 5`
to the migration), and a throw from the script propagates with its stack rather than becoming an exit
code — for a failed migration the stack IS the report.

## File-based conventions
| Path | Meaning |
| --- | --- |
| `src/server/rpc/<name>.ts` | one RPC per file; URL `/__abide/rpc/<name>` |
| `src/server/sockets/<name>.ts` | one `socket(...)` per file |
| `src/mcp/prompts/<name>.md` / `src/mcp/resources/<name>` | MCP prompt (`{{arg}}`) / resource |
| `src/server/config.ts` | boot-time `env(...)` schema |
| `src/app.ts` | `middleware` + lifecycle hooks |
| `src/ui/pages/**/page.abide` · `layout.abide` | routes / layouts. A layout renders its child page through **`<slot/>`** — the same outlet a component uses, filled by the router rather than by a caller's `<Tag>…</Tag>`, so there is nothing layout-specific to learn |
| `src/ui/public/` | static files served VERBATIM at their literal path (`src/ui/public/fonts/x.woff2` → `GET /fonts/x.woff2`), with a real content type. The counterpart to `/__abide/chunk/`, and the inverse trade: a chunk's URL embeds a content hash so it is `immutable`, while a public file sits at a FIXED externally-known path (`/favicon.ico`, `/robots.txt`, an `og-image` a crawler fetches) and so is **revalidated** (`public, max-age=3600` + an ETag → 304), never content-addressed. Checked after the framework routes (it can never shadow `/openapi.json` or `/__abide/*`) and before page SSR. A bundled stylesheet reaches these by **ROOT-ABSOLUTE** `url('/fonts/x.woff2')` — the public dir's top-level entries are marked `external` for the client build, so the reference passes through; a RELATIVE `url()` is instead resolved by Bun and inlined as a base64 data URL (at any size — there is no threshold and `loader` does not apply to CSS), which buries the asset in the render-blocking stylesheet |
| `src/bundle/window.ts` | `BundleWindow` config |
| `src/.abide/*` | reserved generated-types namespace, gitignored. Two kinds live here, and they differ by WHO has to read them: the typed `<file>.abide.d.ts` component companions are synthesized **virtually** (in-memory) by `abide check`/`lsp`, since only those two ever resolve a `.abide` import — while `health.d.ts` (CO2.4) is written **to disk** by `dev`/`check`/`lsp`/`build`, because the app author's own editor and `tsc` have to see it and neither runs through abide. A tsconfig `include` wildcard never descends into a dot-directory, so a project's tsconfig must name `"src/.abide/*.d.ts"` explicitly (the scaffold does) — miss it and the file is generated, never read, and the type it carries silently never appears |
| `dist/_app/<hash>/` | content-addressed code-split client build (hashed chunks + their `.br`/`.gz` sidecars + `index.json`; a stable `dist/manifest.json` points `abide start` at it) |
| `dist/schemas.json` | baked type-derived input/output JSON Schema map (`abide build`); `abide start` merges it at boot so prod carries no `node`/tsgo dependency |
| `$server/*` · `$ui/*` · `$shared/*` | tsconfig-path import aliases for `src/server/*` · `src/ui/*` · `src/shared/*` (scaffolded into the app `tsconfig.json`; resolved by the Bun runtime and `abide check`). A local `.ts` imported into an `.abide` client script stays unsupported client-side (aliased or relative) — share client state via `state.shared(key)`. |

## Generated routes
**Every one of these gates its METHOD, through ONE mechanism.** Every route class — the five read-only
framework routes (`/__abide/identity`, `/__abide/logs`, `/__abide/health`, `/__abide/chunk/*`,
`/openapi.json`), every **RPC**, `/__abide/mcp`, the socket HTTP face, and `src/ui/public/**` — passes the
methods it SERVES to `enforceMethod`, which admits them and answers anything else with a **405 + `Allow`**
derived from that same list. An rpc passes its DECLARED verb, so the declaration is the gate; the socket
face passes `GET, POST` (SSE subscribe / publish). `HEAD` is never named anywhere: `enforceMethod` derives
it from `GET`, because the router derives it (ADR 0027 D6). The one caller that cannot use the gate — an
`OPTIONS` preflight to an rpc that declared no `crossOrigin`, a 405 by construction rather than by
comparison — uses the same module's `methodNotAllowed`, so its header is built identically.

This is stated here because it was *not* true twice over. The check had been written out per route class
five times and simply OMITTED from three, so a `POST /openapi.json` carrying the abide client's shape
cleared the CSRF gate and returned **200 with the spec document** (same for `/__abide/identity` and
`/__abide/health`). `enforceMethod` fixed those five and stopped: the four TRANSPORT surfaces kept private
copies — the rpc gate re-implementing the HEAD rule inline, and mcp / the socket face / public files each
hand-rolling a 405 with its own `Allow` literal, alongside an `allowHeaderFor` helper that was itself the
fifth independent statement of the header. A rule stated once and applied per call site is a rule the next
route class forgets, and the header having an owner while the gate did not is exactly how three routes
ended up with no check at all.

`/__abide/rpc/<name>` (per-RPC transport; `+ ?__abide_from=<count>` stream resume) · `/openapi.json` (OpenAPI
3.1) · `/__abide/mcp` (MCP; socket → tail/publish tools) · `/__abide/sockets`
(multiplexed WS + per-socket HTTP face) · `/__abide/health` · `/__abide/identity` (the caller's OWN
resolved principal — what `identity.refresh()` and a compiled binary's `identity` subcommand read; it
discloses nothing the caller does not already hold, and runs through the middleware chain like every
other route) · `/__abide/logs` (SSE log feed — **opt-in** via `ABIDE_LOGS`, 404 otherwise; what
`./app logs` tails. Backlog-then-live, filtered server-side by `tail`/`level`/`debug`/`trace`, with
`follow=0` for history-then-EOF. Runs through the middleware chain like every other route, and is
deliberately NOT on the WS mux — a browser-joinable log channel would make any XSS a log exfil) ·
`/__abide/chunk/<name>-<hash>.(js|css)` (content-hashed, code-split client
assets — the loader entry + per-route chunks + shared chunks + CSS; served immutable/long-cache, and in a
production build **precompressed**: `abide build` stores brotli (max quality) + gzip beside each asset and
the route negotiates `Accept-Encoding` over them, adding `Vary: Accept-Encoding` only where a URL really
does have more than one representation. Compression is a BUILD cost, never a per-request one — which is
what buys maximum-quality brotli, since the bytes are content-addressed and computed once per hash. An
encoding is kept only when it beats the identity bytes by 10%, and assets under one MTU (512 B) or of an
already-compressed format are left alone; `abide dev` skips it entirely. Measured on the docs app: 692 KB
→ 179 KB, 74% off the client payload).

**Not built, though specced** — `/__abide/cli` (per-user install: install script + per-platform
tarballs behind a sealed per-user token; `machine-surfaces.md` MS3.5 parks it explicitly, and
`abide compile --platforms` cross-compiles the artifacts a serving surface would hand out) and
`/__abide/inspector` (the operator inspector, `config-observability.md` CO2.7). Both were listed here
as if they existed. They are named in this section rather than deleted from it because the design
decision stands and the absence is the thing worth knowing.

**The document `<head>` `modulepreload`s the whole static boot graph** — the loader entry, its
transitive static imports, and then the matched route's chunk and *its* static imports, each named
INDIVIDUALLY. The executing `<script type="module">` has to stay last (it must not run before the
hydration seed is parsed), which meant the browser did not DISCOVER the client bundle until
`responseEnd` — after every streamed read had drained. Measured on the docs app: boot download began at
4494 ms on a page whose `responseStart` was 364 ms; with the links, the whole graph is down by 392 ms
while the document streams on to 4566 ms. Naming only the entry moves the waterfall down one level
rather than removing it — following a preloaded module's own static imports is optional in the HTML
spec and Safari declines. Only STATIC edges are followed: the dynamic ones are other routes' code, and
preloading those would fetch the whole app on every page.

## Environment variables
| Var | Effect |
| --- | --- |
| `PORT` / `APP_URL` | listen port (default `3000`; `--port` overrides; `abide dev` hops to the next open port, `abide start` binds it directly) / public URL (mount base) |
| `ABIDE_DATA_DIR` | override the per-user data dir (backs `appDataDir()`) |
| `ABIDE_APP_NAME` | the app's own name (falls back to package.json `name`, seeded by `loadApp` at boot; then `abide`). Two uses, both in `log`: the default channel's LABEL, and the namespace a bare `log.channel('cards')` is qualified under — see the `abide/shared/log` row for what qualification means and how the browser learns the name |
| `ABIDE_IDENTITY_SECRET` | seals the `abide-identity` cookie + tokens (required in prod for authenticated `identity.set()`) |
| `ABIDE_IDENTITY_TTL` | identity cookie/token TTL ms (default 30d, rolling) |
| `ABIDE_APP_TOKEN` / `ABIDE_APP_URL` | bearer token / app URL for remote CLI & bundle |
| `ABIDE_MAX_SHARED_CACHE_SIZE` | byte ceiling (LRU) for shared + default-context cache (default: no limit) |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | per-stream ReplayableStream transcript cap in bytes (default: no limit; exceed → overflow, no replay) |
| `ABIDE_RPC_TIMEOUT` | default run deadline in ms (**300000**) — a fallback ceiling, per-RPC `timeout` is the real knob. Read at construction, so the browser half is **baked by `abide build`** and a deploy-time change retunes only the server |
| `ABIDE_SOCKET_TIMEOUT` | socket idle/connection timeout (WS) |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | the default ceiling on a mutation's request body, which a per-RPC `maxBodySize` OVERRIDES. Unset = no ceiling. A declared `content-length` over it is a **413** before anything is buffered; a chunked body is re-checked after the read, since a header can lie |
| `ABIDE_DERIVE_SCHEMAS` (`0`) | disable load-time type-derived schema inference at boot (default on; the schema lane is a REQUIRED `loadApp` argument, so no caller reaches it by saying nothing — `abide dev` and the test app derive live from SOURCE via a `node`/tsgo pass, `abide build` bakes to `dist/schemas.json`, and `abide run` prefers the BAKE, falling back to live derivation when there is none: it is the production runtime with a script in front of it, not a build) |
| `ABIDE_COMPRESS` (`static` \| `all` \| `off`) | how much is compressed. **`static`** (default) serves the brotli/gzip variants `abide build` precomputed for `/__abide/chunk/` — free at request time. **`all`** additionally compresses DYNAMIC responses per request: streamed HTML documents (through a flushing `node:zlib` transform, so the shell still paints before a slow `{#for await}` resolves — `CompressionStream` cannot do this and would silently buffer the whole document) and buffered JSON above 1 KB. `text/event-stream` and `application/jsonl` are **never** compressed: flushing per event inflates them (an 11-byte SSE event comes out 14 bytes) and adds latency to a transport whose point is immediacy. **`off`** withholds compression everywhere, including variants already on disk. The default is not `all` because most deployments sit behind a proxy/CDN that already compresses, and compressing twice grows the payload; the surfaces with no proxy (`abide compile`, `abide bundle`) are the ones that want `all` |
| `ABIDE_LOGS` / `ABIDE_LOG_BUFFER` | opt IN to the remote log feed (`GET /__abide/logs`, what `./app logs` tails) / its ring size in records (default 500). **Default closed**: every other `/__abide/` route discloses something the caller already holds, this one discloses whatever the app logged — including lines written for other users. Served inside the middleware chain, so auth is the app's own middleware; deliberately NOT on the WS mux, since a browser-joinable log channel makes any XSS a log exfil. Once enabled the ring fills unconditionally (you run `logs` AFTER noticing a problem), and the fan-out happens BEFORE the `DEBUG` gate — so `logs --debug abide:rpc` lights a framework channel on a LIVE deployment booted without it. Off, the emit path pays one property load |
| `ABIDE_LOG_FORMAT` (`tsv` \| `json`) / `DEBUG` | log format / channel gating. The var names the two MACHINE formats — `tsv` (level, ISO time, [channel], traceparent, message) and `json` — i.e. "this output is consumed, not read". Unset, the shape follows the TTY: a human at a terminal gets the **pretty** line (colour + columns, local `HH:MM:SS.mmm`, per-channel colour, traceparent shortened to 8 hex, dimmed/indented stack continuations), a pipe gets `tsv`. The human format is forced the other way with `FORCE_COLOR` and refused with `NO_COLOR` (→ `tsv`) — the conventional spellings, so there is no third abide name. That same ladder (`colourEnabled`) gates every other coloured surface too: the completion banner every `abide` command prints, and the REPL's banner and ghost text |

`ABIDE_ENABLE_INSPECTOR` / `ABIDE_INSPECT` were listed here and are **not implemented** — they gate the
`/__abide/inspector` route above, which is specced (CO2.7) and not built.
