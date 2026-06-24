---
'@abide/abide': minor
---

In-place reactive updates for `<template await>` `then` values and keyed `each` items

A re-settling `await` block and a re-keyed `each` row no longer rebuild their subtree — they update through a reactive value cell instead, so a live cache patch updates only what changed and never flashes the surrounding DOM.

- `awaitBlock` keeps the mounted `then`-branch across a re-run, setting a reactive value cell rather than detaching + rebuilding. A revalidation now keeps the stale branch visible and patches in place; the branch is rebuilt only across a pending/catch ↔ then kind change.
- The `then` binding is lowered to read that cell reactively — both a single identifier (`then="value"`) and a destructure (`then="[a, b]"` / `{ x, y }`), where each leaf is derived per-read so only the leaves whose value changed propagate.
- Keyed `each` holds each row's item in a reactive cell; a re-key with a changed value (same key, new object) writes the cell through `Object.is`, re-running only that row's effects with no DOM rebuild. The row `render` now receives `State<T>` (the compiler binds the `as` name to read it).
- A destructuring `each … as="[a, b]"` (or `{ x, y }`) with no explicit `key` now defaults the key to the row's raw item identity, like a plain `as`. Previously the default key re-emitted the destructure pattern, allocating a fresh array/object per reconcile, so keys never matched and every row rebuilt on any list change.
- A block value binding (`then="x"` / `each … as="x"`) now correctly shadows a same-named component `state`/`computed`/`derived`: it is a nearer lexical scope, so `{x}` in the block reads the resolved/row cell rather than the component signal. A destructure pattern's default/computed-key initializer is also lowered, so `then="{ id, label = fallback }"` resolves `fallback` against the component scope instead of emitting it raw.
