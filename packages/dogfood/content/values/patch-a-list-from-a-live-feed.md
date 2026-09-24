---
title: Patch a list from a live feed
nav: Patching a list
intent: A list fetched once and kept current by a feed, without refetching it and without copying it per frame.
covers:
  - `s.patch`
  - `transform`
examples:
  - packages/dogfood/examples/patch-wakes.json
  - packages/dogfood/examples/patch-unseen.json
  - packages/dogfood/examples/patch-transform.json
---

A list arrives once and then changes for the rest of the session. Refetching it per change is a
round trip to learn one row; rebuilding it per change is a copy of every row that did not move.
Neither is what happened, and `patch` is how a page says what did.

## `patch` mutates the held value and mints its production

{% example patch-wakes %}

*1 entry written per frame, 1 row painted* — against a list of four, or of four thousand.

`set` replaces. `patch` hands you what is already held, lets you change it in place, and mints the
production that wakes readers — so a frame naming one region costs one entry rather than a copy of
every region that did not move. Press the button and watch the other three rows: they are not
rewritten, because nothing wrote them.

Both halves are the member. The mutation alone moves nothing on the page, and a production alone
says nothing new — `patch` is the pair, which is why it is a member rather than something you
assemble at the call site.

The fold itself lives in `#shared`, not in the page. It takes the index and one frame and returns
nothing, which makes it the thing a test can drive without a document.

Read on: [Local state](show-a-value-that-changes.md) ·
[Watching values](do-something-when-a-value-changes.md)

## A write that misses `patch` moves nothing — until something else does

{% example patch-unseen %}

Press **Apply without patch** first. Nothing happens, and that is the whole of it: the
frame landed in the held `Map` and no reader was told. Reaching the same `Map` any other way
changes it and moves nothing on the page, because the reference never changed and readers watch
the reference.

**The wrong way is spelled like nothing at all.** The two handlers on the card are the same four
lines and differ only on the last. `applyOrderCount(byId, frame)` is a read by name in a
value-typed argument (31.1), handing the helper the held `Map`; `byId.patch(…)` hands that same
helper that same map through the member. No cast, no escape hatch, nothing that reads as reaching
around anything.

**Then press Apply next frame.** Two figures move: the one you just asked for, and the one from the
press you had written off. A production repaints from the whole map, so the write that woke nobody
arrives now — attached to an interaction that had nothing to do with it. That is what makes this
expensive to find later rather than merely wrong.

Read on: [Channels](let-anything-publish-and-anything-read.md) ·
[Watching values](do-something-when-a-value-changes.md)

## A `Map` is the shape a per-row feed wants

{% example patch-transform %}

A frame names an id, and finding that id in an array is a scan before it is a write. The server
sends an **array**, and the page holds an **index**. `transform` is
where the one becomes the other, once, on the way in, so nothing downstream re-indexes per frame.

Doing it here is also what keeps it done once. A reshape written at the call site is a reshape
every caller has to remember, and the one that forgets is holding a different shape from everybody
else.

The index reads the rows rather than adopting the call, and that is deliberate. A write to a value
that adopts another reaches the value it adopted (11.60), so a `patch` on
`reactive(() => getRegions(), { transform })` would be handed the array and not the index.

The index is still **loaded**: `regions.refresh()` reloads the rows, and the fold runs again over
what the server said (11.5). A patch is the app catching a held value up between loads, never a
second source of truth beside it, and where the two disagree the load wins (11.8).

Read on: [Derived values](derive-a-value-from-other-values.md) ·
[Reloading](decide-when-a-value-reloads.md) ·
[Loading states](show-a-value-that-isnt-there-yet.md)

## `patch` replaces the head production, so `history` stays honest

`set` pushes a production; `patch` replaces the newest. That keeps
[`history`](keep-the-last-few-values.md) honest under it: n mutations of one object are one entry's
worth of information, so no two entries in the ring are ever the same object, and a value only
ever patched retains one however deep its `history` is.

It is also the limit. A reader on the cursor face receives the same object identity every time, so
this is for a value read whole — a table, an index, a roster — and never for one streamed row by
row. A stream of items wants a value that IS the item, which is what a channel already is.

Read on: [History](keep-the-last-few-values.md) ·
[Channels](let-anything-publish-and-anything-read.md)

## Next

* [History](keep-the-last-few-values.md) — what the ring keeps under a patch
* [Channels](let-anything-publish-and-anything-read.md) — where the feed itself comes from
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — when the frames arrive faster
  than a paint
