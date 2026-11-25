---
"@abide/abide": minor
---

`fetchData` is `fetchAndHandle`, and it is isomorphic: imported from `@abide/abide`, it runs in the browser as well as on the server (`@abide/abide/server` still re-exports it). `handle` is no longer exported — `fetchAndHandle` reads the body as `handle` did. Its `ttl` cache is gone: hold an answer in a `memo` over the call, `memo(({ id }) => fetchAndHandle(url(id)), { ttl: 60_000, global: true })`, keyed by what you ask with, or give a handler its own `ttl`. `abide upgrade` renames `fetchData` (38.225); a `ttl` handed to it, and a `handle(response)`, are left for you to move.
