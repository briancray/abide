---
'@abide/abide': patch
---

Coalesce reactive writes inside event handlers

Event handlers now batch their writes: a handler that sets several signals re-runs
each dependent effect/computed/DOM-binding once on the handler's exit instead of once
per write (the previous default flushed eagerly per write). The change stays fully
synchronous — the flush runs at handler-end before it returns — so the causal stack
(`dispatch → handler → effects`) is intact and server/client scheduling stays identical.

Factored the batch idiom `createDoc`/`clientPage` inlined into a shared, nesting-safe
`batch()` (flushes only on the depth-0 exit) and migrated both onto it, so a handler
that triggers a doc patch now coalesces end-to-end rather than flushing mid-handler.

A handler writing N fields cuts dependent re-runs N× (bench: an 8-field form handler
drops aggregate re-runs 8× and runs ~4.8× faster). Single-write handlers and navigation
(already batched) are unchanged. New contract, pinned by tests: a handler that writes
then synchronously reads the bound DOM sees the pre-write value until it returns; signal
reads stay current.
