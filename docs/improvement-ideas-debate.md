# Improvement ideas — recommendations and debate consensus

Ten haiku agents each proposed one unique improvement to abide (one duplicate — a second
form-submission primitive — was rejected and its agent replaced). For each idea the
maintainer-side recommendation below was then debated by a pair of haiku agents until
they agreed. Generated 2026-06-11.

| # | Idea | My recommendation | Debaters' consensus |
|---|------|-------------------|---------------------|
| 1 | **W3C Trace Context request tracing** — propagate `traceparent` across surfaces with a queryable `trace()` helper | Adopt minimally: accept/generate `traceparent`, stamp DEBUG logs, forward on internal hops; skip `tracestate`, `trace()`, and agent/MCP propagation until needed | Same, **plus** ship the minimal `trace()` helper now — it returns the already-captured traceparent from request context, costs nothing, and serves the visibility principle; still defer `tracestate` and agent/MCP propagation |
| 2 | **Stream buffer coalescing** — optional `batchMs` on `streamFromIterator` trading latency for burst throughput | Reject: no benchmark shows microtask enqueue overhead is a bottleneck; a tuning dial grows the API and betrays latency-first defaults | Agree fully: reject; users can batch in their own iterator where the tradeoff is explicit; revisit only with concrete benchmarks |
| 3 | **Failure-injection fixtures for `bootTestServer`** — built-in timeout/4xx/5xx/malformed/partial-stream simulators | Adopt: small option on the existing harness; makes error boundaries, cache failure, and reconnect paths assertable | Agree: adopt fixtures (fault *injection* is orthogonal to error *observation*, and harness options add no permanent public API); reserve any production error hook for later if observability demand justifies it |
| 4 | **`online()` network state probe** — reactive connectivity probe in the `pending()`/`refreshing()` grammar | Adopt: `abide/shared/online`, constant-true on server, browser via online/offline events through `createSubscriber` | Agree, refined: `navigator.onLine` as the universal base (its *offline* signal is reliable; works with zero sockets open), plus an optional explicit `connectedToBackend()`-style probe for apps needing verified reachability — never derive the base probe from socket internals |
| 5 | **`onRequest` lifecycle metrics hook** — request summary (timing, status, route, cache hit/miss/coalesce) at completion | Adopt modified: one optional `onRequest(summary)` hook with a plain-object summary; emit `Server-Timing` in dev | Agree, amended: `Server-Timing` should be **always-on** (dev-only would break "identical runtime dev/build"); the hook fires when the response fully settles (stream end), with cache metrics frozen at settlement |
| 6 | **Cache lifecycle diagnostics** — log registrations, hits/misses, invalidations, TTL expiry, inline-vs-streaming decisions | Adopt `DEBUG=abide:cache` channel; reject a public `cache.debug()` callback (API growth) | Agree on no public callback, but the env flag alone misses the browser half: pair server-side `DEBUG=abide:cache` with a client `localStorage` toggle (`abide-debug=cache`) wired to the same diagnostic channel |
| 7 | **`maxBodySize` request body limits** — per-verb cap enforced before schema parsing | Adopt: secure ~1MB default, per-verb override, bound actual streamed bytes (don't trust `Content-Length`) | Agree on per-verb limits and streamed-byte enforcement, but **no new 1MB default** — that silently breaks existing upload endpoints; default inherits Bun's server-wide `maxRequestBodySize`, per-verb caps are opt-in defense-in-depth |
| 8 | **`createForm()` optimistic-mutation form primitive** — field state, optimistic updates, rollback | Reject for core: large opinionated surface and parallel reactivity machinery; existing idiom (verbs + `pending()` + invalidate + runes) composes; revisit as `@abide/forms` only with demand | Agree on keeping it out of core, but carve out a thin `errorMap()` helper (server validation error → per-field message map) in `@abide/forms` — real repetitive glue, no validation-timing opinions, no reactivity machinery |
| 9 | **Persistent cache adapter (Bun SQLite)** — durable `CacheStore` surviving restarts | Defer: persistence imposes serializability on cached values and changes settle semantics; prototype out-of-core as `@abide/cache-sqlite` first | Agree, sharpened from "defer" to "build now, out of core": ship `@abide/cache-sqlite` in the monorepo as explicit opt-in (per key/store), loud errors on non-serializable values, zero changes to core `cache()` until real usage patterns emerge |
| 10 | **`__abide/playground` interactive surface explorer** — live schema forms for routes/RPCs/sockets/MCP | Adopt dev-only, built into the framework as a UI over already-generated surface metadata | Agree on the value but not the location: ship as a separate opt-in `@abide/explorer` package consuming the generated metadata — schema-driven UI for sockets/MCP is substantial ongoing maintenance that doesn't belong in a size-conscious core |

## How the debates moved the recommendations

- **Unchanged (3):** ideas 2, 3 — the pairs endorsed the recommendation as written — and 9, where the consensus is the same plan stated more concretely.
- **Amended (6):** idea 1 (add the `trace()` helper), 4 (add an optional verified-reachability probe), 5 (`Server-Timing` always-on, settle-time hook), 6 (client-side toggle for the debug channel), 7 (drop the breaking 1MB default), 8 (carve out `errorMap()`).
- **Relocated (1):** idea 10 — same feature, but as `@abide/explorer` instead of in-core.

A recurring theme across the debates: abide's own stated values were used against the
first-draft recommendations — "identical runtime dev/build" killed the dev-only
`Server-Timing` header, "small API surface" pushed the playground out of core, and
"isomorphism by default" exposed that a server env flag can't cover browser-side cache
diagnostics.
