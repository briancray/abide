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
   stdout/stderr — **JSON when `ABIDE_LOG_FORMAT=json`, else TSV** (`level  time  [channel]
   traceparent?  message`). **Client** writes to console as `[channel] …` (console-only by
   default; shipping client logs to the server is parked). Every line carries a **channel label**.
2. **Default channel = the app name; framework channels = `abide:*`.** The un-channeled root
   `log(...)` labels lines with the **app name** — `ABIDE_APP_NAME`, else the project
   `package.json` `name` (seeded at boot by `loadApp`), else `"abide"` — and is **always on** (it
   is the app's own stream). `.channel(name)` is a **named channel gated by the `debug`-npm
   pattern**: server reads `DEBUG` (`DEBUG=cache,rpc` / `DEBUG=*`), the browser reads
   `localStorage.debug`, so a channel is enable-able on **both** sides of the isomorphism. All
   framework internals log under the **`abide:*`** namespace, so `DEBUG=abide:*` lights up abide's
   own diagnostics. The current channel set: `abide:rpc`, `abide:cache`, `abide:router`,
   `abide:ssr`, `abide:socket`, `abide:identity`, `abide:agent`, `abide:mcp`, `abide:hydrate`,
   `abide:stream`, `abide:bundle`, `abide:cli`.
   - **Level policy (one rule):** `error` **always emits**, bypassing gating, so operational
     failures surface even on a silent channel. `warn`/`info`/`trace` emit **only** when their
     channel is named (the default app channel counts as always-named → always on).
3. **`trace()` = W3C Trace Context (`traceparent`).** Each server request gets/propagates a
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
     header on a param/query nav, which keeps its mount and therefore has no seed. A malformed value
     is dropped rather than adopted, so `trace()` is always a valid traceparent or `undefined`.
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
4. **`onHealth()` = app-defined health hook (a `src/app.ts` export), merged into `/__abide/health`**
   over the framework stub `{ reachable, version, startedAt, uptime }` (app fields win). It is
   **request-scoped** (reads `identity()`/`context()`), and `reachable: false` or a throw answers
   **503** (carrying `Retry-After: 30` so a probe backs off instead of hammering an unhealthy app).
   `/__abide/health` is the probe endpoint (load balancers / monitors). The isomorphic
   `health()` (from `abide/shared/health`) is **async**: on the server it resolves the baseline
   `{ reachable, version }` in-proc (the route composes its stub from it); on the client `await
   health()` fetches `/__abide/health`, yielding the full merged document.
5. **Connectivity probes:** `online()` = a **reactive** boolean (navigator.onLine + last-known
   reachability) for driving offline UI; `reachable(host)` = an `await`ed actual reachability
   check.
6. **`/__abide/inspector` = operator inspector, gated OFF by default** — injected + routed only
   when `ABIDE_ENABLE_INSPECTOR=true` (it exposes internals, so closed unless opted in);
   `ABIDE_INSPECT` adds debug instrumentation.

---

## Deferred / parked (rule before implementation)

- **Shipping client logs to the server** (CO2.1) — console-only client is the default; a
  client→server log transport is unspecified.
- **Inspector contents / protocol** (CO2.6) — gating is fixed; what it exposes is not specced.
- **Metrics** (counters/histograms beyond logs/health) — not in scope.
