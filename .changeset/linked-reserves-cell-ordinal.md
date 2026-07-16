---
"@abide/abide": patch
---

Fix an async-cell warm-seed ordering bug where a `linked` cell reading a blocking dependency could desync SSR and client

An async cell's warm-seed key is `${scope.id}:${index}`, where `index` is a per-scope counter drawn in construction order. Only a cell that actually becomes async draws one — and a `linked` seed becomes async (drawing an index) only when it *suspends* by reading a still-pending blocking dependency, otherwise it resolves synchronously to a plain `state` and drew none. Because a blocking dependency is typically in flight on the server (the `linked` suspends → index drawn) but already warm-adopted on the client (the `linked` resolves synchronously → no index), every async cell declared *after* the `linked` in the same scope keyed off-by-one across the handoff and warm-adopted the wrong cell's value (e.g. a grid cell rendering the layout string it followed). `linked` now reserves its ordinal on the synchronous path too, so it always occupies exactly one index — the same invariant `computed` already has from its static `async`-function routing — and downstream keys line up on both sides.
