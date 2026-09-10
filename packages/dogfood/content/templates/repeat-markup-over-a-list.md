---
title: Repeat markup over a list
nav: Lists
intent: Render a list so that reordering it moves nodes instead of rebuilding them.
covers:
  - `{#for item, index of list by key}`
  - `{#for await item of source}`
examples:
  - packages/dogfood/examples/list-keyed
---

A list block renders its body once per item. What separates one implementation from another is
not the first render — every one of them produces the same markup — but the second: whether a
reorder moves the nodes that were already there, or builds new ones that look the same.

## The two list blocks

| You write | Over |
| --- | --- |
| `{#for item, index of list by key}` | a collection you hold |
| `{#for await item of source}` | a cursor that produces over time |

`index` and `by` are both optional, and the second is the one worth spelling. `{#for await}`
appends rather than replaces, so what it is reading decides its own replay depth — a room's
tail, a stream's chunks — and the block does not have to be told.

Both iterate **zero times** over an absent subject. A list still loading is not an error and
not a special case; it is a block with nothing in it yet.

## A key is what makes a reorder a reorder

{% example list-keyed %}

*1 clause, 0 tables* — the arm's key-to-node map is what `by` says in four characters.

Without `by`, a `{#for}` is **positional**: item one is the first node, item two the second,
and a list whose order changed is a list where every node's content changed. The output is
identical, which is exactly the problem — a rebuild renders correctly and throws away the
focus, the selection, the scroll position and any transition that was mid-flight.

That is why the block **warns in development** where it has no key and a stateful body. A body
holding an input or a component instance is a body where the difference is visible, and the
warning is the only moment anything says so.

A key is any expression, and the honest one is whatever the row is identified by in the system
it came from. `by row.id` and `by row` differ only in whether identity survives a re-fetch.

Read on: [Patching a list](../values/patch-a-list-from-a-live-feed.md)

## Two cases catch two different mistakes

A **two-row swap** is what tells a minimal reorder from a rebuild: both render the same names,
and only one of them moved two nodes to do it. A **full reverse** cannot — every position
changed, so a rebuild and a reorder are indistinguishable by cost.

The reverse earns its place on the other question. A transposition that gets the ends right and
the middle wrong passes a swap and fails a reverse, so the case that is useless for pricing is
the one that catches the bug. Both, or neither is worth running.

Read on: [Loading states](../values/show-a-value-that-isnt-there-yet.md)

## `{#for await}` is the same block over a cursor

It reads a source that produces over time — a streamed handler, a room's tail — and appends as
each one lands rather than waiting for the last. A `{:catch}` on it **appends** after the rows
already painted, the block having accumulated rather than rendered as a unit.

Read on: [Streaming data](../server/send-data-as-it-arrives.md) ·
[Rooms](../values/let-anything-publish-and-anything-read.md)

## Next

* [Conditionals](show-markup-conditionally.md) — the block for one rather than many
* [Components](reuse-a-piece-of-markup.md) — a row that is worth its own file
* [Patching a list](../values/patch-a-list-from-a-live-feed.md) — changing one row of many
