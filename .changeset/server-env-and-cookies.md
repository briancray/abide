---
"@briancray/belte": minor
---

Add two server primitives. `belte/server/env` validates the process environment against a Standard Schema at module load, returning typed config and failing the boot with every issue listed when a variable is missing or malformed. `belte/server/cookies` exposes the request's cookie jar — Bun's native `CookieMap` parsed from the inbound `Cookie` header, with `set`/`delete` writes flushed to `Set-Cookie` on the outgoing response when the handler returns. `cookies` resolves from the request scope like `request()`, materialized lazily so a request that never touches them parses and emits nothing; `env` reads `Bun.env` once at module load, independent of any request.
