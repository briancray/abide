---
"@abide/abide": minor
---

Endpoint-declared cache policy; namespace the rpc opts (ADR-0020). All cache/stream policy moves onto the rpc definition and the smart bare call becomes `fn(args)` with no call-site options. Opts are namespaced and kind-scoped by type: `schemas: { input, output, files }`, `cache: { ttl, tags, throttle, debounce, shared }` and `stream: { n }` on read helpers, `outbox` on mutating helpers (a `cache` on a write, or `outbox` on a read, is a compile error). `cache.tags` accepts an arg-derived function. `swr` is removed — SWR is unconditional for replayable reads. `ttl` now defaults to Infinity: an entry is retained for its store's lifetime (the request on the server, the tab on the client), and `shared` alone memoises across requests; a write coalesces only. Endpoint policy also ships to the client so client-side reads honor the declared ttl/refetch clock/tags.

BREAKING: `inputSchema`/`outputSchema`/`filesSchema` → `schemas: { … }`; call-site cache options (`fn(args, { ttl, tags, … })`) → endpoint `cache: { … }`, and the smart bare call drops its second argument (`fn(args)`). `.raw(args, init)` keeps per-call transport options unchanged.
