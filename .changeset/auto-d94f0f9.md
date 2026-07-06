---
"@abide/abide": patch
---

Breaking: the `global` cache option is renamed `shared`, and it no longer implies retention. `{ global: true }` (memoise across requests forever) becomes `{ shared: true, ttl: Infinity }` — `shared` now only selects the process store, while `ttl` alone controls retention (default `0` on the server = coalesce-only, `Infinity` on the client). Reads made with no request in flight resolve to the shared store instead of an orphan fallback. ([`d94f0f9`](https://github.com/briancray/abide/commit/d94f0f9cb15a5822b2d5824db7e32da27368fe04))
