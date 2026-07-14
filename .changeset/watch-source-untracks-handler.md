---
"@abide/abide": minor
---

`watch(source, handler)` now runs the handler untracked — the named source(s) are the sole triggers (ADR-0044).

Previously the two cell forms (`watch(cell, h)` / `watch([a, b], h)`) wrapped the handler in an effect that captured *every* reactive read in the handler body, so `watch(foo, () => { id = bar.id })` silently re-ran on `bar.id` as well as `foo`. The handler is now a sink: reactive reads inside it no longer become extra triggers. This makes the cell forms match the socket and rpc forms, whose handlers already ran outside the tracking window. Only the bare `watch(() => …)` binding form still auto-tracks everything it reads. If you relied on a handler-body read re-triggering the watch, name it as a source instead (`watch([foo, bar], …)`) or use the auto-track form (`watch(() => { id = bar.id })`).
