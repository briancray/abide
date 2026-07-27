# abide - isomorphic type-safe framework for async interfaces for humans and machines built on bun and web standards

# project goals

* exclusively use bun apis and javascript native apis when they're available
* keep the api surface small, based on standards, and ergonomic with no ceremony
* maintain high visibility into the stack for debugging
* maintain a consistent runtime between all builds and environments
* isomorphism by default — same callable, same name, same *intent* on both sides
* uses typescript 7 for compiler
* small and low level client bundle built from compiled .abide
* value performance when all other conditions are met

# coding guidelines

* src is split three ways: `src/server/`, `src/ui/`, and `src/shared/` (plus `src/cli/`, `src/bundle/`, `src/test/`); import across them with the `$server` / `$ui` / `$shared` tsconfig-path aliases
* use bun apis - not node apis unless necessary
* only one export per file named after the export
* favor imperative/procedural over heavy functional abstractions
* write pure functions and use functional style programming
* use simple loops (for, for of) and straightforward control flow instead of deep iterator chains or high generic combinators in tight loops
* keep objects and arrays monomorphic so the JIT can optimize them agressively
* minimize dynamic features and complex closures in performance critical sections
* never `await` a value that is usually already settled — guard it (`isThenable(v) ? await v : v`); an unconditional await costs a promise wrap and a microtask tick at every call site, and a template slot pays it per row
* detect the common shape and skip the general algorithm — the expensive general path is the fallback, not the default
* use descriptive variable and function names instead of abbrevations
* write terse comments only when why is unclear. do not write comments where code is self explanatory — and when something was tried and reverted, record the MECHANISM, not just the outcome; an outcome-only note freezes the decision permanently
* use monomorphic types and narrowing/widening instead of ad-hoc or one use types
* use tailwindcss classes for styling, and prefer tailwind classes over style properties when possible.
* constants should be UPPERCASE_SNAKE_CASE always, including their files
* do not worry about backwards compatibility if there is a better way to do something at any level unless it changes a public api - then discuss

# performance and measurement

* a performance claim is a RATIO against hand-written code in the same substrate — absolute ms from a DOM emulator describe the emulator, not the framework
* correctness tests cannot guard a performance contract: when the contract is "does less work", assert the work (nodes moved, allocations, calls) — the wrong implementation still produces the right output
* budget emitted code in three numbers: allocations per template node, microtask ticks per row, DOM nodes per list item
* a benchmark case earns its place by DISTINGUISHING implementations, not by being representative — a full reverse cannot tell a minimal keyed reconcile from a rebuild; a two-row swap can

> The authoritative design lives in `docs/spec/*.md`. This file is the generated public-API
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
| *(no `HEAD` helper)* | — | HTTP `HEAD` **is** `GET` minus the body, so the router derives it: a `HEAD` request reaches the registered `GET` handler and the body is dropped. Declaring one was never meaningful — a `HEAD` handler that returns a payload is nonsense over the wire, and `GET`+`HEAD` on one resource could hold divergent bodies (ADR 0027 D6) |
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

**RPC `opts`**: `{ schemas?: { input?, output?, files? }, clients?: { browser?, mcp?, cli? },
middleware?, crossOrigin?, maxBodySize?, timeout?, memo?: false | { ttl?, crossRequest?, tags? } }`.
- **No schema** → input/output JSON Schema is **type-derived** (TS7), runtime-enforced, loud on
  unrepresentable types. The handler arg needs no annotation when a destructuring **default** types it
  (`GET(({ n = 0 }) => …)` derives `{ n?: number }`); an annotation or explicit generic still works. A
  param field left `any` (no default, no annotation) still derives permissive `{}` but is now **loud**
  (a `deriveSchema` warning) — only a zero-arg handler or bare `unknown` stays silent.
- **Schema-first input** → passing a Standard Schema as `schemas.input` makes the handler arg type
  **flow from the schema's parsed output** (`GET(({ n }) => …, { schemas: { input: z.object(…) } })`;
  `n` is typed, no annotation). `schemas.output`, when a Standard Schema, is type-checked against the
  handler's return payload (a drifted return is a compile error at the call).
- **`clients`** = *reachability only*, typed `boolean | { browser?, mcp?, cli? }` — which surfaces
  reach it. **Not authorization** — auth is `middleware`. The three flags gate surface **generation**
  (OpenAPI omission, MCP tool list, CLI registration, client-bundle inclusion) at build time;
  middleware runs per-request and can short-circuit. Different mechanism, different time.
  `false` withholds all three (the raw HTTP endpoint still exists — again, not auth); `true`/absent
  leaves all three reachable. An unrecognized key or a non-boolean flag **warns** on `abide:rpc`
  rather than being dropped in silence. There is no `clients.browser.validate` — it was advertised,
  never implemented, and is retracted (ADR 0027 D9): `clients` is reachability, and shipping a
  validator is a *bundling* decision that belongs next to `schemas`.
- **`middleware`**: `Array<(next) => Response>` run for this RPC (composed inside the global chain).
- **`memo`** (unified across verbs; `docs/spec/replayable-streams.md`): `ttl` (ms; **reads** default ∞,
  **mutations** default `0` = coalesce identical concurrent in-flight calls, retain nothing — a mutation
  that sets `memo: { ttl }` retains like a read on **both** the server and client memo, so its
  `peek`/`refresh`/`refreshing` probes come alive), `crossRequest` (opt-in cross-request server cache;
  ambient-scope reads fail-closed; pure-over-args), `tags`.
  `memo: false` opts a call OUT of the memo entirely (every call runs; a mutation's at-least-once). A
  `FormData` mutation body always bypasses (can't be keyed). A streaming handler that yields an
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
  (`peek`/`chunks`/`done`/`error`) read the adopted transcript. **Client-side consumption:** the browser RPC
  proxy decodes a streaming response by content-type into an `AsyncIterable` (routed through the same memo),
  so `{#for await x of rpc()}` works in the browser identically to SSR; `sse` is also consumable via the
  native `EventSource`.
- **`timeout`**: bilateral (client abort + server deadline); defaults to `ABIDE_RPC_TIMEOUT`.
- **`crossOrigin`**: CORS opt-in, **default closed** (no `Access-Control-*`; a cross-origin mutation is
  CSRF-rejected). `true` = allow any origin; `{ origin?: string | string[] | boolean, methods?, headers?,
  credentials?, maxAge? }` = an allowlist (`origin` string/array is exact; `true`/omitted = any). When
  set, the router answers the `OPTIONS` preflight, stamps `Access-Control-*` (+ `Vary: Origin` when the
  origin is echoed) on the response, and **exempts** an admitted origin from the same-origin CSRF gate.
  `credentials: true` forces the concrete-origin echo (the `*` wildcard is illegal with credentials).
  `OPTIONS` to an RPC without `crossOrigin` is a 405.

### Response
| Import | Signature |
| --- | --- |
| `abide/server/json` | `json(data, init?)` → `TypedResponse<T>` (sees through to `data` in a memo-backed read/mutation) |
| `abide/server/jsonl` | `jsonl(iterable, init?)` → `StreamResponse<C>`, `application/jsonl` (lazy; sees through to the iterable → ReplayableStream) |
| `abide/server/sse` | `sse(iterable, init?)` → `StreamResponse<C>`, `text/event-stream` (lazy; sees through to the iterable → ReplayableStream, on par with jsonl; also consumable via `EventSource`; adds `Cache-Control: no-cache` + `X-Accel-Buffering: no`) |
| `abide/server/error` | `error(status, message?, init?)`; `error.typed(name, status, schema?)` (a `405` carries `Allow`) |
| `abide/server/redirect` | `redirect(url, status=302, init?)` |

**Baseline response headers** — the router stamps every response at one choke point, each only when the
response didn't already set it (so a handler/helper/middleware stays in control): `X-Content-Type-Options:
nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` on all; `Strict-Transport-Security` in
production; `X-Frame-Options: SAMEORIGIN` on HTML documents. Any response without its own `Cache-Control`
defaults to `Cache-Control: private, no-cache` + `Vary: Cookie` (identity-scoped by default) — content-
addressed `/__abide/chunk/` assets opt out by declaring their own immutable long-cache. A response in a
traced request also carries `traceresponse` (alongside the echoed `traceparent`).

### Sockets
| Import | Signature |
| --- | --- |
| `abide/server/socket` | `socket<T, Args=void>(opts?)`; opts: `{ channel?, clientPublish?, schema?, clients?, middleware? }`. A transported form **nests** its primitive's options rather than flattening them (ADR 0027 D1), so the pub/sub knobs are the channel's own — `channel: { tail?, maxAge? }` — and a socket adds only transport + authorization vocabulary. `maxAge` is the per-MESSAGE age window; it is deliberately NOT `ttl`, which everywhere else means a memo's per-SLOT retention |

`Socket<T, Args=void>` is an isomorphic `AsyncIterable<T>` with an **identical surface on both sides**
(one `.d.ts`): `for await` + `publish(msg): void` + the reactive memo-probe vocabulary — `peek()`
(latest, `ttl`-windowed), `chunks()` (session transcript, `tail`-capped), `pending()`/`refreshing()`/
`done()`/`error()`. A `.abide` that imports a socket from `server/sockets/<name>.ts` gets the real hub
on the server and a **browser proxy** (the RPC-style module-swap) on the client — same import, same name.
Subscribe by iterating; **publish via `socket.publish(msg)`** (server always; client when `clientPublish`
admits it; fire-and-forget). ACTIVE probes (`iterate`/`peek`/`chunks`) open a subscription over the shared
WS mux; STATUS probes only observe it.
- **`clientPublish`** = `false | true | fn`: `false`/omitted = clients may not publish · `true` =
  unmediated · a **function** `(msg) => T | DROP` = mediated (transform the untrusted message, or `DROP`
  to suppress). The fn form REPLACES the old `handler` — the mediator *is* the permission, so a mediator
  on a closed path is unrepresentable (a server `publish` always bypasses it).
- **`Args`** names the ROOM (ADR 0023). `Args=void` = single topic (today's socket); a non-void `Args`
  gives per-room isolation — `sock({room})` iterates a room, `sock.publish({room}, msg)`/`sock.peek({room})`
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
| `abide/server/identity` | `identity()` → principal (never null; `.set(p)` / `.clear()`) |
| `abide/server/context` | `context()` → per-request mutable carrier bag |
| `abide/shared/route` | `route()` → `{ kind, name, params, url, navigating }` (isomorphic) |

### Config
| Import | Signature |
| --- | --- |
| `abide/server/env` | `env(schema)` → typed, boot-validated config; result type is **inferred from the schema** (schema-first, no `<T>` to repeat; field-spec map + Standard Schema). `env<T>()` (no schema) = best-effort pass-through — `T` is a compile-time annotation, not runtime-enforced |

### Beyond the browser
| Import | Signature |
| --- | --- |
| `abide/server/agent` | `agent(engine, messages, options?)` → `AgentFrame` stream. `options`: `{ model?, system?, tools?, approval?, … }`. `tools` default = all `clients.mcp` RPCs; `[]` = none. Types: `NeutralMessage`, `AgentFrame`, `AgentSurface`, `AgentEngine`. Ships a Claude engine (Anthropic Messages API over `fetch`) + a Claude Code engine (spawns the local `claude` CLI via `Bun.spawn`; **self-contained** — runs its own loop, engine tools OFF by default). |
| `abide/server/appDataDir` | `appDataDir()` → per-user data dir |

## Isomorphic — `abide/shared/*`

### Reactive primitives
| Import | Signature |
| --- | --- |
| `abide/shared/state` | `state(initial, transform?)`; `.shared(key, initial)` (cell shared by key across instances + tabs via `BroadcastChannel`; `.shared` degrades to per-render on the server). `state` keeps only what it OWNS (ADR 0024) — derivation is `memo`'s job. A cell is CALLABLE: `x()` tracked read, `x.set(v)` write, `x.untracked()` read WITHOUT subscribing. That last one is **not** `peek`: `peek` on `memo`/`channel` SUBSCRIBES (a memo's also kicks the load) and returns `T | undefined` — the opposite behaviour on the tracking axis, so the untracked escape hatch has its own name (ADR 0027 D2). In a `.abide` `<script>` the compiler writes the calls for you. Scope-free reactive atom — **isomorphic**: usable in a plain `.ts` on either side, so server modules can own a value and other modules import + derive (`memo`) + subscribe (`watch`) from it. Module-level state is **process-global** (safe for derived/immutable-source graphs; for mutable cross-request/user state use `memo({ crossRequest })`). |
| `abide/shared/memo` | `memo(asyncFn, opts?)` — the memoizer. Its DEPENDENCIES ARE ITS DECLARED INPUTS (ADR 0024): declare an arg and they are the cache key (today's memo/RPC, unchanged); declare none and they are inferred from the body. An **argless + synchronous** body is AUTO-TRACKED and its bare call returns `T`, not `Promise<T>` (a promise-returning derived read would blank the SSR text and refill a microtask later). An argless **async** body is not tracked — half-tracked is worse than untracked — and re-fills on `refresh`/`invalidate` only. A **keyed + synchronous** body returns `T` too (`memo(({a,b}) => a+b)`; `v({a:1,b:2})` is `3`, not a promise) — its args are the whole dependency set, so the body runs UNTRACKED, one slot per key. `memo(source, transform)` tracks the source ONLY, transform untracked (mirrors `watch(source, handler)`). The source is ALWAYS an argless THUNK (ADR 0025) — the tracked region is its body, so several inputs need no API of their own: they are what the thunk returns (`memo(() => ({ a, b }), ({ a, b }) => …)`), and the transform still takes ONE argument. Naming `ttl` or `crossRequest` keeps the classic pulled path — a memo can be **tracked or retained, not both**. Since whether a memo is reactive is decided by what its body RETURNS, an argless memo that returns a promise **warns on `abide:memo`** (ADR 0027 D8): adding one `await` to a working derivation silently turns it into a manually-invalidated cache, so the loss is now announced and the message names the fix. A `(...args)`/`(args = {})` param is a LOUD construction-time error (it reports `fn.length` 0 and would silently reclassify an args-keyed memo). |
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
its key last or not at all and already collapsed free from an omittable `void` parameter (`peek()` vs
`peek({ id })`). This is the rule `socket.publish(msg)`
has always followed, now declared once on the shared surface. (An RPC callable is the exception: a
zero-arg RPC infers `Args = unknown`, not `void`, so `rpc.publish(args, value)` still takes the arg slot.)

### Probes
| Method | Global (tags) |
| --- | --- |
| `fn.pending` / `fn.refreshing` / `fn.peek` / `fn.error` | `pending({tags})` / `refreshing({tags})` |
| `done(iterable)` → boolean · `online()` → reactive boolean · `reachable(host)` → `await` boolean | |

### Schema / errors / misc
| Import | Notes |
| --- | --- |
| `abide/shared/withJsonSchema` | `withJsonSchema(schema)` → Standard Schema that also exposes `toJSONSchema()` |
| `abide/shared/done` | `done(iterable)` → reactive boolean: has a `{#for await}`-consumed stream finished? |
| `abide/shared/online` | `online()` → reactive connectivity boolean (true on server; tracks `navigator.onLine`) |
| `abide/shared/HttpError` | type: `status`, `statusText`, `kind?`, `data?` |
| `abide/shared/ValidationErrorData` | `{ issues, fields }` |
| `abide/shared/route` | `route()` (see above) |
| `abide/shared/url` | `url(path \| URL, params?, query?)` — in-app href resolver; `params` fill dynamic segments (`[name]` required, `[[name]]` optional, `[...name]` rest — a `/`-joined string; typed from the path literal), `query` appends a query string. No-dynamic-segment path (or a `URL`) collapses to `url(target, query?)` |
| `abide/shared/health` | `health()` → `Promise<{ reachable, version, ... }>` — isomorphic: server returns the baseline in-proc, client `await`s a fetch of `/__abide/health` (full merged doc) |
| `abide/shared/log` | `log(...)`, `.info/.warn/.error/.trace`, `.channel(name)`. Every line carries a channel label — the un-channeled `log(...)` uses the **app name** (`ABIDE_APP_NAME`/package.json/`"abide"`, always on); `.channel('abide:…')` names a framework channel gated by `DEBUG` (server) / `localStorage.debug` (browser). `error` always emits; `warn/info/trace` gated. Channels: `abide:{bundle,cli,health,hydrate,identity,memo,router,rpc,socket,ssr,stream}` |
| `abide/shared/trace` | `trace()` → W3C traceparent \| undefined |

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
| `abide/test/createTestApp` | `await createTestApp(config?)` → `Promise<TestApp>` (`origin`, `fetch`, `rpc`, `socket`, `health`, `stop`, `as(identity)`) — real in-process app, not mocks. **Async**, two modes: naming any surface (`routes`/`sockets`/`pages`/`layouts`/`middleware`) = explicit hermetic app (today's behavior); naming none (`createTestApp()`/`{}`/only `{ dir, lifecycle }`) = **discovery** — loads the whole project from `dir` (default `cwd`) and boots its `onStart`/`onStop` (`lifecycle: false` skips the hooks) |

## isometric RPC consumption (call surface)
This surface is **identical for reads and mutations** (full symmetry). A read (`GET`/`HEAD`) is an `Rpc`/
`StreamRead`; a mutation (`POST`/`PUT`/`PATCH`/`DELETE`) is a `MutationSurface` = `Mutation extends Rpc`
(value) or `StreamMutation extends StreamRead` (streaming) — every probe/verb below is present on both.
Mutations differ only in transport (args in body + CSRF gate) and the default TTL (`0` vs a read's ∞), so
`peek`/`refresh`/`refreshing` reflect a retained value only when a mutation opts into `memo: { ttl }`.

| Form | Meaning |
| --- | --- |
| `fn(args)` | **the read** — awaitable `Promise<T>` (coalesced + cached; SSR in-proc → browser fetch). Also subscribes the caller, so `{await fn()}` re-awaits on invalidate. A mutation call is the same, but posts args in the body (default `ttl:0` retains nothing) |
| `fn.peek(args)` | reactive `T \| undefined` snapshot — subscribes + kicks a coalesced load; the non-blocking display read |
| `fn.raw(args, init?)` | raw `Response`, full bypass |
| `memo.state(args, initial)` | the WRITABLE PROJECTION of one slot (`memo` only): a live cell over that slot whose `set` IS `publish`, so a local write is provisional until the next re-fill. The key is a `Room` positional and the `initial` trails it (`m.state(initial)` argless, `m.state({id}, initial)` keyed) — required on an **async** memo because a cold slot has no value and `State<T>` is invariant, so widening the read would also let `set` forge the not-loaded sentinel. A **sync** memo needs none: it is never pending and rethrows, so its read is already `T`-or-throw |
| `fn.refresh(args?)` / `fn.invalidate(args?)` / `fn.publish(args, v)` | surface verbs (partial match) |
| `fn.peek` / `fn.pending` / `fn.refreshing` / `fn.error` / `fn.watch` | reactive probes |
| `fn.isError(e, name)` | narrow a typed error |
| bare call on a streaming handler | resolves to a fresh replay-then-live `AsyncIterable<C>` cursor (per caller, over one shared run) |
| **streaming read/mutation** `StreamRead<Args, C>` / `StreamMutation<Args, C>` | any handler (read OR mutation) that yields an `AsyncIterable<C>`; replaces the value verbs with reactive chunk probes: `fn.peek(args): C\|undefined` (the **latest chunk** — the "current value"), `fn.chunks(args): C[]\|undefined` (transcript snapshot), `fn.done(args)`, `fn.error(args)`. A streaming mutation is consumed client-side via `{#for await x of fn()}` identically; only the `?__abide_from=` HTTP RESUME endpoint stays read-only |

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
| `name={expr}` | reactive attribute (whole-value expression) · `on<event>={fn}` native listener (`oninput`/`onclick`/…) |
| `name="…{expr}…"` | quoted values interpolate too (reactive) — mixed literal + `{expr}`, also on component props; a literal brace is `{'{'}` |
| `bind:value` / `bind:checked` / `bind:group` / `bind:value={{get,set}}` | two-way binds (also on component props) |
| `class:name={cond}` / `style:prop={value}` | toggle class / set one property |
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
| `{#component Name(props, children)}` | **inline component** — a reusable builder; name must be **TitleCase** (a lowercase name is a parse error — lowercase is reserved for element tags); invoked as a tag `<Name/>` **only** — the call form `{Name(…)}` is a compile error (an interpolation renders text; a component is a tag). Passable as a first-class value/prop — a component-valued prop is likewise rendered `<Render/>`, never `{Render()}`. A nested `{#component X()}` inside `<Foo>…</Foo>` becomes Foo's `X` prop. |

### Async reads
| Form | Meaning |
| --- | --- |
| `{fn.peek(args)}` | non-blocking `T \| undefined` snapshot; `undefined` while pending, reactive |
| `{await fn(args)}` | the read — blocks SSR (value in initial HTML); on the client fills the text node when the read settles (nothing suspends); re-awaits on invalidate |
| `{#await fn(args)}` | reactive await block: `{:then v}` (`v: T`) / `{:catch}` / `{:finally}` |
| `{#await fn(args) then v}` | inline blocking form: `v: T` bound in the opener, body renders once settled (no pending branch) |
| `{fn(args)}` (bare) | **a `abide check` error** — "this is a Promise — write `{await expr}` so it types as T". A **concept boundary**, not a typing accident (ADR 0027 D3): the three forms above do three different things (`await` blocks · `peek` doesn't · `{#await}` branches), and the bare call is the *awaitable*, not a fourth read. It is not the non-blocking form — on the server it is the BLOCKING one, since `emitServer` awaits every expression slot unconditionally (it is type-blind and cannot tell a promise-returning read from a plain value), so it renders identically to `{await fn(args)}` while typing as `Promise<T>`, which dead-ends at the first `.field`. Making it mean "non-blocking" would also break the project's first law: a plain `.ts` has no compiler, so `fn(args)` is a `Promise<T>` there regardless, and one expression would mean two things by file extension. The auto-await stays a backstop for the untyped/passthrough path (a `T \| Promise<T>` union is deliberately still legal) |
| `fn.pending()` / `fn.error()` | probes |

### Components / pages
| Feature | Notes |
| --- | --- |
| Capitalised tags | component invocation (`<Name/>`) · `<slot/>` renders default children (`{children()}` is the equivalent interpolation form) · nested inline-component defs = named component props (render-prop) · a cell- or memo-named tag (`const C = memo(…)`; `<C/>`) is a **reactive** component (re-mounts on change) · a component-valued prop types as `Component<Props>` |
| `<script>` per-instance · `<script module>` once-per-module · nested `<script>` branch-local |
| `<style>` component-scoped · nested `<style>` subtree-scoped · tailwind optional |
| `src/ui/pages/**/page.abide` / `layout.abide` | routes; `[name]` → `route().params.name` (required); `[[name]]` optional segment (absent → param omitted); `[...name]` rest/catch-all (terminal) → `route().params.name` is the `/`-joined remaining segments. Precedence: literal > required > optional > rest |
| `route()` | `route().url`, `.params`, `.name`, `.kind`, `.navigating` |
| `navigate` / `url` | `url(path, params?, query?)` builds an href; `navigate(target, options?)` moves to one — compose as `navigate(url(...), options)`. Nav always hits the server (middleware); same-route param/query nav = a pure `route()` republish (reads re-fire reactively in place — no DOM swap, no re-hydrate; scroll/focus preserved; the server round-trip is a background middleware/redirect confirm), a cross-route nav sharing a layout prefix keeps the shared outer layouts alive and grafts/claims only the diverging suffix (fully-disjoint route = whole-outlet swap) |

## App module — `src/app.ts`
`export const middleware = [(next) => Response, …]` (onion; `next()` needs no args; return a
`Response` to short-circuit — **auth is middleware**). Plus lifecycle hooks (async-capable, awaited):
`onStart(start)` / `onStop(stop)` **wrap** the real boot/teardown — do setup, then `await start()`
(the socket binds only inside it, so nothing serves until setup finishes); returning without calling
`start()` is a breakout (app never boots). `onStop(stop)` mirrors it (drain, then `await stop()`;
teardown is backstopped). `onError(error)` — request-scoped; runs when a request
throws an unexpected error (typed `error(...)`/`redirect(...)` are Responses, not throws, so they don't
reach it); read `request()`/`route()`/`identity()` ambiently; may return a `Response` to shape the
reply, else a generic 500. `onHealth()` — request-scoped,
runs on every `GET /__abide/health`; returns fields merged over the framework stub `{ reachable, version,
startedAt, uptime }` (app fields win; `reachable: false` or a throw → 503, carrying `Retry-After: 30`).

## CLI
| Command | Does |
| --- | --- |
| `abide scaffold <name>` | scaffold + install + dev (`--no-install`/`--no-dev`/`--no-git`) |
| `abide dev` | same pipeline as build + watch + full live-reload (over the socket mux); `--port` (default `3000`) hops to the next open port if taken; graceful `onStop` teardown on SIGINT/SIGTERM/crash |
| `abide build` | code-split client → content-hashed chunks + `manifest.json` into `dist/_app/<hash>/`; also bakes the type-derived schema map to `dist/schemas.json` (clearing any stale one first) |
| `abide start` | serve the app against the built `dist/` client assets (no bundler at boot; builds first if absent); prefers the baked `dist/schemas.json` over a live `node`/tsgo derivation pass; `--port` (default `3000`) binds directly (hard `EADDRINUSE` on clash); graceful `onStop` teardown on SIGINT/SIGTERM/crash |
| `abide run <file> [args...]` | run script under the abide runtime (no HTTP; `onStart`/`onStop` run) |
| `abide compile [--target] [--out]` | standalone server executable (embeds assets) |
| `abide cli [--target] [--out] [--platforms]` | dual-mode binary: embeds app, self-hosts or targets `ABIDE_APP_URL`; interactive with no subcommand |
| `abide bundle` | desktop app (host platform; embeds assets; first-run setup screen) |
| `abide check` | type-check `.abide` (generate-TS → TS7 → map back); template + cross-file component-prop type-flow |
| `abide lsp` | `.abide` language server over stdio: diagnostics · hover · go-to-definition · completion · signature-help · find-references · semantic-tokens/highlighting (markup + inline script/style; the Zed extension in `packages/zed-abide` consumes it) (runs under node; `abide lsp` forwards from Bun) |
| `abide init-agent` | write/refresh this `CLAUDE.md` pointer |

## File-based conventions
| Path | Meaning |
| --- | --- |
| `src/server/rpc/<name>.ts` | one RPC per file; URL `/__abide/rpc/<name>` |
| `src/server/sockets/<name>.ts` | one `socket(...)` per file |
| `src/mcp/prompts/<name>.md` / `src/mcp/resources/<name>` | MCP prompt (`{{arg}}`) / resource |
| `src/server/config.ts` | boot-time `env(...)` schema |
| `src/app.ts` | `middleware` + lifecycle hooks |
| `src/ui/pages/**/page.abide` · `layout.abide` · `src/ui/public/` | routes / layouts / static |
| `src/bundle/window.ts` | `BundleWindow` config |
| `src/.abide/*` | reserved generated-types namespace; `abide check`/`lsp` synthesize the typed `<file>.abide.d.ts` companions **virtually** (in-memory), not on disk |
| `dist/_app/<hash>/` | content-addressed code-split client build (hashed chunks + `index.json`; a stable `dist/manifest.json` points `abide start` at it) |
| `dist/schemas.json` | baked type-derived input/output JSON Schema map (`abide build`); `abide start` merges it at boot so prod carries no `node`/tsgo dependency |
| `$server/*` · `$ui/*` · `$shared/*` | tsconfig-path import aliases for `src/server/*` · `src/ui/*` · `src/shared/*` (scaffolded into the app `tsconfig.json`; resolved by the Bun runtime and `abide check`). A local `.ts` imported into an `.abide` client script stays unsupported client-side (aliased or relative) — share client state via `state.shared(key)`. |

## Generated routes
`/__abide/rpc/<name>` (per-RPC transport; `+ ?__abide_from=<count>` stream resume) · `/openapi.json` (OpenAPI
3.1) · `/__abide/mcp` (MCP; socket → tail/publish tools) · `/__abide/sockets`
(multiplexed WS + per-socket HTTP face) · `/__abide/health` · `/__abide/cli` (per-user install) ·
`/__abide/inspector` (gated) · `/__abide/chunk/<name>-<hash>.(js|css)` (content-hashed, code-split client
assets — the loader entry + per-route chunks + shared chunks + CSS; served immutable/long-cache).

## Environment variables
| Var | Effect |
| --- | --- |
| `PORT` / `APP_URL` | listen port (default `3000`; `--port` overrides; `abide dev` hops to the next open port, `abide start` binds it directly) / public URL (mount base) |
| `ABIDE_APP_DIR` / `ABIDE_DATA_DIR` | override built app dir / per-user data dir |
| `ABIDE_APP_NAME` | default `log` channel label (falls back to package.json `name`, then `abide`) |
| `ABIDE_IDENTITY_SECRET` | seals the `abide-identity` cookie + tokens (required in prod for authenticated `identity.set()`) |
| `ABIDE_IDENTITY_TTL` | identity cookie/token TTL ms (default 30d, rolling) |
| `ABIDE_APP_TOKEN` / `ABIDE_APP_URL` | bearer token / app URL for remote CLI & bundle |
| `ABIDE_MAX_SHARED_CACHE_SIZE` | byte ceiling (LRU) for shared + default-context cache (default: no limit) |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | per-stream ReplayableStream transcript cap in bytes (default: no limit; exceed → overflow, no replay) |
| `ABIDE_RPC_TIMEOUT` | default for the RPC `timeout` prop (bilateral); per-RPC `timeout` overrides |
| `ABIDE_SOCKET_TIMEOUT` | socket idle/connection timeout (WS) |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | default max request body |
| `ABIDE_DERIVE_SCHEMAS` (`0`) | disable load-time type-derived schema inference at boot (default on; `abide dev`/`run`/test app derive live via a `node`/tsgo pass, `abide build` bakes to `dist/schemas.json`) |
| `ABIDE_LOG_FORMAT` (`json`) / `DEBUG` / `ABIDE_DEV_SURFACE` | log format / channel gating / dev request log |
| `ABIDE_ENABLE_INSPECTOR` / `ABIDE_INSPECT` | inspector route (off by default) / debug instrumentation |
