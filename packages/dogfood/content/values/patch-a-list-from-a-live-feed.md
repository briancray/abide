---
title: Patch a list as updates arrive
nav: Patching a list
intent: A list fetched once and kept current as updates arrive, without refetching it and without copying it per frame.
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

## `patch` mutates the held value and wakes its readers

{% example patch-wakes %}

*1 entry written per frame, 1 row painted* — against a list of four, or of four thousand.

`set` replaces. `patch` hands you what is already held, lets you change it in place, and wakes its
readers — so a frame naming one region costs one entry rather than a copy of
every region that did not move. Press the button and watch the other three rows: they are not
rewritten, because nothing wrote them.

Both halves are the member. The mutation alone moves nothing on the page, and a wake alone says
nothing new — `patch` is the pair, which is why it is a member rather than something you
assemble at the call site.

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
press you had written off. A patch repaints from the whole map, so the write that woke nobody
arrives now — attached to an interaction that had nothing to do with it. That is what makes this
expensive to find later rather than merely wrong.

Read on: [Channels](let-anything-publish-and-anything-read.md) ·
[Watching values](do-something-when-a-value-changes.md)

## A `Map` is the shape per-row updates want

{% example patch-transform %}

A frame names an id, and finding that id in an array is a scan before it is a write. The server
sends an **array**, and the page holds an **index**. `transform` is
where the one becomes the other, once, on the way in, so nothing downstream re-indexes per frame.

Doing it here is also what keeps it done once. A reshape written at the call site is a reshape
every caller has to remember, and the one that forgets is holding a different shape from everybody
else.

The index reads the rows rather than adopting the call, and that is deliberate. A write to a value
that adopts another reaches the value it adopted (11.59), so a `patch` on
`reactive(() => getRegions(), { transform })` would be handed the array and not the index.

The index is still **loaded**: `regions.refresh()` reloads the rows, and the fold runs again over
what the server said (11.5). A patch is the app catching a held value up between loads, never a
second source of truth beside it, and where the two disagree the load wins (11.8).

Read on: [Derived values](derive-a-value-from-other-values.md) ·
[Reloading](decide-when-a-value-reloads.md) ·
[Loading states](show-a-value-that-isnt-there-yet.md)

## `patch` keeps the value's identity, so `by` is how a row is told apart

`set` replaces the value with a new one; `patch` changes the one already held (5.7). The reference
does not move, so a reader that compares references would see nothing — which is why `patch` wakes
its readers itself, and why a `{#for}` over the value never keeps a row showing an element as it
stood before the patch (32.33).

What tells one element from another is `by` (5.22). A list keyed by its own ids moves the rows it
keeps (32.29), so a patch that appends, removes or reorders touches the rows it changed and no
others. Across a connection a patch is sent as what it wrote rather than as the value (18.11), so a
subscriber's copy is patched the same way.

A list many callers append to and everyone connected reads is the same value with more writers,
and that is a channel.

Read on: [Lists](../templates/repeat-markup-over-a-list.md) ·
[Channels](let-anything-publish-and-anything-read.md)

## Next

* [Recent values](keep-the-last-few-values.md) — a list trimmed in the patch that appends to it
* [Channels](let-anything-publish-and-anything-read.md) — where the updates themselves come from
* [Throttle & debounce](slow-down-a-value-that-changes-too-fast.md) — when the frames arrive faster
  than a paint
