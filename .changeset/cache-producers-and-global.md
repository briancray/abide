---
"@briancray/belte": minor
---

`cache()` now memoises plain producers, not just rpc verb helpers — pass any `() => Promise<T>` to dedupe and retain external calls (e.g. a third-party `fetch` the server makes). Producers key on the function's reference plus args (so hoist the function, or pass an explicit `key`; an inline arrow is a fresh reference every call and never dedupes), and the value promise is stored as-is — no Response decode and no SSR snapshot. A new `global: true` option puts the entry in a process-level store instead of the request-scoped one, so a value computed in one request is reused by later ones; omit it to keep per-request data from leaking across requests, and note it is a no-op on the client (one tab store). `cache.invalidate` / `cache.pending` accept a producer reference and span both stores.
