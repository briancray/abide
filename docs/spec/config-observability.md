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
   stdout/stderr — **JSON when `ABIDE_LOG_FORMAT=json`, else TSV**. **Client** writes to console
   (console-only by default; shipping client logs to the server is parked).
2. **Channels gated by `DEBUG`** (the `debug`-npm pattern) — `log.channel('cache')` emits only if
   `DEBUG` names it. Framework internals use channels too, so `DEBUG` lights up abide's own
   diagnostics.
3. **`trace()` = W3C Trace Context (`traceparent`).** Each server request gets/propagates a
   traceparent; **RPC calls carry it**, so a browser→server(→server) chain shares one trace id.
   **Auto-correlated into log lines.** `trace()` returns the current traceparent or `undefined`.
4. **`health()` = app-defined health hook, merged into `/__abide/health`** alongside the
   framework's `{ reachable }`. `/__abide/health` is the probe endpoint (load balancers /
   monitors).
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
