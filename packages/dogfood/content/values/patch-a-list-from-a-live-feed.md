---
title: Patch a list from a live feed
nav: Patching a list
intent: A list fetched once and kept current by a feed, without refetching it and without copying it per frame.
covers:
  - `s.patch`
  - memo › `transform`
examples:
  - packages/dogfood/examples/patch-a-list
---

A list arrives once and then changes for the rest of the session. Refetching it per change is a
round trip to learn one row; rebuilding it per change is a copy of every row that did not move.
Neither is what happened, and `patch` is how a page says what did.

{% example patch-a-list %}

*1 entry written per frame, 1 row painted* — against a list of four, or of four thousand.

## `patch` mutates the held value and mints its production

`set` replaces. `patch` hands you what is already held, lets you change it in place, and mints the
production that wakes readers — so a frame naming one order costs one entry:

{% snippet patch-a-list src/ui/pages/orders/page.abide watch(async () => { %}

The wake-up is the whole reason it is a member rather than a mutation you make yourself.
`byId().set(id, order)` reaches the same `Map` and changes it, and nothing on the page moves — the
reference never changed, and a reference is what readers are watching. That is a mutation the
system cannot see, which is exactly what this closes.

## A `Map` is the shape a per-row feed wants

A frame names an id, and finding that id in an array is a scan before it is a write. `transform`
is where the fetch's array becomes an index, once, so nothing downstream re-indexes per frame:

{% snippet patch-a-list src/ui/pages/orders/page.abide const byId = memo(() => loadOrders(), { %}

The fold itself lives in `#shared`, not in the page. It takes the index and one frame and returns
nothing, which makes it the thing a test can drive without a document:

{% snippet patch-a-list src/shared/orders.ts export function applyOrderChange( %}

## `patch` replaces the head production, so `tail` stays honest

`set` pushes a production; `patch` replaces the newest. That keeps [`tail`](keep-the-last-few-values.md)
honest under it: n mutations of one object are one entry's worth of information, so no two entries
in the ring are ever the same object, and a value only ever patched retains one however deep its
`tail` is.

It is also the limit. A reader on the cursor face receives the same object identity every time, so
this is for a value read whole — a table, an index, a roster — and never for one streamed row by
row. A stream of items wants a value that IS the item, which is what a room already is.

## A refetch clobbers what a patch wrote, which is the point

`byId` is a memo, so `refresh()` reloads it and the fold starts again from what the server said. A
patch is the app catching a held value up between loads, never a second source of truth beside it —
and where the two disagree, the load wins.

Read on: [History & tail](keep-the-last-few-values.md) ·
[Rooms](let-anything-publish-and-anything-read.md) ·
[Throttle & debounce](slow-down-a-value-that-changes-too-fast.md)
