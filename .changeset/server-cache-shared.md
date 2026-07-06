---
'@abide/abide': minor
---

Server cache semantics: `cache()`/bare-rpc reads with no request in flight now
resolve to the process store instead of an orphan fallback; server reads are
coalesce-only by default (`ttl` defaults to 0 on the server, Infinity on the
client), so retention across requests is opt-in via an explicit `ttl`.

BREAKING: the `global` cache option is renamed `shared`, and it no longer implies
retention — `{ global: true }` (memoise forever) becomes `{ shared: true, ttl: Infinity }`.
A `ttl > 0` read that lands in a request-scoped store now warns.
