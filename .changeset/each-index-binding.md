---
'@abide/abide': minor
---

`index="i"` on `<template each>` — bind the row's reactive position

`<template each={list} as="item" key="item.id" index="i">` binds the iteration index to a name. In a keyed `each` the index is reactive: a reorder/insert/remove that shifts a surviving row repaints its `{i}` in place (same DOM, no rebuild), riding the same `Object.is` cell-write path as the item binding. SSR renders the index via `entries()` so hydration stays congruent; async `each await` carries the stream arrival ordinal.
