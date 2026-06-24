# `index="i"` on `<template each>` — design

## Goal

Expose the iteration index as a bound name on `<template each>`, parallel to `as`
and `key`. In a keyed `each`, the index is **reactive**: a reorder/insert/remove
that shifts a surviving row repaints its `{i}` in place (no row rebuild), matching
the cell-based in-place model used by the item binding.

## Syntax

```html
<template each={list.value} as="item" key="item.id" index="i">
  {i}: {item.label}
</template>
```

`index` is an OPTIONAL plain identifier — always a number, no destructure. A
non-identifier value is a compile error.

## Surfaces

### Parse — `parseTemplate.ts` + `types/TemplateNode.ts`

Extract `index` next to `as`/`key`; add `index?: string` to the `each` node.

### Runtime sync — `each.ts` + `types/EachRow.ts`

- `EachRow` gains `indexCell: State<number>` (always allocated — one cheap
  `state(0)` per row keeps the runtime uniform; the compiled thunk ignores it when
  no `index` is requested).
- `render` signature: `(parent, item: State<T>, index: State<number>)`.
- `buildRow(item, position)` seeds `indexCell` so first paint is correct.
- In the backward reconcile walk, every row (new or surviving) gets
  `row.indexCell.value = position`. `Object.is` makes an unchanged position a
  no-op → a pure append repaints nothing; a prepend/reorder repaints only the
  moved rows' `{i}`.

### Runtime async — `eachAsync.ts`

Supported. `index` = stream **arrival ordinal**, seeded once per row from a
monotonic counter (not reactive-on-reorder — an async stream only appends). Same
`render` signature so the compiled thunk is identical.

### Compiler build — `generateBuild.ts`

When `index` is set, the row thunk takes a third param and the body is lowered
with the index name in the block-local deref scope (reusing the block-local
shadow mechanism), so `{i}` → `i.value` and it shadows a same-named component
signal. When absent, the param is omitted; the runtime still passes the cell and
the unused arg is ignored.

### Compiler SSR — `generateSSR.ts`

`for (const [i, item] of [...(list)].entries())` when an index is requested
(plain `for…of` otherwise). SSR reads `i` as a plain number; the client reads
`i.value` — same number at first paint, so hydration stays congruent.

## Reactivity invariant

Index writes ride the same `Object.is` cell-write path as item writes: unchanged
→ no-op, changed → re-runs only that row's `{i}` effect. No row DOM is rebuilt on
a reorder.

## Testing

- Sync keyed `each`: reorder repaints moved rows' `{i}` in place, same DOM nodes;
  append leaves earlier indices untouched; prepend shifts all.
- Index name colliding with a component `state` shadows it (reads the cell).
- SSR/hydration congruence: server `entries()` index == client `i.value` at first
  paint (render-congruence fuzz corpus).
- Async `each await`: rows carry arrival-ordinal index.

## Out of scope

Index on non-`each` blocks; an index expression (it's a bound name only).
