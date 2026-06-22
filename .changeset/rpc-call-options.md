---
"@abide/abide": minor
---

Remote functions now accept an optional trailing options bag — `fn(args, opts)` — for per-call transport control: `signal`, `keepalive`, `priority`, `cache`, and `headers`. It's a curated `Pick` of `RequestInit`, not a raw passthrough: the server handler never observes these, so the call stays isomorphic, and a caller can't clobber the method, body, or framework headers the RPC contract owns. `opts.signal` merges with the scope abort and client timeout (`AbortSignal.any`) rather than replacing them, and is ignored under `cache()` so one reader can't abort a coalesced flight the others share. `opts.headers` merge onto abide's headers with the framework winning — a caller adds transport metadata (idempotency-key, authorization) but can't overwrite `traceparent`, the offline marker, or `content-type`.
