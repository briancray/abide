# abide — Config & Observability (Spec, Slice 6)

Status: draft, derived from design interview 2026-07-17.
Scope: boot-time config (`env(schema)`) and the observability surface
(`log`/`trace`/`health`/`online`/`reachable`/inspector). Small, mostly plumbing. Builds on
§6 (server/client boundary), §10/§11 (schema + type-derivation).

---

## CO1. Config — `env(schema)`

1. **Typed, boot-validated config from environment.** Standard Schema (§10) that **coerces**
   the all-strings environment (`"3000"` → `number`, `"true"` → `boolean`, enums) and validates
   **once at boot**. **Fails fast, refuses to start** on any *required, no-default* var missing
   or invalid — never a half-configured process. Returns a frozen typed object.
2. **Schema may supply defaults** — a field with a default is not required; missing env → the
   default. Fail-fast (CO1.1) applies only to required-without-default vars.
3. **Schema-first typing (implemented).** The typed path is **schema → type**, not type → schema:
   write the schema once and the frozen result's TS type is **inferred** from it (a field-spec map
   `env({ PORT: { type: "number", required: true } })` → `{ PORT: number }`; a Standard Schema →
   its output type; an `enum` → the literal union). Same schema drives coercion, validation, AND the
   static type — **fully runtime-consistent** across `abide build`/`dev`/`run`, tests, and
   `createTestApp` (no build-only behavior). `env<T>()` with no schema is a best-effort pass-through
   where `T` is a compile-time annotation only (**not** runtime-enforced).
   **Deferred — type → schema derivation (`env<{ PORT: number }>()` synthesizing coercion from an
   ERASED type):** unbuildable at runtime, and a boot-loaded `src/.abide/config.schema.json` artifact
   would apply only where the build ran — the exact cross-environment inconsistency the
   runtime-consistency goal forbids. The consistent delivery is the shared TS7 **§11 build-extraction
   pass** (build-pipeline BP1.4), which is RPC-first and parked; env would ride it, not lead it.
   Until then, schema-first (above) is the supported typed story.
4. **`src/server/config.ts` is *the* config module** — evaluated once at boot, exports the typed
   config; server code imports it rather than reading `process.env` ad hoc. Scattered runtime
   env reads are unnecessary/discouraged.
5. **App vars vs framework `ABIDE_*` are separate.** `env(schema)` = the *app's own* config;
   abide reads and boot-validates its own `ABIDE_*` vars internally with the same fail-fast. You
   don't declare `ABIDE_IDENTITY_SECRET` via `env`. One such framework var,
   **`ABIDE_MAX_SHARED_CACHE_SIZE`, defaults to NO LIMIT (unbounded)** and is an opt-in operator
   bound that caps **both** the shared RPC cache **and** the default ambient context (the
   `abide run`/cron/worker path, so long-running scripts stay bounded when it's set). Unbounded-by-
   default is a consciously accepted memory-exhaustion tradeoff for a tool-shaped framework; this
   var is the mitigation.
6. **Server-only by the §6 boundary** — importing `config.ts` into client code is a **build
   error** (under `src/server/**`, runtime never reaches the client), so secrets can't leak via
   config. Plus optional **secret-field marking** → redacted from logs / inspector (CO2).
7. **All validation at boot, nothing lazy** — the schema is the complete declaration of consumed
   env.

## CO2. Observability

1. **`log` = isomorphic structured logging** (`abide/shared`): levels `.info`/`.warn`/`.error`/
   `.trace` + named channels `.channel(name)`. **Server** writes structured lines to
   stdout/stderr in one of three shapes — **`pretty`** (colour + fixed columns: local
   `HH:MM:SS.mmm`, level badge, per-channel colour, message, the traceparent shortened
   to 8 hex of its trace id; a multi-line message dims + indents its continuation lines), **`tsv`**
   (`level  time  [channel]  traceparent?  message`), **`json`** (one record per line, carrying the
   full ISO instant and full traceparent). Which one is **not** chosen by name in the common case: it
   follows **whether stdout is a TTY** — a human at a terminal gets `pretty`, a pipe/file/collector
   gets `tsv`, with no flag to remember. **`ABIDE_LOG_FORMAT` names only the two MACHINE formats**
   (`tsv` / `json`) — setting it says "this output is consumed, not read", and there is deliberately
   no `pretty` value: forcing the human format into a pipe is **`FORCE_COLOR`** and refusing it on a
   terminal is **`NO_COLOR`** (→ `tsv`, since an uncoloured pretty line is strictly worse than the
   tab-separated one), both the conventional spellings rather than a third abide-specific name.
   **Client** writes to console as
   `[channel] …`, the badge tinted with the same per-channel colour hash the terminal uses
   (console-only by default; shipping client logs to the server is parked). Every line carries a
   **channel label**.
2. **Default channel = the app name; framework channels = `abide:*`.** The un-channeled root
   `log(...)` labels lines with the **app name** — `ABIDE_APP_NAME`, else the project
   `package.json` `name` (seeded at boot by `loadApp`), else `"abide"` — and is **always on** (it
   is the app's own stream). `.channel(name)` is a **named channel gated by the `debug`-npm
   pattern**: server reads `DEBUG` (`DEBUG=docs:cards,docs:db` / `DEBUG=*`), the browser reads
   `localStorage.debug`, so a channel is enable-able on **both** sides of the isomorphism. All
   framework internals log under the **`abide:*`** namespace, so `DEBUG=abide:*` lights up abide's
   own diagnostics. The current channel set: `abide:bundle`, `abide:cli`, `abide:health`,
   `abide:hydrate`, `abide:identity`, `abide:memo`, `abide:router`, `abide:rpc`, `abide:socket`,
   `abide:ssr`, `abide:stream`. It is the set that EXISTS, enumerable by grepping `log.channel(` —
   this list had carried `abide:cache` (the channel is `abide:memo`; the rename came with ADR 0023's
   cache→memo) alongside `abide:agent` and `abide:mcp`, neither of which any module has ever
   opened, so `DEBUG=abide:mcp` lit nothing and reported nothing.
   - **A bare name is QUALIFIED with the app name.** `log.channel('cards')` in an app called `docs`
     labels and gates as **`docs:cards`** — an app's channels namespace under it exactly as the
     framework's do under `abide:`, with no call site spelling the prefix (which is what an app used
     to have to do, and one rename away from a `DEBUG=docs:*` that missed half its own channels).
     A name that **already carries a namespace** (contains a `:`) is verbatim: that is what keeps
     `abide:*` intact when the framework logs from inside an app called something else, and the
     deliberate way to name a foreign namespace. The **qualified label is what gets gated**, so the
     `DEBUG` pattern, the printed `[label]`, and a remote subscriber's `--debug` filter all spell a
     channel the same way. Qualification happens at **emit** time, not when the logger is built —
     framework modules call `.channel(...)` at module load and `ABIDE_APP_NAME` is seeded at boot.
   - **The browser learns the name from the BUILD.** A tab has no environment to read, so the client
     build bakes the resolved app name into the loader entry (`globalThis.__ABIDE_APP_NAME__`,
     `clientBundle.loaderSource`) and `appName()` falls back to it. Without that seed the same
     `log.channel('cards')` would label and gate as `docs:cards` on the server and `abide:cards` in
     the browser — one channel with two names, on a primitive whose point is being the same on both
     sides. Baked, so renaming the app takes a rebuild (as `ABIDE_RPC_TIMEOUT`'s browser half does).
   - **Level policy (one rule):** `error` **always emits**, bypassing gating, so operational
     failures surface even on a silent channel. `warn`/`info`/`trace` emit **only** when their
     channel is named (the default app channel counts as always-named → always on).
3. **The REMOTE log feed = `GET /__abide/logs` + the `logs` subcommand.** A process may fan its log
   records out to subscribers as SSE, so a compiled binary can tail a deployment:
   `./app --url https://… logs`.
   - **Off unless opted in** (`ABIDE_LOGS`; ring size `ABIDE_LOG_BUFFER`, default 500 records).
     Every other generated route under `/__abide/` discloses something the caller could already
     reach; this one discloses whatever the app logged, **including lines written on behalf of other
     users**, so it cannot be on by default and stay honest. It is served **inside the middleware
     chain**, so authorization is the app's own middleware — the same answer abide gives everywhere
     else. It is deliberately **NOT on the WS mux**: a reserved `@log:` channel beside `@rpc:`/
     `@tag:` would be tidier, but the mux is reachable from the client bundle, and a log feed a
     browser can join turns any XSS into whole-server log exfiltration.
   - **The fan-out happens BEFORE the `DEBUG` gate.** A channel that stdout suppresses still reaches
     a subscriber, so `logs --debug abide:rpc` can light a framework channel on a **live** deployment
     that was booted without it — the thing that makes a remote feed worth having. With the feed off
     (the default) the emit path pays one property load and is unchanged.
   - **Records are structured on the wire and rendered by the READER**, through the same
     `formatLogLine` the server uses for its own stdout — so a remote tail at a terminal is identical
     to reading that server's console, and through a pipe degrades to the same `tsv`. `ABIDE_LOG_FORMAT`
     / `NO_COLOR` / the TTY govern it exactly as they do locally; `warn`/`error` go to the reader's
     stderr, everything else to stdout.
   - **Filters are applied server-side**: `--tail <n>` (backlog before live; **200** when absent, so
     a bare `logs` opens with context rather than a blank screen), `--level <l>` (a severity FLOOR),
     `--debug <pattern>` (the **same** `DEBUG` grammar), `--trace <id>` (a trace-id PREFIX, so the 8
     hex the pretty line prints is paste-able), `--no-follow` (history, then EOF).
   - **The route answers `GET`/`HEAD` only** — anything else is a 405 with `Allow: GET, HEAD`. The
     404 is the DISABLED case specifically, so "this deployment doesn't expose logs" and "you asked
     for it wrong" stay distinguishable. `ABIDE_LOG_BUFFER` unset, unparseable or ≤ 0 falls back to
     the ring's own 500 rather than erroring: "opted in, but keep nothing" is never what someone who
     set the var meant.
   - **Backlog buffers unconditionally once enabled**, not only while someone is subscribed: you run
     `logs` *after* noticing a problem, and a feed that starts empty at connect has discarded the
     only lines you wanted.
   - **Losses are reported, never silent.** A subscriber that cannot keep up is bounded
     (`MAX_QUEUE`) and receives a synthetic `abide:logs` record naming how many lines it missed.
   - **One process.** Behind a load balancer this is whichever instance the request landed on — the
     same limitation `memo({ crossRequest })` has.
4. **`trace()` = W3C Trace Context (`traceparent`).** Each server request gets/propagates a
   traceparent; **RPC calls carry it**, so a browser→server(→server) chain shares one trace id.
   **Auto-correlated into log lines.** `trace()` returns the current traceparent or `undefined`.
   The response echoes both `traceparent` and **`traceresponse`** (W3C Trace Context Level 2, the
   response-side header) so a caller can correlate its response with the trace.
   - **Minted EAGERLY, per request, not on first read.** An incoming well-formed `traceparent` is
     propagated; otherwise the router mints one when it builds the scope, so a `trace()` inside a
     request always answers and **every response carries the pair** — including one from a handler
     that never mentions tracing. The trace is a property of the request, not of whether anyone
     asked. The **one exemption is a content-addressed asset** (`/__abide/chunk/*`): a static,
     identity-free, immutable, cross-user-shared byte response that no span will ever join.
   - **`trace()` answers in the BROWSER too — with the server's id, never its own.** The client
     never mints (an id generated there would name a trace no server span belongs to); it **adopts**
     the traceparent of the request that rendered the live page and re-adopts on every navigation,
     so a browser log line correlates with the server span that produced what it is logging about.
     The carrier is the **hydration seed** (`seed.trace`) on first load and on a full soft-nav —
     a document response's headers are not JS-readable — and the confirm response's `traceresponse`
     header on a param/query nav. That nav does now drain its confirm for the seed (C6-nav), whose
     `trace` is the same id, but the header is read from the RESPONSE while the seed frame arrives
     only once the whole render has streamed; adopting at the header keeps `trace()` from naming the
     previous page's span for the length of a slow render. A malformed value is dropped rather than
     adopted, so `trace()` is always a valid traceparent or `undefined`.
   - **The browser half is REACTIVE**, so a binding that reads `{trace()}` re-renders when a nav
     adopts a new id. It is the third **ADOPTED AMBIENT** (`shared/internal/adoptedAmbient.ts`),
     beside `route()` and `identity()` — one shape: read reactively, adopt from OUTSIDE (seed, nav
     header, `/__abide/identity` fetch), never mint, drop an invalid value rather than take it.
     `trace` was the one that was NOT one: it lived as a plain field on the reactive scope, so a
     binding rendered the first page's id and then showed it forever, and a component that mounted
     its own scope lost it entirely. Three files that each stated a resemblance to the other two were
     three files free to drift, and they had — `route` alone skipped validation, `trace` alone was
     unreactive. The two axes that genuinely differ are PARAMETERS: how strict `isValid` is (a
     `route` is constructed internally by `navigate`, an `identity`/`trace` arrives as untrusted
     text) and whether an extra `changed` guard sits over the cell's identity check (`identity`
     compares by value, since every nav decodes a fresh principal object; `route` deliberately does
     not, which is what makes a same-route param nav republish; `trace` needs none, a traceparent
     being a string). Only the browser half changed — `trace()` still reads the request scope and
     still MINTS there, because by ADR 0026 only a unit of work that is itself a server request may
     name a trace.
   - **An RPC call from the browser CARRIES it — as a child span.** The proxy sends `traceparent`
     with the page's trace id and a **fresh span id**, which is what W3C asks of a caller (the
     `parent-id` field is "the id of this request as known by the caller"): re-sending the span it
     sits inside would collapse every call a page makes into one span. The server propagates a
     well-formed incoming traceparent verbatim, so the id the caller minted **is** the id the
     handler's work reports — caller and callee agree on the span's name, under one trace id.
     Applies to reads, mutations, `.raw`, and a stream `?__abide_from=` resume (it is the same call,
     continued).
   - **A NAVIGATION deliberately carries nothing.** A nav is a new logical operation, not a
     continuation of the page it left: propagating would grow **one immortal trace per tab** for the
     session's whole life, and the destination would report the trace id of the page *before* it. So
     every nav (full soft-nav, partial cross-nav, param/query confirm) lets the server mint a fresh
     trace, which the client then adopts. **The split is the point** — a call inside a page joins its
     trace; a move between pages starts one.
   - **Cross-origin, the browser proxy declines to volunteer one** (a bundle/remote app pointed at
     `ABIDE_APP_URL`): `traceparent` is not CORS-safelisted, so sending it would turn a simple GET
     into a preflighted one — an extra round trip per read — and W3C's own privacy guidance is not to
     hand trace context to a receiver you don't control. A cross-origin caller that *wants* to carry
     one still can: `traceparent` is in the default CORS allowed-headers list.
5. **`onHealth()` = app-defined health hook (a `src/app.ts` export), merged into `/__abide/health`**
   over the framework stub `{ reachable, version, startedAt, uptime }` (app fields win). It is
   **request-scoped** (reads `identity()`/`context()`), and `reachable: false` or a throw answers
   **503** (carrying `Retry-After: 30` so a probe backs off instead of hammering an unhealthy app).
   `/__abide/health` is the probe endpoint (load balancers / monitors). The isomorphic
   `health()` (from `abide/shared/health`) is **async** and returns the SAME DOCUMENT on both sides:
   on the server it composes it in-proc — baseline, bind clock, `onHealth` merged over them — and on
   the client `await health()` fetches `/__abide/health`. The route is a wrapper that picks the status
   code and nothing else, so a probe's GET and an in-proc caller cannot describe the app differently.
   It was asymmetric (the server answered `{ reachable, version }` and the ROUTE composed the rest),
   which meant the server-side call could not report whether the app was healthy, only that it existed
   — and left the return type an index-signature bag, since with the app fields present on one side
   and absent on the other nothing but `unknown` was true of both. `createApp` PROVIDES the hook and
   the clock to a registration slot in `shared/` (`provideHealthSource`, the arrangement
   `defaultAgentSurface` uses for `agent()`) because `shared/` may not name `server/`; the
   registration is a stack, so a stopped app stops answering. `abide run` binds no server and so
   provides its own, clocked from load. The reach is what changed: the hook now runs on **every**
   server-side `health()`, not only inside the route — so a hook that reads `identity()` and is called
   from a scope-free caller (a migration, a warmer) throws there, which is the existing throw-fails-
   closed rule (`reachable: false` + 503) rather than a new failure mode.
   - **The RETURN TYPE is generated** (`src/.abide/health.d.ts`, written by `dev`/`check`/`lsp`/
     `build`): a module augmentation carrying `Awaited<ReturnType<typeof onHealth>>` into the
     `HealthAugmentation` seam, so `(await health()).db` is typed in the app that declares it and a
     compile error in the app that does not. The derivation is TypeScript's own — nothing reads a type
     at generation time, so the companion cannot drift from the hook it describes. **A tsconfig
     `include` wildcard never descends into a dot-directory**, so the scaffolded tsconfig names
     `"src/.abide/*.d.ts"` explicitly; without that entry the companion is written, never read, and
     `health()` silently keeps typing as the bare baseline (the writer warns on `abide:health`).
6. **Connectivity probes:** `online()` = a **reactive** boolean (navigator.onLine + last-known
   reachability) for driving offline UI; `reachable(host)` = an `await`ed actual reachability
   check.
7. **`/__abide/inspector` = operator inspector, gated OFF by default** — injected + routed only
   when `ABIDE_ENABLE_INSPECTOR=true` (it exposes internals, so closed unless opted in);
   `ABIDE_INSPECT` adds debug instrumentation. **NOT BUILT** — neither the route nor either env var
   exists in the tree, and CLAUDE.md listed all three as if they did until this was written down.
   The design stands (the parked item below is its *contents*); the absence is what needed stating.

---

## Deferred / parked (rule before implementation)

- **Shipping client logs to the server** (CO2.1) — console-only client is the default; a
  client→server log transport is unspecified.
- **Inspector contents / protocol** (CO2.6) — gating is fixed; what it exposes is not specced.
- **Metrics** (counters/histograms beyond logs/health) — not in scope.
